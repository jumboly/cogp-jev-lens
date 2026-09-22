/**
 * 実験 05 の 2 本目: 転送量を決めているのは「範囲の広さ」か「ページの粒度」か。
 *
 * read.ts で z12 / z14 / z16 のどれでも読み取りが 13〜14 MiB とほぼ同じになった。
 * 返る POI は 19,744 / 5,845 / 711 件と 28 倍違うのに転送量が動かないのは、
 * レベルが変わって別の row group を読んでいるからかもしれないし、
 * ページ粒度（1 件だけ要るページでもページ丸ごと来る）のせいかもしれない。
 *
 * **レベルを L13 に固定したまま bbox だけ縮める**と、この 2 つが分かれる。
 * 範囲の広さで決まるなら面積に比例して落ち、ページ粒度で決まるなら落ちない。
 *
 *   node --experimental-transform-types experiments/05-transfer-size/granularity.ts
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
/** z14 の 1280x800 を 1 倍として、面積を 1/4 ずつ落としていく。 */
const SCALES = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125]
const LEVEL = 13
const MAX_ROWS = 30_000

interface Counter { bytes: number; slices: number }

async function countingBuffer(path: string, counter: Counter) {
  const fh = await openFile(path, 'r')
  const { size } = await fh.stat()
  return {
    handle: fh,
    buffer: {
      byteLength: size,
      async slice(start: number, end?: number): Promise<ArrayBuffer> {
        const from = start < 0 ? size + start : start
        const to = end === undefined ? size : end < 0 ? size + end : end
        const length = Math.max(0, to - from)
        counter.bytes += length
        counter.slices += 1
        const buf = Buffer.alloc(length)
        if (length > 0) await fh.read(buf, 0, length, from)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + length)
      },
    },
  }
}

/** z14 1280x800 を基準に、中心を保ったまま辺の長さを scale 倍する。 */
function scaledBbox(scale: number): [number, number, number, number] {
  const world = 512 * 2 ** 14
  const degPerPx = 360 / world
  const [lon, lat] = CENTER
  const rad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world
  const yToLat = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / world))) * 180) / Math.PI
  const halfW = (1280 / 2) * degPerPx * scale
  const halfH = (800 / 2) * scale
  return [lon - halfW, yToLat(y + halfH), lon + halfW, yToLat(y - halfH)]
}

const results: Record<string, unknown>[] = []
console.log(`レベル L${LEVEL} 固定、bbox の辺を縮めていく（中心は東京駅）\n`)
console.log(`${'辺'.padEnd(8)}${'面積比'.padStart(8)}${'読み取り'.padStart(12)}${'Range'.padStart(8)}${'件数'.padStart(9)}${'KiB/件'.padStart(9)}`)

for (const scale of SCALES) {
  const counter: Counter = { bytes: 0, slices: 0 }
  const { handle, buffer } = await countingBuffer(SRC, counter)
  const reader = await CogpReader.fromAsyncBuffer(
    rangeCachedAsyncBuffer(coalescingAsyncBuffer(buffer)) as never,
  )
  const openBytes = counter.bytes
  const openSlices = counter.slices
  const bbox = scaledBbox(scale)
  const rows = await reader.readRows({ bbox, maxLevel: LEVEL, maxRows: MAX_ROWS })
  await handle.close()

  const readBytes = counter.bytes - openBytes
  results.push({
    scale, area: scale * scale, bbox, rows: rows.length,
    readBytes, readSlices: counter.slices - openSlices,
  })
  console.log(
    `${`${scale}x`.padEnd(8)}${(scale * scale).toFixed(4).padStart(8)}` +
      `${`${(readBytes / 1024 / 1024).toFixed(1)} MiB`.padStart(12)}` +
      `${String(counter.slices - openSlices).padStart(8)}` +
      `${rows.length.toLocaleString().padStart(9)}` +
      `${(readBytes / 1024 / Math.max(1, rows.length)).toFixed(1).padStart(9)}`,
  )
}

mkdirSync(OUT, { recursive: true })
const outPath = join(OUT, 'granularity.json')
writeFileSync(outPath, JSON.stringify({ level: LEVEL, center: CENTER, results }, null, 2))
console.log(`\n→ ${outPath}`)
