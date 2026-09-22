/**
 * JEV 呼び出しの共通口。すべての JEV へのリクエストはここを通す。
 *
 * なぜ共通化するか: JEV は公開直後で一時障害が通常運用でも起こる。実測でも失敗は
 * すべて 503（`service_unavailable_error`）で、429 は 1 件も出ていない。つまり
 * こちらのレート制限ではなく上流の不調である。「失敗したら原因不明で落ちる」のではなく
 * 「何が原因で失敗したかを観測でき、適切な場合だけ再試行する」状態にする。
 */

/** Gateway ネイティブの評価エンドポイント。`model` が返るので #6 のキャッシュ鍵に使える。 */
const ENDPOINT = 'https://ai-gateway.vercel.sh/v1/evaluate';
const MODEL_ID = 'typesafe-ai/jev';
/** 経路をログに残す。TypeSafe 直結に切り替えたときに混同しないため。 */
const ROUTE = 'vercel-ai-gateway';

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 6;
/** 上流の不調は数百 ms で解けることもあるので、最初の待ちは短く刻む。 */
const BACKOFF_MS = [300, 700, 1500, 3000, 6000];

export type FailureKind =
  | 'rate_limit' // 429。こちら側 / Gateway 側のレート制限
  | 'overloaded' // 529。TypeSafe の推論基盤が過負荷
  | 'server' // 500 / 502 / 503 など上流・Gateway の一時障害
  | 'timeout' // 応答が返らない
  | 'network' // 接続断など
  | 'invalid' // 4xx の入力不正。再試行しない
  | 'auth'; // 401 / 403。再試行しない

const RETRYABLE: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'rate_limit',
  'overloaded',
  'server',
  'timeout',
  'network',
]);

export interface JevAnswer {
  [key: string]: unknown;
}

export interface JevSuccess {
  ok: true;
  answers: Record<string, JevAnswer>;
  /** キャッシュ鍵に使う JEV のモデル版（#6）。 */
  model: string | null;
  inputTokens: number | null;
  attempts: number;
  elapsedMs: number;
}

export interface JevFailure {
  ok: false;
  kind: FailureKind;
  status: number | null;
  message: string;
  attempts: number;
  elapsedMs: number;
}

export type JevResult = JevSuccess | JevFailure;

/** エラー種別ごとの回数。BFF が 1 リクエストぶんを集計して呼び出し元に返す。 */
export type FailureTally = Partial<Record<FailureKind, number>>;

export interface JevLog {
  at: string;
  route: typeof ROUTE;
  endpoint: string;
  model: string;
  /** Gateway が返す追跡 ID。問い合わせるときの手がかり。 */
  generationId: string | null;
  questions: number;
  requestBytes: number;
  attempt: number;
  status: number | null;
  kind: FailureKind | null;
  elapsedMs: number;
  /** 恒久エラーか一時障害かの判断根拠を残す。 */
  body: string | null;
}

function classify(status: number): FailureKind {
  if (status === 429) return 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  return 'invalid';
}

/** Gateway は上流の試行履歴を providerMetadata に入れてくる。追跡 ID を拾う。 */
function generationId(body: unknown): string | null {
  const g = (body as { providerMetadata?: { gateway?: { generationId?: string } } })
    ?.providerMetadata?.gateway?.generationId;
  return typeof g === 'string' ? g : null;
}

/** `Retry-After` は秒数か HTTP-date。読めたときは指数バックオフより優先する。 */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export interface CallOptions {
  apiKey: string;
  state: unknown;
  questions: Record<string, unknown>;
  onLog?: (entry: JevLog) => void;
}

export async function callJev({ apiKey, state, questions, onLog }: CallOptions): Promise<JevResult> {
  const body = JSON.stringify({ model: MODEL_ID, state, questions });
  const questionCount = Object.keys(questions).length;
  const startedAll = performance.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = performance.now();
    let status: number | null = null;
    let kind: FailureKind | null = null;
    let parsed: unknown = null;
    let text = '';
    let waitMs: number | null = null;

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      text = await res.text();
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (res.ok) {
        const b = parsed as { answers?: Record<string, JevAnswer>; model?: string; usage?: { inputTokens?: number } };
        if (b?.answers) {
          onLog?.(entry(attempt, status, null, started, questionCount, body.length, generationId(parsed), null));
          return {
            ok: true,
            answers: b.answers,
            model: b.model ?? null,
            inputTokens: b.usage?.inputTokens ?? null,
            attempts: attempt,
            elapsedMs: performance.now() - startedAll,
          };
        }
        // 200 だが answers がない。形が想定と違うので再試行しても直らない。
        kind = 'invalid';
      } else {
        kind = classify(res.status);
        waitMs = retryAfterMs(res.headers.get('retry-after'));
      }
    } catch (err) {
      const name = (err as Error)?.name;
      kind = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
      text = (err as Error)?.message ?? String(err);
    }

    onLog?.(entry(attempt, status, kind, started, questionCount, body.length, generationId(parsed), text));

    if (!RETRYABLE.has(kind)) {
      return { ok: false, kind, status, message: summarize(text), attempts: attempt, elapsedMs: performance.now() - startedAll };
    }
    if (attempt === MAX_ATTEMPTS) {
      return { ok: false, kind, status, message: summarize(text), attempts: attempt, elapsedMs: performance.now() - startedAll };
    }
    // ジッタを入れる。同時に投げた本が一斉に再試行して再び弾かれるのを避けるため。
    const base = waitMs ?? BACKOFF_MS[attempt - 1] ?? 6000;
    await new Promise((r) => setTimeout(r, base * (0.7 + Math.random() * 0.6)));
  }

  // 到達しない（ループ内で必ず return する）が、型のために残す。
  return { ok: false, kind: 'server', status: null, message: '再試行を使い切った', attempts: MAX_ATTEMPTS, elapsedMs: performance.now() - startedAll };
}

function entry(
  attempt: number,
  status: number | null,
  kind: FailureKind | null,
  started: number,
  questions: number,
  requestBytes: number,
  genId: string | null,
  body: string | null,
): JevLog {
  return {
    at: new Date().toISOString(),
    route: ROUTE,
    endpoint: ENDPOINT,
    model: MODEL_ID,
    generationId: genId,
    questions,
    requestBytes,
    attempt,
    status,
    kind,
    elapsedMs: Math.round(performance.now() - started),
    body: body ? summarize(body) : null,
  };
}

function summarize(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
