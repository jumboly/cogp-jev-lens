/**
 * `POST /api/evaluate-tags` の中身。
 *
 * 本番 BFF（#4）に移せるよう、Vite の dev サーバーには依存しない素の
 * 「リクエスト → NDJSON の行を吐く非同期イテレータ」として書く。
 *
 * なぜ NDJSON で流すか: z14 の冷えた Lens は 21 バッチある。上流が不安定で
 * 1 バッチあたり平均 3.6 回の試行を要した実測もあり、全部揃うまで待たせると
 * 数十秒動かない画面になる。届いたバッチから地図に重ねられる形にする
 * （README の「取得と評価を分離する」）。失敗したバッチだけを個別に伝えられるのも
 * 一括 JSON にはない利点で、成功率が安定しない相手には必須。
 */
import { callJev, type FailureTally, type JevLog } from './jev.js';
import { PRIMITIVES, SCHEMA_VERSION, buildQuestion, buildState, normalizeLens, type Primitive } from './questions.js';

/**
 * 1 リクエストの上限（本文の文字数）。
 *
 * なぜ問数でもトークン量でもなく本文の大きさで切るか。実測で順に潰した。
 *
 * 1. **問数ではない。** 実験 03 で 130 問に固定して中身だけ変えると成功率が
 *    0% / 20% / 30% と動いた。しかも Noul 190 問は実測で最も成功率が高い（42%）
 * 2. **トークン量でもない。** 段階 9 の通し実測で、同じ 28.9k トークンの 2 つが分かれた
 *
 * | 1 リクエスト | 問数 | 入力トークン | 本文 | 成功 |
 * | --- | --- | --- | --- | --- |
 * | Noul | 190 | 14.4k | 25.0 KiB | 42%（5/12） |
 * | Choice | 91 | 28.9k | 34.4 KiB | 21%（8/38） |
 * | Score | 156 | 28.9k | 39.4 KiB | **3%（1/35）** |
 *
 * 28.9k で揃えた 2 つの差（34.4 対 39.4 KiB）は Fisher の正確検定で p = 0.029。
 * 本文の大きさで並べると単調に下がる。
 *
 * 値は **Choice 90 問（34.0 KiB）** に合わせた。実験 02 で全実行 100% 通った唯一の
 * サイズで、段階 9 の不調な時間帯でも 21% と、他より明確に良かった。
 * 1 リクエストの重さをこれ以上にしないまま、軽いプリミティブを積む。
 *
 * 単位が文字数なのは、上流に渡る本文の大きさを表す指標として実測ログ（`requestChars`）と
 * 揃えるため。UTF-8 バイト数との比はプリミティブで 1.87〜2.16 とばらつくので、
 * バイト数で切ると Score に 148 問入ってしまい、実測で落ちた 156 問に近づく。
 */
const REQUEST_BUDGET_CHARS = 34 * 1024;

/**
 * 問数の上限。文字数だけ見れば Noul は 259 問積めるが、**通った実績があるのは 190 問まで**
 * （実験 02 / 03 / 段階 9）。それより上は未検証なので踏み込まない。
 */
const MAX_QUESTIONS = 190;

/**
 * タグを「本文がこの大きさに収まる」単位に切る。
 * z14 の 623 タグなら Choice 7 本 + Score 5 本 + Noul 4 本 = 16 本（問数固定なら 21 本）。
 */
function splitBatches(tags: string[], primitive: Primitive, overhead: number): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  // state とラッパーは全バッチに乗るので、最初から数に入れる。
  let size = overhead;
  for (const tag of tags) {
    // 質問ごと丸ごと数える。キーはモデルに渡らないが本文には乗る。
    const chars = JSON.stringify({ [tag]: buildQuestion(tag, primitive) }).length;
    if (current.length > 0 && (size + chars > REQUEST_BUDGET_CHARS || current.length >= MAX_QUESTIONS)) {
      out.push(current);
      current = [];
      size = overhead;
    }
    current.push(tag);
    size += chars;
  }
  if (current.length > 0) out.push(current);
  return out;
}

const DEFAULT_CONCURRENCY = 2;

export interface EvaluateRequest {
  lens: string;
  tags: string[];
  primitives?: Primitive[];
}

export type EvaluateEvent =
  | { type: 'start'; lens: string; tags: number; batches: number; schemaVersion: number }
  | {
      type: 'result';
      primitive: Primitive;
      batch: number;
      answers: Record<string, unknown>;
      model: string | null;
      inputTokens: number | null;
      attempts: number;
      elapsedMs: number;
    }
  | { type: 'error'; primitive: Primitive; batch: number; kind: string; status: number | null; message: string; attempts: number }
  | { type: 'done'; ok: number; failed: number; tally: FailureTally; elapsedMs: number };

