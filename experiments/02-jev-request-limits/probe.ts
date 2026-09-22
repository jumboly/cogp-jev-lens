/**
 * 実験 02: JEV のリクエスト上限と到達経路を実測で確かめる。
 *
 * 潰したいのは 2 点（docs/issues/04）。
 *  1. 実験 01 が使っている /v4/ai/evaluation-model は公式ドキュメントに見当たらない。
 *     文書化されているのは /v1/evaluate（model 必須・Noul が boolean）と
 *     /typesafe/v1/systemone（本家と同じ形）の 2 つ。どれを BFF で使うか決めたい。
 *  2. リクエスト全体の予算が 64k か 32k か。TypeSafe 公式と Vercel のモデルページで食い違う。
 *
 * 呼ぶ回数を抑えるため、経路の判定は 5 問で行い、予算の判定だけ質問数を増やす。
 * 一番重い Choice v3 で測る（1 問 約 337 トークン）。
 *
 *   node --env-file=.env experiments/02-jev-request-limits/probe.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('.', import.meta.url).pathname
const apiKey = process.env['AI_GATEWAY_API_KEY']
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY がない')

const MODEL_ID = 'typesafe-ai/jev'
const LENS = '観光客が興味を持ちそう'

type Tag = { id: string }
const tags: Tag[] = JSON.parse(
  readFileSync(join(DIR, '../01-jev-tag-eval/tags-tokyo-z14.json'), 'utf8'),
).tags

const state = {
  task: '地図上の場所（POI）に付いた OpenStreetMap のタグを、利用者が指定した「Lens（見方）」に照らして評価する。',
  lens: LENS,
  notes: [
    'タグは "key=value" 形式で、その場所が何であるか（分類）、何を扱うか（細分）、どのブランドかを表す。',
    'Lens はその場所を検索する条件ではなく、地図全体を眺めるときの観点である。Lens に沿う場所は浮かび上がり、反する場所は沈み、無関係な場所は変化しない。',
    'Lens の言葉と字面が似ていることは、関係がある理由にはならない。',
    'Lens が「〜ではない」「〜向けでない」と除外を述べている場合、除外された性質を持つ場所は Lens に反する側である。',
  ],
}

/** 実験 01 の choice-v3 と同じ文言。ここを変えると 01 の結果と比べられなくなる。 */
function choiceQuestion(tagId: string): Record<string, unknown> {
  return {
    type: 'choice',
    instructions: `タグ「${tagId}」を持つ場所は、この Lens に対してどういう意味で関わるか。最も当てはまるものを選ぶ。迷ったら「無関係」を選ぶ。`,
    criteria: {
      主役: 'その場所自体が Lens の対象であり、Lens が指す性質をそのまま持っている。',
      脇役: 'Lens の対象そのものではないが、Lens の目的を果たすのに実際に役立つ設備・サービス・店。「役立つ」と言い切れる場合だけ選ぶ。',
      背景: 'Lens の対象ではなく役立つわけでもないが、周囲の雰囲気・景観として Lens の性質を強める。',
      妨げ: 'Lens の目的にとって邪魔になる、または避けたい場所。',
      無関係: 'Lens とは関係がない。',
    },
  }
}

function questions(n: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const t of tags.slice(0, n)) out[t.id] = choiceQuestion(t.id)
  return out
}

type Route = { id: string; url: string; headers: Record<string, string>; body: (q: Record<string, unknown>) => unknown }

const ROUTES: Route[] = [
  {
    id: 'v4-evaluation-model（実験 01 の現行）',
    url: 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model',
    headers: { 'ai-gateway-protocol-version': '0.0.1', 'ai-gateway-auth-method': 'api-key', 'ai-model-id': MODEL_ID },
    body: (q) => ({ state, questions: q }),
  },
  {
    id: 'v1-evaluate（Gateway ネイティブ）',
    url: 'https://ai-gateway.vercel.sh/v1/evaluate',
    headers: {},
    body: (q) => ({ model: MODEL_ID, state, questions: q }),
  },
  {
    id: 'typesafe-systemone（互換）',
    url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
    headers: {},
    body: (q) => ({ model: MODEL_ID, state, questions: q }),
  },
]

