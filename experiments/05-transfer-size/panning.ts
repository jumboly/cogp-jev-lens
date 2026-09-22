/**
 * 実験 05 の 4 本目: 辞書ページの 9.3 MiB は「毎回」払うのか。
 *
 * リーダーは Range キャッシュ（既定 64 MiB・LRU）を挟んでいる。辞書は
 * row group ごとに同じ範囲なので、同じレベルを見ている限り 2 回目以降は
 * 命中するはず。そうなら固定費が効くのは初回だけで、#5 の優先度が変わる。
 *
 * 1 つのリーダーを開いたまま東京駅から少しずつ東へパンして、1 回ごとの
 * 読み取りバイト数を並べる。
 *
 *   node --experimental-transform-types experiments/05-transfer-size/panning.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import { join } from 'node:path'

import { registerTsJsResolution } from './ts-resolve.ts'

registerTsJsResolution()

const { CogpReader } = await import('../../src/vendor/cogp/index.ts')
const { coalescingAsyncBuffer } = await import('../../src/vendor/cogp/coalescing-buffer.ts')
const { rangeCachedAsyncBuffer } = await import('../../src/vendor/cogp/range-cache.ts')

const SRC = 'data/pois.cogp.parquet'
const OUT = 'experiments/05-transfer-size/results'
const CENTER: [number, number] = [139.7671, 35.6812]
const LEVEL = 13
const MAX_ROWS = 30_000
/** 画面 1 枚ぶんずつ東へ。8 回 = 東京駅から約 4.4 km。 */
const STEPS = 8

const counter = { bytes: 0, slices: 0 }
const fh = await openFile(SRC, 'r')
const { size } = await fh.stat()
const raw = {
  byteLength: size,
  async slice(from: number, to?: number): Promise<ArrayBuffer> {
    const s = from < 0 ? size + from : from
    const e = to === undefined ? size : to < 0 ? size + to : to
    const len = Math.max(0, e - s)
    counter.bytes += len
    counter.slices += 1
    const buf = Buffer.alloc(len)
    if (len > 0) await fh.read(buf, 0, len, s)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + len)
  },
}

const reader = await CogpReader.fromAsyncBuffer(
  rangeCachedAsyncBuffer(coalescingAsyncBuffer(raw)) as never,
)
console.log(`footer 読み ${(counter.bytes / 1024).toFixed(0)} KiB\n`)

const world = 512 * 2 ** 14
const degPerPx = 360 / world
const widthDeg = 1280 * degPerPx
const [lon, lat] = CENTER
const rad = (lat * Math.PI) / 180
const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world
const yToLat = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / world))) * 180) / Math.PI
const ymin = yToLat(y + 400)
const ymax = yToLat(y - 400)

const results: Record<string, unknown>[] = []
console.log(`${'回'.padEnd(5)}${'中心経度'.padStart(11)}${'読み取り'.padStart(12)}${'Range'.padStart(8)}${'件数'.padStart(9)}`)
for (let i = 0; i < STEPS; i++) {
  const before = counter.bytes
  const beforeSlices = counter.slices
  const centerLon = lon + widthDeg * i
  const rows = await reader.readRows({
    bbox: [centerLon - widthDeg / 2, ymin, centerLon + widthDeg / 2, ymax],
    maxLevel: LEVEL,
    maxRows: MAX_ROWS,
  })
  const bytes = counter.bytes - before
  results.push({ step: i, centerLon, bytes, slices: counter.slices - beforeSlices, rows: rows.length })
  console.log(
    `${String(i + 1).padEnd(5)}${centerLon.toFixed(4).padStart(11)}` +
      `${`${(bytes / 1024 / 1024).toFixed(2)} MiB`.padStart(12)}` +
      `${String(counter.slices - beforeSlices).padStart(8)}${rows.length.toLocaleString().padStart(9)}`,
  )
}
await fh.close()

const total = results.reduce((a, r) => a + (r['bytes'] as number), 0)
console.log(`\n${STEPS} 回の合計 ${(total / 1024 / 1024).toFixed(1)} MiB（毎回 1 回目と同じなら ${((results[0]!['bytes'] as number) * STEPS / 1024 / 1024).toFixed(1)} MiB）`)

mkdirSync(OUT, { recursive: true })
const outPath = join(OUT, 'panning.json')
writeFileSync(outPath, JSON.stringify({ level: LEVEL, center: CENTER, steps: STEPS, results }, null, 2))
console.log(`→ ${outPath}`)
