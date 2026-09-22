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
 * 1 リクエストに載せる質問数。実測で 90 問（約 28,700 トークン）までは安定して通り、
 * 130 問以上は落ちやすかった（experiments/02-jev-request-limits）。
 * ただし計測時は上流に障害が出ていたため、健全時に測り直す余地がある。
 */
const BATCH_SIZE = 90;

/**
 * 同時実行数。障害中の実測では 2 は 1 より悪かった（完了 9/14 対 12/14）ので控えめに置く。
 * 上流が健全なときに測り直す前提の暫定値。
 */
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
  tags: string[];
}

export async function* evaluateTags(
  body: unknown,
  opts: { apiKey: string; concurrency?: number; onLog?: (entry: JevLog) => void },
): AsyncGenerator<EvaluateEvent> {
  const { lens, tags, primitives } = parse(body);
  const normalized = normalizeLens(lens);
  const state = buildState(normalized);

  // なぜタグのバッチを外側にするか: プリミティブを外側にすると Score が全部届いてから
  // Choice が届く順になり、「大きさだけ動いて色は灰のまま」という中途半端な画面が長く続く。
  // タグ側を外に置けば、先頭のバッチから 3 プリミティブが揃って完成した見え方で届く。
  // 呼び出し元はタグを出現数の多い順に並べて送るので、多くの POI に効くタグから順に埋まる。
  const jobs: Job[] = [];
  for (let i = 0; i < tags.length; i += BATCH_SIZE) {
    const slice = tags.slice(i, i + BATCH_SIZE);
    for (const primitive of primitives) {
      jobs.push({ primitive, batch: jobs.length, tags: slice });
    }
  }

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
