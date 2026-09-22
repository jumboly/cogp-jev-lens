/**
 * 実験 04 の突き合わせ: 現行版（full）と削減版（slim）の答えがどれだけ違うか。
 *
 *   node experiments/04-question-slimming/compare.ts
 *
 * 見るのは 3 つ。
 * - **ずれの大きさ**（Noul / Score の平均差と平均絶対差）。系統的に上下するのか、
 *   ばらつくだけなのかを分けたいので、符号付きの差と絶対差の両方を出す
 * - **判断が変わるか**（Score の 3 値化と Choice の最尤が一致する率）。
 *   地図の見え方は「浮く / 沈む / 変えない」と色に落ちるので、そこが一致するかが実務の基準
 * - **入力トークンがどれだけ減るか**（バッチごとの実測）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CHOICE_OPTIONS, PRIMITIVES, type Primitive } from '../../src/server/questions.ts'

const DIR = new URL('.', import.meta.url).pathname
const OUT = join(DIR, 'results', 'answers.jsonl')

interface Row {
  lens: string
  primitive: Primitive
  variant: 'full' | 'slim'
  batch: number
  status: number
  inputTokens: number | null
  answers: Record<string, Record<string, unknown>> | null
}

const rows: Row[] = readFileSync(OUT, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Row)
  .filter((r) => r.status === 200 && r.answers)

/** (lens, primitive, variant) → タグ → 値。 */
const table = new Map<string, Map<string, number | number[]>>()
for (const r of rows) {
  const key = `${r.lens}|${r.primitive}|${r.variant}`
  const bucket = table.get(key) ?? new Map<string, number | number[]>()
  for (const [tag, answer] of Object.entries(r.answers!)) {
    const value = read(r.primitive, answer)
    if (value !== undefined) bucket.set(tag, value)
  }
  table.set(key, bucket)
}

function read(primitive: Primitive, answer: Record<string, unknown>): number | number[] | undefined {
  if (primitive === 'noul') return typeof answer['probability'] === 'number' ? answer['probability'] : undefined
  if (primitive === 'score') return typeof answer['score'] === 'number' ? answer['score'] : undefined
  const p = answer['probabilities'] as Record<string, number> | undefined
  return p ? CHOICE_OPTIONS.map((name) => p[name] ?? 0) : undefined
}

/** 地図の見え方に落ちる 3 値。浮く / 沈む / 変えない。 */
function bucket3(score: number): number {
  if (score > 2.1) return 1
  if (score < 1.9) return -1
  return 0
}

function argmax(values: number[]): number {
  let best = 0
  for (let i = 1; i < values.length; i++) if (values[i]! > values[best]!) best = i
  return best
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx
    const dy = ys[i]! - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxy / Math.sqrt(sxx * syy)
}

const lensIds = [...new Set(rows.map((r) => r.lens))]
const summary: Record<string, unknown>[] = []

console.log('### 答えのずれ\n')
console.log(`${'Lens'.padEnd(7)}${'種別'.padEnd(8)}${'比較数'.padStart(7)}${'平均差'.padStart(9)}${'平均|差|'.padStart(10)}${'相関'.padStart(7)}${'判断一致'.padStart(10)}`)