async function call(route: Route, q: Record<string, unknown>) {
  const body = JSON.stringify(route.body(q))
  const started = performance.now()
  const res = await fetch(route.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...route.headers },
    body,
  })
  const text = await res.text()
  let json: unknown = text
  try { json = JSON.parse(text) } catch { /* 非 JSON のエラー本文はそのまま残す */ }
  return { status: res.status, json, latencyMs: performance.now() - started, requestBytes: Buffer.byteLength(body) }
}

/** 429 / 503 / 529 は上流の混雑。実験 01 と同じく指数バックオフで待つ。 */
async function callWithRetry(route: Route, q: Record<string, unknown>, maxAttempts = 7) {
  let r = await call(route, q)
  for (let attempt = 1; attempt < maxAttempts && [429, 503, 529].includes(r.status); attempt++) {
    const wait = 2000 * 2 ** (attempt - 1)
    console.error(`    HTTP ${r.status} → ${wait / 1000}s 後に再試行 (${attempt}/${maxAttempts - 1})`)
    await new Promise((s) => setTimeout(s, wait))
    r = await call(route, q)
  }
  return r
}

function summarize(json: unknown): string {
  const b = json as { answers?: Record<string, unknown>; usage?: { inputTokens?: number }; model?: string; error?: unknown }
  if (b?.answers) {
    const n = Object.keys(b.answers).length
    const first = JSON.stringify(Object.values(b.answers)[0] ?? {}).slice(0, 90)
    return `回答 ${n} 件 / 入力 ${b.usage?.inputTokens?.toLocaleString() ?? '?'} tok / model=${b.model ?? '?'} / 例 ${first}`
  }
  return JSON.stringify(json).slice(0, 220)
}

const log: unknown[] = []

console.log('■ 1. 到達経路（Choice 5 問）')
const working: Route[] = []
for (const route of ROUTES) {
  const r = await callWithRetry(route, questions(5))
  log.push({ phase: 'route', route: route.id, status: r.status, latencyMs: Math.round(r.latencyMs), response: r.json })
  console.log(`  ${route.id}`)
  console.log(`    HTTP ${r.status} / ${Math.round(r.latencyMs)} ms / ${summarize(r.json)}`)
  if (r.status === 200) working.push(route)
}

// 予算は文書化されている経路で測る。v4 は model を返さないため（#6 のキャッシュ鍵に効く）。
const target = working.find((r) => r.id.startsWith('v1-evaluate')) ?? working[0]
if (!target) {
  console.error('\n200 を返す経路がないので予算の測定は行わない')
} else {
  console.log(`\n■ 2. リクエスト予算（${target.id} / Choice を増やす）`)
  console.log('  90 問 = 28,624 tok の実測から、32k 説なら約 100 問、64k 説なら約 200 問が上限')
  console.log('  503 は混雑を表すので、上限違反（4xx）と区別するため止めずに梯子を登り切る')
  for (const n of [100, 110, 130, 160, 190, 230]) {
    const r = await callWithRetry(target, questions(n))
    const tok = (r.json as { usage?: { inputTokens?: number } })?.usage?.inputTokens
    log.push({ phase: 'budget', questions: n, status: r.status, latencyMs: Math.round(r.latencyMs), inputTokens: tok, requestBytes: r.requestBytes, response: r.status === 200 ? '(省略)' : r.json })
    console.log(`  ${String(n).padStart(3)} 問 / ${(r.requestBytes / 1024).toFixed(0).padStart(3)} KiB : HTTP ${r.status} / ${String(Math.round(r.latencyMs)).padStart(5)} ms / ${summarize(r.json)}`)
    // 4xx は上限違反なので打ち切る。503 は混雑なので次の段も試す
    if (r.status >= 400 && r.status < 500) break
  }
}

mkdirSync(join(DIR, 'results'), { recursive: true })
const out = join(DIR, 'results', `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(out, JSON.stringify(log, null, 1))
console.log(`\n生ログ: ${out.replace(DIR, '')}`)
