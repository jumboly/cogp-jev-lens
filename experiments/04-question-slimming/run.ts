/**
 * 実験 04: 質問の定型部分を削ると出力が変わるか（#4 の改善案 2 の前提）。
 *
 * 入力を 54% 減らせる見込みがあるが、削るのは**判断基準の文言**なので出力が変わりうる。
 * 実験 01 は Choice の文言を v1〜v3 と詰めた経緯があり、基準の書き方が結果に効くことは
 * すでに分かっている。だから「削っても同じ判断が返るか」を測ってから決める。
 *
 * **実験 01 の保存結果とは比べない。** 01 は `/v4/ai/evaluation-model` 経由で、
 * いまの経路（`/v1/evaluate`）とは返る中身が違う（実験 02）。経路と時間帯の差が
 * 文言の差に混ざるので、**現行版と削減版を同じ実行の中で隣り合わせに投げる**。
 *
 * 欠測は比較できるタグを減らすだけなので、ここでは再試行する（実験 03 とは逆の立場）。
 * BFF と同じ `callJev` を通すので、再試行・分類・バックオフの挙動も本番と同じになる。
 * 途中で諦めても結果ファイルに追記済みのぶんは残り、もう一度走らせれば続きから埋まる。
 *
 *   node --env-file=.env experiments/04-question-slimming/run.ts [--tags 360] [--lenses kids,quiet]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { callJev } from '../../src/server/jev.ts'
import { PRIMITIVES, buildQuestion, buildState, type Primitive } from '../../src/server/questions.ts'
import { buildSlimQuestion } from './slim.ts'

const DIR = new URL('.', import.meta.url).pathname
const apiKey = process.env['AI_GATEWAY_API_KEY']
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY がない')

const BATCH_SIZE = 90
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const TAG_COUNT = Number(arg('--tags')) || 360
const LENS_IDS = (arg('--lenses') ?? 'kids,quiet').split(',')

const VARIANTS = ['full', 'slim'] as const
type Variant = (typeof VARIANTS)[number]

const lenses: { id: string; text: string }[] = JSON.parse(
  readFileSync(join(DIR, '../01-jev-tag-eval/lenses.json'), 'utf8'),
)
const tags: { id: string }[] = JSON.parse(
  readFileSync(join(DIR, '../01-jev-tag-eval/tags-tokyo-z14.json'), 'utf8'),
).tags

const targets = LENS_IDS.map((id) => {
  const lens = lenses.find((l) => l.id === id)
  if (!lens) throw new Error(`Lens ${id} が lenses.json にない`)
  return lens
})
const batches: string[][] = []
for (let i = 0; i < Math.min(TAG_COUNT, tags.length); i += BATCH_SIZE) {
  batches.push(tags.slice(i, i + BATCH_SIZE).map((t) => t.id))
}

mkdirSync(join(DIR, 'results'), { recursive: true })
const OUT = join(DIR, 'results', 'answers.jsonl')

/** 既に取れている組み合わせは投げ直さない（中断しても続きから埋められる）。 */
const doneKeys = new Set<string>()
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line) as { lens: string; primitive: string; variant: string; batch: number; status: number }
    if (r.status === 200) doneKeys.add(`${r.lens}|${r.primitive}|${r.variant}|${r.batch}`)
  }
  console.log(`保存済み: ${doneKeys.size} 件をスキップする`)
}

let ok = 0
let failed = 0
const startedAll = performance.now()

for (const lens of targets) {
  const state = buildState(lens.text)
  for (const primitive of PRIMITIVES as readonly Primitive[]) {
    for (const [batch, batchTags] of batches.entries()) {
      // 版の順序をバッチごとに入れ替える。「先に投げた方が有利」を版に固定させないため。
      const order: Variant[] = batch % 2 === 0 ? ['full', 'slim'] : ['slim', 'full']
      for (const variant of order) {
        const key = `${lens.id}|${primitive}|${variant}|${batch}`
        if (doneKeys.has(key)) continue

        const questions: Record<string, unknown> = {}
        for (const tag of batchTags) {
          questions[tag] = variant === 'full' ? buildQuestion(tag, primitive) : buildSlimQuestion(tag, primitive)
        }

        const r = await callJev({ apiKey, state, questions })
        const row = {
          at: new Date().toISOString(),
          lens: lens.id,
          primitive,
          variant,
          batch,
          tags: batchTags.length,
          status: r.ok ? 200 : (r.status ?? 0),
          kind: r.ok ? null : r.kind,
          inputTokens: r.ok ? r.inputTokens : null,
          attempts: r.attempts,
          ms: Math.round(r.elapsedMs),
          answers: r.ok ? r.answers : null,
        }
        appendFileSync(OUT, `${JSON.stringify(row)}\n`)

        if (r.ok) ok++
        else failed++
        console.log(
          `${lens.id.padEnd(6)} ${primitive.padEnd(6)} ${variant.padEnd(4)} #${batch} ` +
            `${row.status} ${(row.inputTokens?.toLocaleString() ?? '-').padStart(7)} tok ` +
            `${String(row.ms).padStart(6)} ms 試行 ${r.attempts}`,
        )
      }
    }
  }
}

console.log(
  `\n完了: 成功 ${ok} / 失敗 ${failed} / ${Math.round((performance.now() - startedAll) / 1000)} 秒`,
)
console.log(`結果: ${OUT.replace(DIR, '')}（比較は compare.ts）`)
