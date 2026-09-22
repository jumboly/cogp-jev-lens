/**
 * 実験 05 の 3 本目: なぜ範囲を狭めても転送量が落ちないのか。
 *
 * granularity.ts で「面積 1/1000 でも 12 MiB」と出た。リーダーは PageIndex で
 * ページ単位に絞っているはずなので、絞れていないとしたら **1 ページが粗い**か、
 * **ページの中身が空間的にまとまっていない**かのどちらか。ページの行数と、
 * bbox で選ばれる行の割合を並べれば分かれる。
 *
 * ここが「ページが粗い」なら変換時のページサイズで効く。「まとまっていない」なら
 * 並べ替え（空間順）が要る。#5 でどちらを作り直すかの入力になる。
 *
 * あわせて**辞書ページ**も数える。OffsetIndex はデータページしか載せないが、
 * 辞書は列チャンクごとに必ず読むので、読む量の内訳は
 * 「選ばれたデータページ + 候補 row group 全部の辞書」になる。
 *
 *   node --experimental-transform-types experiments/05-transfer-size/pages.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { prefetchPageIndexes } from 'hyparquet/src/plan.js'

import { registerTsJsResolution } from './ts-resolve.ts'

registerTsJsResolution()

const { CogpReader } = await import('../../src/vendor/cogp/index.ts')

const SRC = 'data/pois.cogp.parquet'
const OUT = 'experiments/05-transfer-size/results'
const CENTER: [number, number] = [139.7671, 35.6812]
const LEVEL = 13
/** granularity.ts と同じ縮め方。1x = z14 の 1280x800。 */
const SCALES = [1, 0.03125]

function scaledBbox(scale: number) {
  const world = 512 * 2 ** 14
  const degPerPx = 360 / world
  const [lon, lat] = CENTER
  const rad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world
  const yToLat = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / world))) * 180) / Math.PI
  const halfW = (1280 / 2) * degPerPx * scale
  const halfH = (800 / 2) * scale
  return { minX: lon - halfW, minY: yToLat(y + halfH), maxX: lon + halfW, maxY: yToLat(y - halfH) }
}

function bboxFilter(bbox: ReturnType<typeof scaledBbox>) {
  return {
    $and: [
      { 'bbox.xmin': { $lte: bbox.maxX } },
      { 'bbox.ymin': { $lte: bbox.maxY } },
      { 'bbox.xmax': { $gte: bbox.minX } },
      { 'bbox.ymax': { $gte: bbox.minY } },
    ],
  }
}

/** ローカルファイルを hyparquet の AsyncBuffer にする（転送量は read.ts 側で測るので数えない）。 */
const fh = await (await import('node:fs/promises')).open(SRC, 'r')
const { size } = await fh.stat()
const buffer = {
  byteLength: size,
  async slice(from: number, to?: number): Promise<ArrayBuffer> {
    const s = from < 0 ? size + from : from
    const e = to === undefined ? size : to < 0 ? size + to : to
    const len = Math.max(0, e - s)
    const buf = Buffer.alloc(len)
    if (len > 0) await fh.read(buf, 0, len, s)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + len)
  },
}
const reader = await CogpReader.fromAsyncBuffer(buffer)

const metadata = (reader as unknown as {
  metadata: {
    row_groups: {
      num_rows: number | bigint
      columns: { meta_data?: { path_in_schema: string[]; dictionary_page_offset?: number | bigint; data_page_offset: number | bigint } }[]
    }[]
  }
}).metadata
const file = (reader as unknown as { file: unknown }).file
const levels = reader.geo.lod.levels
const end = levels[LEVEL]!.row_group_end

/** row group 先頭の、ファイル全体での行番号。 */
const rowOffsets: number[] = []
{
  let acc = 0
  for (const rg of metadata.row_groups) {
    rowOffsets.push(acc)
    acc += Number(rg.num_rows)
  }
}
const rowStartOf = (rg: number): number => rowOffsets[rg]!

