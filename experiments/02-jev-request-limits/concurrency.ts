/**
 * 実験 02 の続き: バッチ 90 を何本まで同時に投げられるか。
 *
 * 逐次だと z14 の冷えた Lens は 21 リクエスト × 約 0.9 秒で約 19 秒かかる。
 * 並列にできれば大幅に縮むが、130 問以上のリクエストが混雑時に弾かれた実測から、
 * 上流は負荷に応じて受け付けを絞っている疑いがある。同時実行も同じ性質なら
 * 並列度を上げるほど 503 が増え、再試行で結局遅くなる。
 *
 * 再試行を入れずに「1 回目で通ったか」を測る。再試行込みの所要は成功率から逆算できるが、
 * 素の受け入れ率を見ないと原因が混雑かサイズか並列度か分からないため。
 *
 *   node --env-file=.env experiments/02-jev-request-limits/concurrency.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('.', import.meta.url).pathname
const apiKey = process.env['AI_GATEWAY_API_KEY']
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY がない')

const URL_ = 'https://ai-gateway.vercel.sh/v1/evaluate'
const MODEL_ID = 'typesafe-ai/jev'
const BATCH = 90
const LEVELS = [1, 2, 4, 8]
const ROUNDS = 2
/** 前の山の影響を残さないための間隔。 */
const COOLDOWN_MS = 8000

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

function questions(offset: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // タグ数は 623。offset が一周しても同じ山の中で重複しないよう剰余で回す
  for (let i = 0; i < BATCH; i++) {
    const t = tags[(offset + i) % tags.length]!
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

async function once(offset: number) {
  const started = performance.now()
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_ID, state, questions: questions(offset) }),
  })
  await res.arrayBuffer()
  return { status: res.status, ms: performance.now() - started }
}

const rows: { c: number; ok: number; tried: number; wallMs: number[]; statuses: number[] }[] = []
console.log(`バッチ ${BATCH} 問を同時に投げる。再試行なし。各並列度 ${ROUNDS} 回`)
console.log(`${'並列'.padStart(5)}${'成功'.padStart(8)}${'全部揃うまで'.padStart(14)}${'1本あたり中央値'.padStart(18)}   内訳`)

for (const c of LEVELS) {
  let ok = 0
  const wall: number[] = []
  const statuses: number[] = []
  const each: number[] = []
  for (let r = 0; r < ROUNDS; r++) {
    const t0 = performance.now()
    const results = await Promise.all(
      Array.from({ length: c }, (_, i) => once((r * 8 + i) * BATCH)),
    )
    wall.push(performance.now() - t0)
    for (const x of results) {
      statuses.push(x.status)
      each.push(x.ms)
      if (x.status === 200) ok++
    }
    await new Promise((s) => setTimeout(s, COOLDOWN_MS))
  }
  rows.push({ c, ok, tried: c * ROUNDS, wallMs: wall, statuses })
  const med = [...each].sort((a, b) => a - b)[Math.floor(each.length / 2)] ?? NaN
  const wallMed = [...wall].sort((a, b) => a - b)[Math.floor(wall.length / 2)] ?? NaN
  const counts = statuses.reduce<Record<number, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {})
  console.log(
    `${String(c).padStart(5)}${(ok + '/' + c * ROUNDS).padStart(8)}` +
    `${(Math.round(wallMed) + ' ms').padStart(14)}${(Math.round(med) + ' ms').padStart(18)}   ` +
    Object.entries(counts).map(([s, n]) => `${s}×${n}`).join(' '),
  )
}

mkdirSync(join(DIR, 'results'), { recursive: true })
const out = join(DIR, 'results', `concurrency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(out, JSON.stringify(rows, null, 1))
console.log(`\n生ログ: ${out.replace(DIR, '')}`)
