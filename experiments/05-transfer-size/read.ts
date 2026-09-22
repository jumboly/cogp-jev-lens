/**
 * 実験 05: 列を絞ると読み取りのバイト数は本当に縮むか。
 *
 * #9 に「転送量の 9 割が tags なので、読む列を絞れば縮む見込み」と書いたが、
 * これは根拠を測っていない。Lens には tags が要るので「tags を落として縮める」は
 * そもそも選べず、縮むとすれば tags 以外（id / geometry / bbox）の側になる。
 * 先にどこに何バイト使っているかを測って、#5 の独自スキーマに進むか決める。
 *
 * ブラウザと同じ経路で測るため、ローカルファイルを AsyncBuffer にして
 * **coalescing → rangeCache の順で同じラッパを被せ、一番内側（= ネットワークが
 * 見る層）でバイト数を数える**。ラッパの外で数えるとキャッシュ命中分と
 * Range 結合の水増しが混ざる。
 *
 * `--no-coalesce` を付けると Range 結合を外す。結合は隙間を埋めて読むので、
 * 付けた実行との差が「結合が足したバイト数」になる（= 本当に要るページの量が出る）。
 *
 *   node --experimental-transform-types experiments/05-transfer-size/read.ts [--zoom 14] [--no-coalesce]
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

/** main.ts の INITIAL_VIEW。段階 9 までの実測がすべてこの地点。 */
const CENTER: [number, number] = [139.7671, 35.6812]
/** cogp-worker.ts と同じ値。 */
const RESOLUTION_MARGIN = 0.999
const MAX_ROWS = 30_000

/** 測る列の組み合わせ。bbox は絞り込みに要るのでリーダーが自動で足す。 */
const CASES: { name: string; columns?: string[] }[] = [
  { name: '現行（全列）', columns: undefined },
  { name: 'id + geometry + tags', columns: ['id', 'geometry', 'tags'] },
  { name: 'geometry + tags（id を落とす）', columns: ['geometry', 'tags'] },
  { name: 'id + geometry（tags を落とす）', columns: ['id', 'geometry'] },
  { name: 'geometry のみ', columns: ['geometry'] },
  { name: 'bbox のみ（件数カウント経路）', columns: ['bbox'] },
]

interface Counter {
  bytes: number
  slices: number
}

/** ローカルファイルを hyparquet の AsyncBuffer にし、実際に読んだ範囲を数える。 */
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

function viewportBbox(zoom: number, width: number, height: number) {
  const world = 512 * 2 ** zoom
  const degPerPx = 360 / world
  const [lon, lat] = CENTER
  const rad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world
  const yToLat = (py: number) => {
    const n = Math.PI * (1 - (2 * py) / world)
    return (Math.atan(Math.sinh(n)) * 180) / Math.PI
  }
  return {
    bbox: [lon - (width / 2) * degPerPx, yToLat(y + height / 2), lon + (width / 2) * degPerPx, yToLat(y - height / 2)] as [number, number, number, number],
    degPerPx,
  }
}

const args = process.argv.slice(2)
const argOf = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}
const noCoalesce = args.includes('--no-coalesce')
const zoom = argOf('zoom', 14)
const width = argOf('width', 1280)
const height = argOf('height', 800)

const { bbox, degPerPx } = viewportBbox(zoom, width, height)
const results: Record<string, unknown>[] = []

console.log(`視点 z${zoom} ${width}x${height} @ (${CENTER[0]}, ${CENTER[1]})${noCoalesce ? '  Range 結合なし' : ''}`)
console.log(`bbox = [${bbox.map((v) => v.toFixed(6)).join(', ')}]\n`)

for (const testCase of CASES) {
  // なぜ毎回開き直すか: Range キャッシュを跨がせると 2 回目以降がただの命中になる。
  const counter: Counter = { bytes: 0, slices: 0 }
  const { handle, buffer } = await countingBuffer(SRC, counter)
  const reader = await CogpReader.fromAsyncBuffer(
    rangeCachedAsyncBuffer(noCoalesce ? buffer : coalescingAsyncBuffer(buffer)) as never,
  )
  const openBytes = counter.bytes
  const openSlices = counter.slices
  const level = Math.max(
    0,
    Math.min(reader.geo.lod.levels.length - 1, reader.selectLevel(degPerPx * RESOLUTION_MARGIN)),
  )

  const startedAt = performance.now()
  const rows = await reader.readRows({ bbox, maxLevel: level, maxRows: MAX_ROWS, columns: testCase.columns })
  const elapsedMs = performance.now() - startedAt
  await handle.close()

  const readBytes = counter.bytes - openBytes
  results.push({
    case: testCase.name,
    columns: testCase.columns ?? null,
    level,
    rows: rows.length,
    openBytes,
    openSlices,
    readBytes,
    readSlices: counter.slices - openSlices,
    elapsedMs,
  })
  console.log(
    `${testCase.name.padEnd(30)} ${(readBytes / 1024 / 1024).toFixed(1).padStart(7)} MiB` +
      `  ${String(counter.slices - openSlices).padStart(5)} 回` +
      `  ${elapsedMs.toFixed(0).padStart(6)} ms` +
      `  ${rows.length.toLocaleString().padStart(7)} 件`,
  )
}

const baseline = results[0]!['readBytes'] as number
console.log(`\nfooter 読み（開くときの固定費）: ${((results[0]!['openBytes'] as number) / 1024).toFixed(0)} KiB / ${results[0]!['openSlices']} 回`)
console.log('\n現行を 100% としたときの読み取りバイト数')
for (const r of results) {
  console.log(`${String(r['case']).padEnd(30)} ${(((r['readBytes'] as number) / baseline) * 100).toFixed(1).padStart(6)}%`)
}

mkdirSync(OUT, { recursive: true })
const outPath = join(OUT, `read-z${zoom}${noCoalesce ? '-nocoalesce' : ''}.json`)
writeFileSync(outPath, JSON.stringify({ zoom, width, height, center: CENTER, bbox, coalescing: !noCoalesce, results }, null, 2))
console.log(`\n→ ${outPath}`)
