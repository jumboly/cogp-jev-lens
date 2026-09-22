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
import { type Batch, planBatches, requestOverhead, splitBatches } from './batches.js';
import { callJev, type FailureTally, type JevLog } from './jev.js';
import { PRIMITIVES, SCHEMA_VERSION, buildQuestion, buildState, normalizeLens, type Primitive } from './questions.js';

const DEFAULT_CONCURRENCY = 2;

export interface EvaluateRequest {
  lens: string;
  /** バッチを呼び出し元が決めて送る形（`batches.ts` の planBatches / chunkBatches）。 */
  batches?: Batch[];
  /** バッチを任せる形。BFF 側で planBatches に掛ける。 */
  tags?: string[];
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

/**
 * 本文を読み、投げるバッチ列にする。
 *
 * 呼び出し元がバッチを決めて送る形（`batches`）と、タグだけ渡して任せる形（`tags`）の
 * 両方を受ける。前者は 1 リクエストのバッチ数を呼び出し元が抑えるために要る
 * （Workers 無料プランの外部 fetch 上限。`batches.ts`）。後者は curl で叩くときの口。
 */
function parse(body: unknown): { lens: string; batches: Batch[] } {
  const b = body as Partial<EvaluateRequest> | null;
  if (!b || typeof b.lens !== 'string' || !b.lens.trim()) throw new RequestError('lens が要る');
  const lens = normalizeLens(b.lens);

  if (b.batches !== undefined) {
    if (!Array.isArray(b.batches) || b.batches.length === 0) throw new RequestError('batches が空');
    for (const batch of b.batches) {
      if (!batch || !PRIMITIVES.includes(batch.primitive)) throw new RequestError(`primitive は ${PRIMITIVES.join(' / ')}`);
      if (!Array.isArray(batch.tags) || batch.tags.length === 0) throw new RequestError('batches[].tags が空');
      if (batch.tags.some((t) => typeof t !== 'string')) throw new RequestError('batches[].tags は文字列の配列');
    }
    // 受け取ったバッチも必ず分割に掛け直す。呼び出し元が同じ規則で切っていれば
    // そのまま通り、大きすぎる本文が来ても予算（34 KiB）は守られる。
    const overhead = requestOverhead(lens);
    const out: Batch[] = [];
    for (const batch of b.batches) {
      for (const slice of splitBatches([...new Set(batch.tags)], batch.primitive, overhead)) {
        out.push({ primitive: batch.primitive, tags: slice });
      }
    }
    return { lens, batches: out };
  }

  if (!Array.isArray(b.tags) || b.tags.length === 0) throw new RequestError('batches か tags が要る');
  if (b.tags.some((t) => typeof t !== 'string')) throw new RequestError('tags は文字列の配列');
  const primitives = b.primitives ?? [...PRIMITIVES];
  if (primitives.some((p) => !PRIMITIVES.includes(p))) throw new RequestError(`primitives は ${PRIMITIVES.join(' / ')}`);
  // 同じタグが二度来ても 1 回しか評価しない
  return { lens, batches: planBatches(lens, [...new Set(b.tags)], primitives) };
}

interface Job extends Batch {
  batch: number;
}

export async function* evaluateTags(
  body: unknown,
  opts: { apiKey: string; concurrency?: number; onLog?: (entry: JevLog) => void },
): AsyncGenerator<EvaluateEvent> {
  const { lens: normalized, batches } = parse(body);
  const state = buildState(normalized);

  // 並びは planBatches が決めている（先頭のタグを扱うバッチから）。ここでは番号を振るだけ。
  const jobs: Job[] = batches.map((batch, index) => ({ ...batch, batch: index }));
  const tagCount = new Set(jobs.flatMap((job) => job.tags)).size;

  const startedAt = performance.now();
  yield { type: 'start', lens: normalized, tags: tagCount, batches: jobs.length, schemaVersion: SCHEMA_VERSION };

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