for (const lens of lensIds) {
  for (const primitive of PRIMITIVES as readonly Primitive[]) {
    const full = table.get(`${lens}|${primitive}|full`)
    const slim = table.get(`${lens}|${primitive}|slim`)
    if (!full || !slim) continue

    const shared = [...full.keys()].filter((t) => slim.has(t))
    if (shared.length === 0) continue

    let sum = 0
    let absSum = 0
    let agree = 0
    const xs: number[] = []
    const ys: number[] = []

    for (const tag of shared) {
      const a = full.get(tag)!
      const b = slim.get(tag)!
      if (typeof a === 'number' && typeof b === 'number') {
        sum += b - a
        absSum += Math.abs(b - a)
        xs.push(a)
        ys.push(b)
        // Noul は「確信度」なので 3 値化の概念がない。Score だけ向きの一致を見る。
        if (primitive === 'score' && bucket3(a) === bucket3(b)) agree++
        if (primitive === 'noul') agree++
      } else if (Array.isArray(a) && Array.isArray(b)) {
        // Choice は分布どうしの L1 距離（0〜2）と最尤の一致。
        let l1 = 0
        for (let i = 0; i < a.length; i++) l1 += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
        sum += l1
        absSum += l1
        xs.push(a[argmax(a)]!)
        ys.push(b[argmax(a)]!)
        if (argmax(a) === argmax(b)) agree++
      }
    }

    const n = shared.length
    const label = primitive === 'choice' ? 'choice(L1)' : primitive
    console.log(
      `${lens.padEnd(7)}${label.padEnd(8)}${String(n).padStart(7)}` +
        `${(sum / n).toFixed(3).padStart(9)}${(absSum / n).toFixed(3).padStart(10)}` +
        `${pearson(xs, ys).toFixed(3).padStart(7)}` +
        `${primitive === 'noul' ? '—'.padStart(10) : `${((agree / n) * 100).toFixed(1)}%`.padStart(10)}`,
    )
    summary.push({
      lens,
      primitive,
      n,
      meanDiff: sum / n,
      meanAbsDiff: absSum / n,
      correlation: pearson(xs, ys),
      agreement: primitive === 'noul' ? null : agree / n,
    })
  }
}

// ---- Noul は「比」で見る ----
//
// Noul は見え方に出ず、POI 内で最大値で割った重みとしてしか使わない（#7）。
// 全タグが一律に上がっても重みは変わらないので、絶対値のずれではなく
// 「タグ間の比がどれだけ変わるか」が実務の基準になる。
console.log('\n### Noul の比のずれ（POI 内の重みに効くのはこちら）\n')
console.log(`${'Lens'.padEnd(7)}${'対の数'.padStart(8)}${'比の相対誤差 中央値'.padStart(20)}${'90 パーセンタイル'.padStart(18)}`)

