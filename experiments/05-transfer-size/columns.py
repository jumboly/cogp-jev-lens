# /// script
# requires-python = ">=3.12"
# dependencies = ["pyarrow>=17"]
# ///
"""
表示範囲が触る row group の、カラム別サイズを Parquet メタデータから出す。

なぜメタデータからか: #9 の「転送量の 9 割が tags」は全体を見た概算で、
実際に読むのは表示範囲が触る row group だけ。列を絞って縮むかどうかは
「その row group 群の中で tags が何割か」で決まるので、そこを実測する。

読み取りの実バイト数は read.ts 側で測る（ページ境界と Range 結合が乗るため、
メタデータの合計とは一致しない）。ここで出すのは上限の目安。

    uv run experiments/05-transfer-size/columns.py [--zoom 14] [--width 1280] [--height 800]
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pyarrow.parquet as pq

SRC = Path("data/pois.cogp.parquet")

# main.ts の INITIAL_VIEW（東京駅周辺）。段階 9 までの実測がすべてこの地点。
DEFAULT_CENTER = (139.7671, 35.6812)
# cogp-worker.ts の RESOLUTION_MARGIN。整数ズームで 1 段粗い側に落ちるのを防ぐ。
RESOLUTION_MARGIN = 0.999


def viewport_bbox(lon: float, lat: float, zoom: float, width: int, height: int):
    """MapLibre の getBounds() と同じ範囲を Web メルカトルで出す。"""
    world = 512 * 2**zoom
    deg_per_px = 360.0 / world
    half_lon = width / 2 * deg_per_px
    # 緯度は Mercator y 上で等間隔になるので、y に直してから戻す。
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * world
    def y_to_lat(py: float) -> float:
        n = math.pi * (1 - 2 * py / world)
        return math.degrees(math.atan(math.sinh(n)))
    return (lon - half_lon, y_to_lat(y + height / 2), lon + half_lon, y_to_lat(y - height / 2)), deg_per_px


def select_level(levels: list[dict], target: float) -> int:
    """level.ts の selectLevelByResolution と同じ規則。"""
    chosen = -1
    for i, lv in enumerate(levels):
        if lv["resolution"] >= target:
            chosen = i
        else:
            break
    return 0 if chosen == -1 else chosen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lon", type=float, default=DEFAULT_CENTER[0])
    ap.add_argument("--lat", type=float, default=DEFAULT_CENTER[1])
    ap.add_argument("--zoom", type=float, default=14)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=800)
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args()

    meta = pq.ParquetFile(SRC).metadata
    geo = json.loads(meta.metadata[b"geo"])
    levels = geo["lod"]["levels"]

    bbox, deg_per_px = viewport_bbox(args.lon, args.lat, args.zoom, args.width, args.height)
    level = select_level(levels, deg_per_px * RESOLUTION_MARGIN)
    end = levels[level]["row_group_end"]

    xmin, ymin, xmax, ymax = bbox
    per_column: dict[str, int] = {}
    hit_rgs, hit_rows = 0, 0
    for i in range(end + 1):
        rg = meta.row_group(i)
        stats = {}
        for c in range(rg.num_columns):
            col = rg.column(c)
            stats[".".join(col.path_in_schema) if isinstance(col.path_in_schema, list) else col.path_in_schema] = col
        # covering bbox の統計で交差判定（reader.ts の rowGroupIntersects と同じ）
        bx = {k: stats[f"bbox.{k}"].statistics for k in ("xmin", "ymin", "xmax", "ymax")}
        if not all(bx.values()):
            continue
        if not (bx["xmax"].max >= xmin and bx["xmin"].min <= xmax and bx["ymax"].max >= ymin and bx["ymin"].min <= ymax):
            continue
        hit_rgs += 1
        hit_rows += rg.num_rows
        for name, col in stats.items():
            per_column[name] = per_column.get(name, 0) + col.total_compressed_size

    total = sum(per_column.values())
    print(f"視点 z{args.zoom:g} {args.width}x{args.height} @ ({args.lon}, {args.lat})")
    print(f"bbox = [{xmin:.6f}, {ymin:.6f}, {xmax:.6f}, {ymax:.6f}]  deg/px = {deg_per_px:.8g}")
    print(f"レベル L{level}（row group 0..{end}）→ 交差 {hit_rgs} 本 / 行数 {hit_rows:,}")
    print(f"交差 row group のカラム合計（圧縮後）: {total / 1024 / 1024:.1f} MiB\n")
    print(f"{'カラム':<22}{'圧縮後':>12}{'割合':>8}")
    for name, size in sorted(per_column.items(), key=lambda kv: -kv[1]):
        print(f"{name:<22}{size / 1024 / 1024:>10.1f} MiB{size / total * 100:>7.1f}%")
    tags = sum(v for k, v in per_column.items() if k.startswith("tags."))
    print(f"\ntags 合計 {tags / 1024 / 1024:.1f} MiB = {tags / total * 100:.1f}%")
    print(f"tags 以外 {(total - tags) / 1024 / 1024:.1f} MiB = {(total - tags) / total * 100:.1f}%")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps({
            "zoom": args.zoom, "width": args.width, "height": args.height,
            "center": [args.lon, args.lat], "bbox": list(bbox), "level": level,
            "rowGroups": hit_rgs, "rows": hit_rows, "perColumn": per_column,
        }, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
