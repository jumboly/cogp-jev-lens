/**
 * 実験 03: 落ちる境界は「問数」か「トークン量」か。
 *
 * 実験 02 は Choice で「90 問は通る、130 問以上は落ちやすい」と測ったが、
 * 測定は上流の障害中で、しかも Choice しか試していない。1 問あたりのトークンは
 * プリミティブで倍以上違う（Choice 316 / Score 182 / Noul 153 トークン）ので、
 * 境界がトークン量なら Score と Noul はもっと積める（#4 の改善案 1）。
 *
 * 決定的な比較は **Score 130 問（約 24k）と Choice 130 問（約 41k）**。
 * 問数が同じでトークン量が 1.7 倍違うので、どちらが効いているかが分かれる。
 * あわせて改善案が積みたい量（Score 159 / Noul 190、どちらも約 29k）を直接試す。
 *
 * 再試行はしない。「投げて通るか」の率を見たいので、バックオフで成功に持ち込むと
 * 何も測れない（実験 02 の 4 節と同じ立場）。上流の障害と条件の効果を切り分けるため、
 * **毎ラウンド Choice 90 問（100% 通った実績のあるサイズ）を対照に挟む**。
 * 対照が落ちるラウンドは上流が不調なので、集計から外して別に数える。
 *
 *   node --env-file=.env experiments/03-batch-boundary/probe.ts [--rounds 4]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildQuestion, buildState, type Primitive } from '../../src/server/questions.ts'

const DIR = new URL('.', import.meta.url).pathname
const apiKey = process.env['AI_GATEWAY_API_KEY']
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY がない')

const ENDPOINT = 'https://ai-gateway.vercel.sh/v1/evaluate'
const MODEL_ID = 'typesafe-ai/jev'
const ROUNDS = Number(process.argv[process.argv.indexOf('--rounds') + 1]) || 4
/** 対照。実験 02 で全実行 100% 通ったサイズ。 */
const CONTROL = 'choice-90'

interface Condition {
  key: string
  primitive: Primitive
  n: number
  /** なぜこの条件を測るか。 */
  why: string
}

const CONDITIONS: Condition[] = [
  { key: CONTROL, primitive: 'choice', n: 90, why: '対照（現行のバッチサイズ）' },
  { key: 'choice-130', primitive: 'choice', n: 130, why: '実験 02 で落ちやすかったサイズ' },
  { key: 'score-130', primitive: 'score', n: 130, why: '問数は choice-130 と同じ、トークンは 0.6 倍' },
  { key: 'noul-130', primitive: 'noul', n: 130, why: '同（トークンは 0.5 倍）' },
  { key: 'score-159', primitive: 'score', n: 159, why: '改善案 1 が積みたい量' },
  { key: 'noul-190', primitive: 'noul', n: 190, why: '同' },
]

const tags: { id: string }[] = JSON.parse(
  readFileSync(join(DIR, '../01-jev-tag-eval/tags-tokyo-z14.json'), 'utf8'),
).tags

const state = buildState('観光客が興味を持ちそう')

/** 毎回違うタグを使う。同じ質問の使い回しで上流が速くなるのを避けるため（実験 02 の作法）。 */
function questions(c: Condition, offset: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < c.n; i++) {
    const tag = tags[(offset + i) % tags.length]!.id
    out[tag] = buildQuestion(tag, c.primitive)
  }
  return out
}

interface Attempt {
  round: number
  key: string
  status: number
  ms: number
  tokens: number | null
  /**
   * リクエスト本文のバイト数。
   * トークン数とバイト数はプリミティブ間で比例しない（日本語の criteria の文体が違う）。
   * どちらが境界なのかを後から切り分けられるよう、両方残す。
   */
  bytes: number
  /** 上流の追跡 ID。問い合わせるときの手がかり。 */
  generationId: string | null
}