/** 再現できるようにしたいだけなので、簡単な線形合同法で足りる。 */
function lcg(seed: number): () => number {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

const ratios: Record<string, unknown>[] = []
for (const lens of lensIds) {
  const full = table.get(`${lens}|noul|full`)
  const slim = table.get(`${lens}|noul|slim`)
  if (!full || !slim) continue
  const shared = [...full.keys()].filter((t) => slim.has(t))
  const rand = lcg(20260922)
  const errors: number[] = []
  for (let i = 0; i < 4000; i++) {
    const a = shared[Math.floor(rand() * shared.length)]!
    const b = shared[Math.floor(rand() * shared.length)]!
    if (a === b) continue
    const fa = full.get(a) as number
    const fb = full.get(b) as number
    const sa = slim.get(a) as number
    const sb = slim.get(b) as number
    // 0 割りを避ける。確信度 0 のタグは重みも 0 なので比較の対象にしない。
    if (!fb || !sb || !fa || !sa) continue
    const fr = fa / fb
    errors.push(Math.abs(sa / sb - fr) / fr)
  }
  errors.sort((x, y) => x - y)
  const median = errors[Math.floor(errors.length / 2)] ?? NaN
  const p90 = errors[Math.floor(errors.length * 0.9)] ?? NaN
  console.log(
    `${lens.padEnd(7)}${String(errors.length).padStart(8)}${`${(median * 100).toFixed(1)}%`.padStart(20)}${`${(p90 * 100).toFixed(1)}%`.padStart(18)}`,
  )
  ratios.push({ lens, pairs: errors.length, medianRelError: median, p90RelError: p90 })
}

// ---- 集約まで通したときのずれ ----
//
// 比が 10 数% 動いても、それが地図に出るかは別。#7 の集約式（確信度で加重した平均）に
// 通して、**POI の Score がどれだけ動くか**を見る。評価対象タグが 1 個の POI は
// 正規化で重みが必ず 1 になるので影響を受けない。効くのは 2 個以上の POI
// （東京駅周辺で 46%）なので、2 タグの POI を想定して測る。
console.log('\n### Noul だけ削減版にしたときの集約 Score のずれ（2 タグの POI を想定）\n')
console.log(`${'Lens'.padEnd(7)}${'対の数'.padStart(8)}${'中央値'.padStart(9)}${'90%'.padStart(9)}${'最大'.padStart(9)}${'3 値一致'.padStart(10)}`)

const aggregated: Record<string, unknown>[] = []
for (const lens of lensIds) {
  const noulFull = table.get(`${lens}|noul|full`)
  const noulSlim = table.get(`${lens}|noul|slim`)
  const scores = table.get(`${lens}|score|full`)
  if (!noulFull || !noulSlim || !scores) continue
  const shared = [...noulFull.keys()].filter((t) => noulSlim.has(t) && scores.has(t))
  const rand = lcg(20260923)
  const diffs: number[] = []
  let agree = 0

  const mix = (sA: number, sB: number, nA: number, nB: number): number => {
    const max = Math.max(nA, nB)
    if (max <= 0) return (sA + sB) / 2
    const wA = nA / max
    const wB = nB / max
    return (sA * wA + sB * wB) / (wA + wB)
  }

  for (let i = 0; i < 4000; i++) {
    const a = shared[Math.floor(rand() * shared.length)]!
    const b = shared[Math.floor(rand() * shared.length)]!
    if (a === b) continue
    const sA = scores.get(a) as number
    const sB = scores.get(b) as number
    const f = mix(sA, sB, noulFull.get(a) as number, noulFull.get(b) as number)
    const s = mix(sA, sB, noulSlim.get(a) as number, noulSlim.get(b) as number)
    diffs.push(Math.abs(s - f))
    if (bucket3(f) === bucket3(s)) agree++
  }
  diffs.sort((x, y) => x - y)
  const median = diffs[Math.floor(diffs.length / 2)] ?? NaN
  const p90 = diffs[Math.floor(diffs.length * 0.9)] ?? NaN
  const max = diffs[diffs.length - 1] ?? NaN
  console.log(
    `${lens.padEnd(7)}${String(diffs.length).padStart(8)}${median.toFixed(3).padStart(9)}${p90.toFixed(3).padStart(9)}` +
      `${max.toFixed(3).padStart(9)}${`${((agree / diffs.length) * 100).toFixed(1)}%`.padStart(10)}`,
  )
  aggregated.push({ lens, pairs: diffs.length, medianDiff: median, p90Diff: p90, maxDiff: max, agreement: agree / diffs.length })
}

console.log('\n### 入力トークン\n')
console.log(`${'種別'.padEnd(8)}${'現行'.padStart(9)}${'削減版'.padStart(9)}${'削減率'.padStart(8)}${'1問あたり'.padStart(11)}`)
const tokens: Record<string, unknown>[] = []
for (const primitive of PRIMITIVES as readonly Primitive[]) {
  const pick = (variant: string) =>
    rows.filter((r) => r.primitive === primitive && r.variant === variant && r.inputTokens)
  const mean = (list: Row[]) => list.reduce((a, r) => a + (r.inputTokens ?? 0), 0) / (list.length || 1)
  const f = mean(pick('full'))
  const s = mean(pick('slim'))
  if (!f || !s) continue
  console.log(
    `${primitive.padEnd(8)}${Math.round(f).toLocaleString().padStart(9)}${Math.round(s).toLocaleString().padStart(9)}` +
      `${`${(((f - s) / f) * 100).toFixed(0)}%`.padStart(8)}${`${(f / 90).toFixed(0)} → ${(s / 90).toFixed(0)}`.padStart(11)}`,
  )
  tokens.push({ primitive, full: f, slim: s, reduction: (f - s) / f })
}

const path = join(DIR, 'results', 'compare.json')
writeFileSync(path, JSON.stringify({ summary, ratios, aggregated, tokens }, null, 1))
console.log(`\n${path.replace(DIR, '')} に保存した`)
