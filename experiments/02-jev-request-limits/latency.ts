/**
 * 実験 02 の続き: バッチサイズとレイテンシの関係を測る。
 *
 * 予算は 64k と確かめた（190 問 = 59,824 tok は 200、230 問は max_tokens_exceeded で 400）。
 * 残る問いは「予算いっぱいまで積むのが速いか」。公式ドキュメントは「質問を足しても
 * 応答時間はほとんど変わらない」と書くが、根拠の実測は 13 問での比較だった。
 * 探りでは 100 問 1.1 秒に対し 190 問 7.3 秒で、頭打ちが続かない疑いがある。
 *
 * 各サイズを 3 回ずつ測り中央値を取る。上流が混むので 503 はバックオフで待ち、
 * 待ち時間は計測から除く（純粋な応答時間を見たいため）。
 *
 *   node --env-file=.env experiments/02-jev-request-limits/latency.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('.', import.meta.url).pathname
const apiKey = process.env['AI_GATEWAY_API_KEY']
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY がない')

const URL_ = 'https://ai-gateway.vercel.sh/v1/evaluate'
const MODEL_ID = 'typesafe-ai/jev'
// 梯子を登る順に測ると「後半ほど混む」交絡が入る。順序を引数で逆にできるようにして、
// 大きいバッチの失敗がサイズ由来か順序由来かを切り分ける。
const SIZES = process.argv.includes('--reverse') ? [190, 130, 90, 45] : [45, 90, 130, 190]
const REPS = Number(process.argv[process.argv.indexOf('--reps') + 1]) || 3

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

function questions(n: number, offset: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const t of tags.slice(offset, offset + n)) {
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

async function once(n: number, offset: number) {
  const body = JSON.stringify({ model: MODEL_ID, state, questions: questions(n, offset) })
  const started = performance.now()
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
  })
  const json = (await res.json().catch(() => null)) as { usage?: { inputTokens?: number } } | null
  return { status: res.status, ms: performance.now() - started, tok: json?.usage?.inputTokens }
}

async function measure(n: number, offset: number) {
  for (let attempt = 0; attempt < 7; attempt++) {
    const r = await once(n, offset)
    if (r.status === 200) return r
    if (![429, 503, 529].includes(r.status)) return r
    await new Promise((s) => setTimeout(s, 2000 * 2 ** attempt))
  }
  return { status: 0, ms: NaN, tok: undefined }
}

const rows: { n: number; ms: number[]; tok?: number; ok: number; tried: number }[] = []
console.log(`順序: ${SIZES.join(' → ')}`)
console.log(`${'問数'.padStart(5)}${'入力tok'.padStart(10)}${'中央値'.padStart(9)}${'1問あたり'.padStart(11)}${'成功'.padStart(7)}   各回`)
for (const n of SIZES) {
  const ms: number[] = []
  let ok = 0
  let tok: number | undefined
  for (let i = 0; i < REPS; i++) {
    // 毎回違うタグを使う。同じ質問の使い回しで上流が速くなるのを避けるため
    const r = await measure(n, i * 200)
    if (r.status === 200) { ms.push(r.ms); tok = r.tok; ok++ }
    else console.error(`  ${n} 問 ${i + 1} 回目: HTTP ${r.status} で断念`)
    await new Promise((s) => setTimeout(s, 1500))
  }
  rows.push({ n, ms, tok, ok, tried: REPS })
  const sorted = [...ms].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)] ?? NaN
  console.log(
    `${String(n).padStart(5)}${(tok?.toLocaleString() ?? '?').padStart(10)}${(Math.round(med) + ' ms').padStart(9)}` +
    `${(med / n).toFixed(1).padStart(8)} ms${(ok + '/' + REPS).padStart(7)}   ${ms.map((v) => Math.round(v)).join(', ')}`,
  )
}

mkdirSync(join(DIR, 'results'), { recursive: true })
const out = join(DIR, 'results', `latency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(out, JSON.stringify(rows, null, 1))
console.log(`\n生ログ: ${out.replace(DIR, '')}`)
