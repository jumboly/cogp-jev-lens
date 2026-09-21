/**
 * 実験 01: OSM タグを JEV で Lens に照らして評価する。
 *
 * 目的は「Noul / Score / Choice をどう使い分けるか」「タグをトークンのまま渡すか説明文を添えるか」
 * を、実際の出力分布で判断すること。結果は生 JSON のまま results/ に残す（後から問い方を直すときの一次資料）。
 *
 * なぜ 1 リクエストに複数タグを束ねるか: JEV は同じ state に対する複数の質問を独立・並列に評価する。
 * Lens を state に置き、タグごとの質問を並べれば、1 Lens あたり数百タグを十数リクエストで評価できる。
 *
 *   node --env-file=.env experiments/01-jev-tag-eval/run.ts [--primitive noul|score|choice] [--repr token|described] [--lens kids] [--limit 50] [--dry]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('.', import.meta.url).pathname
const ENDPOINT = 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model'
const MODEL_ID = 'typesafe-ai/jev'
const BATCH = 40

type Tag = { id: string; key: string; value: string; count: number; role: 'category' | 'refine' | 'brand'; sample_names: string[] }
type Lens = { id: string; text: string; negative?: boolean }
type Primitive = 'noul' | 'score' | 'choice'
type Repr = 'token' | 'described'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[++i])
}
const primitives: Primitive[] = args.has('primitive') ? [args.get('primitive') as Primitive] : ['noul', 'score', 'choice']
const reprs: Repr[] = args.has('repr') ? [args.get('repr') as Repr] : ['token', 'described']
const limit = args.has('limit') ? Number(args.get('limit')) : Infinity
const dry = args.get('dry') === 'true'

const apiKey = process.env.AI_GATEWAY_API_KEY
if (!apiKey && !dry) throw new Error('AI_GATEWAY_API_KEY が未設定です。.env に置いて node --env-file=.env で実行してください。')

const tagsDoc = JSON.parse(readFileSync(join(DIR, 'tags-tokyo-z14.json'), 'utf8')) as { tags: Tag[] }
const descriptions = existsSync(join(DIR, 'descriptions.json'))
  ? (JSON.parse(readFileSync(join(DIR, 'descriptions.json'), 'utf8')) as Record<string, { ja?: string | null; en?: string | null }>)
  : {}
const lenses = (JSON.parse(readFileSync(join(DIR, 'lenses.json'), 'utf8')) as Lens[]).filter((l) => !args.has('lens') || l.id === args.get('lens'))
const tags = tagsDoc.tags.slice(0, limit)

/** JEV に見せるタグの表現。described は OSM wiki の説明（日本語→英語の順で採用）を添える。 */
function represent(tag: Tag, repr: Repr): string {
  if (repr === 'token') return tag.id
  if (tag.role === 'brand') return `${tag.id}（ブランド名）`
  const d = descriptions[tag.id]
  const text = d?.ja ?? d?.en
  return text ? `${tag.id}（${text}）` : tag.id
}

/**
 * state は Lens と前提の共有部分。「言葉が似ている＝関係がある」の短絡と、否定形 Lens の取り違えを
 * ここで先回りして否定する。criteria は測りたい属性ではなく「地図上でどう扱うか」で書く。
 */
function buildState(lens: Lens): Record<string, unknown> {
  return {
    task: '地図上の場所（POI）に付いた OpenStreetMap のタグを、利用者が指定した「Lens（見方）」に照らして評価する。',
    lens: lens.text,
    notes: [
      'タグは "key=value" 形式で、その場所が何であるか（分類）、何を扱うか（細分）、どのブランドかを表す。',
      'Lens はその場所を検索する条件ではなく、地図全体を眺めるときの観点である。Lens に沿う場所は浮かび上がり、反する場所は沈み、無関係な場所は変化しない。',
      'Lens の言葉と字面が似ていることは、関係がある理由にはならない。',
      'Lens が「〜ではない」「〜向けでない」と除外を述べている場合、除外された性質を持つ場所は Lens に反する側である。',
    ],
  }
}

