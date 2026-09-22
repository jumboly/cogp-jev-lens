/**
 * 実験 02 の続き: 「7 バッチを片付けるのに一番速い並列度」を測る。
 *
 * 再試行なしの受け入れ率は並列度 1 でも 5 割ほどで、並列度の差がノイズに埋もれた。
 * 知りたいのは受け入れ率そのものではなく「仕事が終わるまでの時間」なので、
 * 再試行込みで 7 バッチ（z14 の 1 プリミティブ分 = 623 タグ ÷ 90）を完了させ、
 * 壁時計時間と総試行回数を測る。
 *
 * 503 に retry-after が付くかも記録する。付くなら指数バックオフより従う方が速い。
 *
 *   node --env-file=.env experiments/02-jev-request-limits/throughput.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('.', import.meta.url).pathname
const apiKey = process.env['AI_GATEWAY_API_KEY']
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY がない')

const URL_ = 'https://ai-gateway.vercel.sh/v1/evaluate'
const MODEL_ID = 'typesafe-ai/jev'
const BATCH = 90
const BATCHES = 7
const LEVELS = [1, 2, 4, 8]
const REPS = 2
const COOLDOWN_MS = 8000
/** 受け入れ率が 5 割なので、最初の待ちは短く刻む。混雑は数百 ms で解けることが多い。 */
const BACKOFF_MS = [300, 700, 1500, 3000, 6000, 12000]

const tags: { id: string }[] = JSON.parse(
  readFileSync(join(DIR, '../01-jev-tag-eval/tags-tokyo-z14.json'), 'utf8'),
).tags

const state = {
  task: '地図上の場所（POI）に付いた OpenStreetMap のタグを、利用者が指定した「Lens（見方）」に照らして評価する。',
  lens: '観光客が興味を持ちそう',
  notes: [
    'タグは "key=value" 形式で、その場所が何であるか（分類）、何を扱うか（細分）、どのブランドかを表す。',
    'Lens はその場所を検索する条件ではなく、地図全体を眺めるときの観点である。Lens に沿う場所は浮かび上がり、反する場所は沈み、無関係な場所は変化しない。',
    'Lens の言葉と字面が似ていることは、関係がある理由にはならない。',
    'Lens が「〜ではない」「〜向けでない」と除外を述べている場合、除外された性質を持つ場所は Lens に反する側である。',
  ],
}

function questions(batchIndex: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < BATCH; i++) {
    const t = tags[(batchIndex * BATCH + i) % tags.length]!
    out[t.id] = {
      type: 'choice',
      instructions: `タグ「${t.id}」を持つ場所は、この Lens に対してどういう意味で関わるか。最も当てはまるものを選ぶ。迷ったら「無関係」を選ぶ。`,
      criteria: {
        主役: 'その場所自体が Lens の対象であり、Lens が指す性質をそのまま持っている。',
        脇役: 'Lens の対象そのものではないが、Lens の目的を果たすのに実際に役立つ設備・サービス・店。「役立つ」と言い切れる場合だけ選ぶ。',
        背景: 'Lens の対象ではなく役立つわけでもないが、周囲の雰囲気・景観として Lens の性質を強める。',
        妨げ: 'Lens の目的にとって邪魔になる、または避けたい場所。',
        無関係: 'Lens とは関係がない。',
      },
    }
  }
  return out
}

let retryAfterSeen: string[] = []
let attempts = 0

async function once(batchIndex: number) {
  attempts++
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_ID, state, questions: questions(batchIndex) }),
  })
  const ra = res.headers.get('retry-after')
  if (ra) retryAfterSeen.push(`${res.status}:${ra}`)
  await res.arrayBuffer()
  return res.status
}

async function withRetry(batchIndex: number): Promise<boolean> {
  for (let i = 0; i <= BACKOFF_MS.length; i++) {
    const status = await once(batchIndex)
    if (status === 200) return true
    if (![429, 503, 529].includes(status)) return false
    if (i < BACKOFF_MS.length) {
      // ジッタを入れて、同時に投げた本が一斉に再試行して再び弾かれるのを避ける
      const wait = BACKOFF_MS[i]! * (0.7 + Math.random() * 0.6)
      await new Promise((s) => setTimeout(s, wait))
    }
  }
  return false
}

/** 並列度 c を保ちながら BATCHES 本を流す。 */
async function run(c: number): Promise<{ ms: number; ok: number; attempts: number }> {
  attempts = 0
  const t0 = performance.now()
  let next = 0
  let ok = 0
  const workers = Array.from({ length: c }, async () => {
    for (;;) {
      const i = next++
      if (i >= BATCHES) return
      if (await withRetry(i)) ok++
    }
  })
  await Promise.all(workers)
  return { ms: performance.now() - t0, ok, attempts }
}

console.log(`${BATCHES} バッチ（${BATCH} 問 × ${BATCHES} = ${BATCH * BATCHES} タグ）を再試行込みで片付ける`)
console.log(`${'並列'.padStart(5)}${'所要 中央値'.padStart(14)}${'完了'.padStart(8)}${'総試行'.padStart(9)}${'1バッチ試行'.padStart(13)}   各回`)
const rows: unknown[] = []
for (const c of LEVELS) {
  const runs: { ms: number; ok: number; attempts: number }[] = []
  for (let r = 0; r < REPS; r++) {
    runs.push(await run(c))
    await new Promise((s) => setTimeout(s, COOLDOWN_MS))
  }
  const ms = runs.map((x) => x.ms).sort((a, b) => a - b)
  const med = ms[Math.floor(ms.length / 2)]!
  const ok = runs.reduce((s, x) => s + x.ok, 0)
  const at = runs.reduce((s, x) => s + x.attempts, 0)
  rows.push({ c, runs })
  console.log(
    `${String(c).padStart(5)}${(Math.round(med) + ' ms').padStart(14)}` +
    `${(ok + '/' + BATCHES * REPS).padStart(8)}${String(at).padStart(9)}${(at / (BATCHES * REPS)).toFixed(1).padStart(13)}   ` +
    runs.map((x) => Math.round(x.ms) + 'ms').join(', '),
  )
}
console.log(`\nretry-after ヘッダ: ${retryAfterSeen.length ? [...new Set(retryAfterSeen)].join(' ') : '一度も付かなかった'}`)

mkdirSync(join(DIR, 'results'), { recursive: true })
const out = join(DIR, 'results', `throughput-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(out, JSON.stringify(rows, null, 1))
console.log(`生ログ: ${out.replace(DIR, '')}`)