const report: Record<string, unknown>[] = []
for (const scale of SCALES) {
  const bbox = scaledBbox(scale)
  const rgIndices: number[] = []
  for (let i = 0; i <= end; i++) {
    const env = reader.rowGroupEnvelope(i)
    if (!env) continue
    if (env.maxX >= bbox.minX && env.minX <= bbox.maxX && env.maxY >= bbox.minY && env.minY <= bbox.maxY) {
      rgIndices.push(i)
    }
  }
  // rowStart / rowEnd はファイル全体での行番号。候補の行数を足すのではなく、
  // 最後の候補 row group の先頭 + その行数を取る（reader.ts と同じ）。
  const rowStart = rowStartOf(rgIndices[0]!)
  const last = rgIndices[rgIndices.length - 1]!
  const rowEnd = rowStartOf(last) + Number(metadata.row_groups[last]!.num_rows)

  const { pageRangesByGroup, pageLocationsByGroup } = await prefetchPageIndexes({
    file, metadata, filter: bboxFilter(bbox), rowStart, rowEnd,
  } as never) as { pageRangesByGroup: ([number, number][] | undefined)[]; pageLocationsByGroup: Record<string, { first_row_index: number | bigint }[]>[] }

  // ページの位置と大きさは PageLocation が持つ。範囲（pageRangesByGroup）は
  // row group 内の行番号で返るので、そのままページ span と突き合わせる。
  const perColumn = new Map<string, { pages: number; hitPages: number; bytes: number; hitBytes: number }>()
  let totalRows = 0
  let selectedRows = 0
  for (const rg of rgIndices) {
    const groupRows = Number(metadata.row_groups[rg]!.num_rows)
    totalRows += groupRows
    const ranges = pageRangesByGroup[rg]
    selectedRows += ranges ? ranges.reduce((a, [s2, e2]) => a + (e2 - s2), 0) : groupRows
    for (const [path, locs] of Object.entries(pageLocationsByGroup[rg] ?? {})) {
      const acc = perColumn.get(path) ?? { pages: 0, hitPages: 0, bytes: 0, hitBytes: 0 }
      for (let i = 0; i < locs.length; i++) {
        const loc = locs[i]!
        const pageStart = Number(loc.first_row_index)
        const pageEnd = i + 1 < locs.length ? Number(locs[i + 1]!.first_row_index) : groupRows
        const size = Number(loc.compressed_page_size ?? 0)
        acc.pages += 1
        acc.bytes += size
        const hit = ranges ? ranges.some(([s2, e2]) => s2 < pageEnd && e2 > pageStart) : true
        if (hit) {
          acc.hitPages += 1
          acc.hitBytes += size
        }
      }
      perColumn.set(path, acc)
    }
  }

  console.log(`\n辺 ${scale}x（L${LEVEL}、交差 row group ${rgIndices.length} 本）`)
  console.log(`  row group の全行 ${totalRows.toLocaleString()} → PageIndex が残した行 ${selectedRows.toLocaleString()} (${((selectedRows / totalRows) * 100).toFixed(1)}%)`)
  console.log(`  ${'カラム'.padEnd(22)}${'全ページ'.padStart(9)}${'読む'.padStart(7)}${'全体'.padStart(11)}${'読む量'.padStart(11)}${'1 ページ'.padStart(10)}`)
  let hitBytesAll = 0
  for (const [path, a] of [...perColumn].sort((x, y) => y[1].hitBytes - x[1].hitBytes)) {
    hitBytesAll += a.hitBytes
    console.log(
      `  ${path.padEnd(22)}${String(a.pages).padStart(9)}${String(a.hitPages).padStart(7)}` +
        `${`${(a.bytes / 1024 / 1024).toFixed(1)}M`.padStart(11)}${`${(a.hitBytes / 1024 / 1024).toFixed(1)}M`.padStart(11)}` +
        `${`${(a.bytes / a.pages / 1024).toFixed(0)}K`.padStart(10)}`,
    )
  }
  // 辞書ページは OffsetIndex に出てこないが、その列を読むなら必ず要る。
  // 大きさは dictionary_page_offset と data_page_offset の差で分かる。
  const dict = new Map<string, number>()
  let dictTotal = 0
  for (const rg of rgIndices) {
    for (const chunk of metadata.row_groups[rg]!.columns) {
      const m = chunk.meta_data
      if (!m?.dictionary_page_offset) continue
      const bytes = Number(m.data_page_offset) - Number(m.dictionary_page_offset)
      const path = m.path_in_schema.join('.')
      dict.set(path, (dict.get(path) ?? 0) + bytes)
      dictTotal += bytes
    }
  }
  console.log(`  選ばれたデータページ ${(hitBytesAll / 1024 / 1024).toFixed(1)} MiB`)
  console.log(`  辞書ページ（候補 row group の全列）${(dictTotal / 1024 / 1024).toFixed(1)} MiB`)
  for (const [path, bytes] of [...dict].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${path.padEnd(22)}${`${(bytes / 1024 / 1024).toFixed(2)} MiB`.padStart(11)}`)
  }
  console.log(`  合計 ${((hitBytesAll + dictTotal) / 1024 / 1024).toFixed(1)} MiB`)
  report.push({
    scale, rowGroups: rgIndices.length, totalRows, selectedRows,
    columns: Object.fromEntries(perColumn), hitBytes: hitBytesAll,
    dictionaryBytes: Object.fromEntries(dict), dictionaryTotal: dictTotal,
  })
}

mkdirSync(OUT, { recursive: true })
const outPath = join(OUT, 'pages.json')
writeFileSync(outPath, JSON.stringify({ level: LEVEL, center: CENTER, report }, null, 2))
console.log(`\n→ ${outPath}`)
await fh.close()