function buildQuestion(tag: Tag, repr: Repr, primitive: Primitive): Record<string, unknown> {
  const t = represent(tag, repr)
  switch (primitive) {
    case 'noul':
      return {
        type: 'boolean',
        instructions: `タグ「${t}」を持つ場所について、この Lens で地図を見るときに、このタグは判断材料として関係があるか。`,
        criteria: {
          true: 'このタグは Lens の判断材料として関係がある（Lens に沿う理由にも、反する理由にもなり得る）。',
          false: 'このタグは Lens と無関係で、この場所を浮かせるか沈めるかの判断に影響しない。',
        },
      }
    case 'score':
      return {
        type: 'score',
        instructions: `タグ「${t}」を持つ場所は、この Lens で地図を見るとき、どう扱うべきか。`,
        criteria: [
          'Lens に明確に反する。地図上で沈める。',
          'Lens にやや反する、または Lens の目的には不向き。やや沈める。',
          'Lens と無関係、または判断できない。変化させない。',
          'Lens に沿う。やや浮かせる。',
          'Lens をまさに体現する場所。最も浮かせる。',
        ],
      }
    case 'choice':
      return {
        type: 'choice',
        instructions: `タグ「${t}」を持つ場所は、この Lens に対してどういう意味で関わるか。最も当てはまるものを選ぶ。`,
        criteria: {
          目的地: 'Lens の目的そのものを果たす場所。ここへ行くことが目的になる。',
          立ち寄り先: 'Lens の目的の途中で立ち寄る、または補助的に役立つ場所。',
          雰囲気: 'それ自体が目的ではないが、周囲の雰囲気や景観として Lens に寄与する。',
          妨げ: 'Lens の目的にとって邪魔になる、または避けたい場所。',
          無関係: 'Lens とは関係がない。',
        },
      }
  }
}

async function callJev(state: unknown, questions: Record<string, unknown>): Promise<{ status: number; json: unknown; latencyMs: number }> {
  const started = performance.now()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'ai-gateway-protocol-version': '0.0.1',
      'ai-gateway-auth-method': 'api-key',
      'ai-model-id': MODEL_ID,
    },
    body: JSON.stringify({ state, questions }),
  })
  const text = await res.text()
  let json: unknown = text
  try { json = JSON.parse(text) } catch { /* 非 JSON のエラー本文はそのまま残す */ }
  return { status: res.status, json, latencyMs: performance.now() - started }
}

const outDir = join(DIR, 'results')
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')

for (const lens of lenses) {
  for (const repr of reprs) {
    for (const primitive of primitives) {
      const file = join(outDir, `${lens.id}.${repr}.${primitive}.jsonl`)
      const lines: string[] = []
      let usage = 0
      const state = buildState(lens)
      for (let i = 0; i < tags.length; i += BATCH) {
        const batch = tags.slice(i, i + BATCH)
        const questions: Record<string, unknown> = {}
        for (const tag of batch) questions[tag.id] = buildQuestion(tag, repr, primitive)
        if (dry) {
          if (i === 0) console.log(JSON.stringify({ state, questions: Object.fromEntries(Object.entries(questions).slice(0, 2)) }, null, 2))
          continue
        }
        // Gateway 経由では 429（上流の混雑）と 503（一時利用不可）が散発する。
        // 欠けたバッチはそのまま欠測になるので、指数バックオフで最大 6 回までやり直す。
        let r = await callJev(state, questions)
        for (let attempt = 1; attempt <= 6 && [429, 503, 529].includes(r.status); attempt++) {
          const wait = 2000 * 2 ** (attempt - 1)
          console.error(`  ${lens.id}/${repr}/${primitive} batch ${i / BATCH}: HTTP ${r.status} → ${wait / 1000}s 後に再試行 (${attempt}/6)`)
          await new Promise((res) => setTimeout(res, wait))
          r = await callJev(state, questions)
        }
        const body = r.json as { answers?: Record<string, unknown>; usage?: { inputTokens?: number }; model?: string }
        usage += body?.usage?.inputTokens ?? 0
        lines.push(JSON.stringify({ lens: lens.id, repr, primitive, batch: i / BATCH, status: r.status, latencyMs: Math.round(r.latencyMs), model: body?.model, request: { state, questions }, response: r.json }))
        if (r.status !== 200) console.error(`  ${lens.id}/${repr}/${primitive} batch ${i / BATCH}: HTTP ${r.status} で断念`, JSON.stringify(r.json).slice(0, 200))
        await new Promise((res) => setTimeout(res, 300)) // 連投を避ける
      }
      if (!dry) {
        writeFileSync(file, lines.join('\n') + '\n')
        console.log(`${lens.id.padEnd(18)} ${repr.padEnd(9)} ${primitive.padEnd(6)} ${tags.length} tags / ${lines.length} req / ${usage.toLocaleString()} input tokens  -> ${file.replace(DIR, '')}`)
      }
    }
  }
}
if (!dry) writeFileSync(join(outDir, `run-${stamp}.meta.json`), JSON.stringify({ tags: tags.length, lenses: lenses.map((l) => l.id), primitives, reprs, batch: BATCH }, null, 2))