async function once(c: Condition, offset: number, round: number): Promise<Attempt> {
  const body = JSON.stringify({ model: MODEL_ID, state, questions: questions(c, offset) })
  const started = performance.now()
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(60_000),
    })
    const json = (await res.json().catch(() => null)) as {
      usage?: { inputTokens?: number }
      error?: { type?: string }
      providerMetadata?: { gateway?: { generationId?: string } }
    } | null
    return {
      round,
      key: c.key,
      status: res.status,
      ms: performance.now() - started,
      tokens: json?.usage?.inputTokens ?? null,
      bytes: new TextEncoder().encode(body).length,
      generationId: json?.providerMetadata?.gateway?.generationId ?? null,
    }
  } catch (err) {
    // タイムアウト・接続断は status 0 で残す。上流の不調と区別できるように。
    console.error(`  ${c.key}: ${(err as Error).name}`)
    return {
      round,
      key: c.key,
      status: 0,
      ms: performance.now() - started,
      tokens: null,
      bytes: new TextEncoder().encode(body).length,
      generationId: null,
    }
  }
}

const attempts: Attempt[] = []

for (let round = 0; round < ROUNDS; round++) {
  // ラウンドごとに順序をずらす。「後の条件ほど混む」交絡を条件に固定させない。
  const order = [...CONDITIONS.slice(round % CONDITIONS.length), ...CONDITIONS.slice(0, round % CONDITIONS.length)]
  // 対照は必ず先頭に置く。そのラウンドの上流の機嫌を先に記録するため。
  const control = CONDITIONS.find((c) => c.key === CONTROL)!
  const sequence = [control, ...order.filter((c) => c.key !== CONTROL)]

  console.log(`\n--- ラウンド ${round + 1}/${ROUNDS} ---`)
  for (const c of sequence) {
    const a = await once(c, round * 97, round)
    attempts.push(a)
    console.log(
      `${c.key.padEnd(12)} ${String(a.status).padStart(3)} ${(a.tokens?.toLocaleString() ?? '?').padStart(7)} tok ${Math.round(a.ms).toString().padStart(6)} ms`,
    )
    // 上流に息継ぎを入れる。連投そのものが 429 を誘発すると条件の比較にならない。
    await new Promise((s) => setTimeout(s, 2500))
  }
}

// ---- 集計 ----

const healthy = new Set(
  attempts.filter((a) => a.key === CONTROL && a.status === 200).map((a) => a.round),
)
console.log(
  `\n対照（${CONTROL}）が通ったラウンド: ${healthy.size}/${ROUNDS}` +
    (healthy.size < ROUNDS ? '（残りは上流が不調とみなして集計から外す）' : ''),
)

console.log(`\n${'条件'.padEnd(12)}${'入力tok'.padStart(9)}${'成功'.padStart(8)}${'中央値'.padStart(9)}  理由`)
const summary = CONDITIONS.map((c) => {
  const rows = attempts.filter((a) => a.key === c.key && healthy.has(a.round))
  const ok = rows.filter((a) => a.status === 200)
  const ms = ok.map((a) => a.ms).sort((x, y) => x - y)
  const tokens = rows.find((a) => a.tokens !== null)?.tokens ?? null
  const median = ms.length > 0 ? ms[Math.floor(ms.length / 2)]! : NaN
  console.log(
    `${c.key.padEnd(12)}${(tokens?.toLocaleString() ?? '?').padStart(9)}${`${ok.length}/${rows.length}`.padStart(8)}` +
      `${(Number.isNaN(median) ? '—' : `${Math.round(median)} ms`).padStart(9)}  ${c.why}`,
  )
  const statuses: Record<string, number> = {}
  for (const a of rows) statuses[a.status] = (statuses[a.status] ?? 0) + 1
  return { ...c, tokens, ok: ok.length, tried: rows.length, medianMs: median, statuses }
})

mkdirSync(join(DIR, 'results'), { recursive: true })
const out = join(DIR, 'results', `boundary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(out, JSON.stringify({ rounds: ROUNDS, healthyRounds: [...healthy], summary, attempts }, null, 1))
console.log(`\n生ログ: ${out.replace(DIR, '')}`)