export class RequestError extends Error {}

function parse(body: unknown): Required<EvaluateRequest> {
  const b = body as Partial<EvaluateRequest> | null;
  if (!b || typeof b.lens !== 'string' || !b.lens.trim()) throw new RequestError('lens が要る');
  if (!Array.isArray(b.tags) || b.tags.length === 0) throw new RequestError('tags が要る');
  if (b.tags.some((t) => typeof t !== 'string')) throw new RequestError('tags は文字列の配列');
  const primitives = b.primitives ?? [...PRIMITIVES];
  if (primitives.some((p) => !PRIMITIVES.includes(p))) throw new RequestError(`primitives は ${PRIMITIVES.join(' / ')}`);
  // 同じタグが二度来ても 1 回しか評価しない
  return { lens: b.lens, tags: [...new Set(b.tags)], primitives };
}

interface Job {
  primitive: Primitive;
  batch: number;
  /** このバッチが始まるタグの位置。流す順を決めるのに使う。 */
  offset: number;
  tags: string[];
}

export async function* evaluateTags(
  body: unknown,
  opts: { apiKey: string; concurrency?: number; onLog?: (entry: JevLog) => void },
): AsyncGenerator<EvaluateEvent> {
  const { lens, tags, primitives } = parse(body);
  const normalized = normalizeLens(lens);
  const state = buildState(normalized);

  // プリミティブごとにバッチサイズが違うので、まず素直に分割してから
  // 「先頭のタグを扱うジョブ」から順に並べ替える。
  //
  // なぜ並べ替えるか: プリミティブを外側にしたまま流すと Score が全部届いてから
  // Choice が届く順になり、「大きさだけ動いて色は灰のまま」という中途半端な画面が長く続く
  // （段階 8 の実測で 20 秒）。呼び出し元はタグを出現数の多い順に並べて送るので、
  // 先頭を扱うジョブから流せば、多くの POI に効くタグから 3 プリミティブ揃って埋まる。
  // state はどのバッチにも同じものが乗る。予算はリクエスト本文全体に対する値なので、
  // 質問を積む前にこのぶんを引いておく。
  const overhead = JSON.stringify({ model: '', state, questions: {} }).length;

  const jobs: Job[] = [];
  for (const primitive of primitives) {
    let offset = 0;
    for (const slice of splitBatches(tags, primitive, overhead)) {
      jobs.push({ primitive, batch: 0, offset, tags: slice });
      offset += slice.length;
    }
  }
  // sort は安定なので、同じ offset の中ではプリミティブの並び順が保たれる。
  jobs.sort((a, b) => a.offset - b.offset);
  for (const [index, job] of jobs.entries()) job.batch = index;

  const startedAt = performance.now();
  yield { type: 'start', lens: normalized, tags: tags.length, batches: jobs.length, schemaVersion: SCHEMA_VERSION };

  // 終わった順に流したいので、完了を待つキューを挟む。
  const queue: EvaluateEvent[] = [];
  let notify: (() => void) | null = null;
  const push = (e: EvaluateEvent) => {
    queue.push(e);
    notify?.();
  };

  const tally: FailureTally = {};
  let ok = 0;
  let failed = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const job = jobs[next++];
      if (!job) return;
      const questions: Record<string, unknown> = {};
      for (const tag of job.tags) questions[tag] = buildQuestion(tag, job.primitive);

      const r = await callJev({ apiKey: opts.apiKey, state, questions, onLog: opts.onLog });
      if (r.ok) {
        ok++;
        push({
          type: 'result',
          primitive: job.primitive,
          batch: job.batch,
          answers: r.answers,
          model: r.model,
          inputTokens: r.inputTokens,
          attempts: r.attempts,
          elapsedMs: Math.round(r.elapsedMs),
        });
      } else {
        failed++;
        tally[r.kind] = (tally[r.kind] ?? 0) + 1;
        push({
          type: 'error',
          primitive: job.primitive,
          batch: job.batch,
          kind: r.kind,
          status: r.status,
          message: r.message,
          attempts: r.attempts,
        });
      }
    }
  };

  const running = Array.from({ length: Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY) }, worker);
  const all = Promise.all(running);
  let finished = false;
  void all.then(() => {
    finished = true;
    notify?.();
  });

  while (!finished || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        notify = () => {
          notify = null;
          resolve();
        };
      });
      continue;
    }
    yield queue.shift()!;
  }
  await all;

  yield { type: 'done', ok, failed, tally, elapsedMs: Math.round(performance.now() - startedAt) };
}
