# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.3"]
# ///
"""
指定 bbox の POI から、許可リスト（tag-allowlist）を通ったユニークタグを抽出する。

なぜローカルの Parquet から取るか: JEV 実験の目的はタグ評価の性質を見ることで、
COGP の Range 読みは別マイルストーンで作る。ここでは同じ結果になる最短経路（DuckDB）を使う。
なぜ LOD レベルで絞るか: 実際のアプリは表示ズームに応じたレベルまでしか読まない。
z14 なら L12〜L13 相当なので、その条件で見えるタグ集合に合わせる。

    uv run scripts/extract_viewport_tags.py <xmin> <ymin> <xmax> <ymax> <max_level> <out.json>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb

xmin, ymin, xmax, ymax = map(float, sys.argv[1:5])
max_level = int(sys.argv[5])
out = Path(sys.argv[6])
SRC = "data/pois.cogp.parquet"
allow = json.loads(Path("data-dist/tag-allowlist.v1.json").read_text())
brand_keys = {k for k, m in allow["keys"].items() if m["role"] == "brand"}
keys = list(allow["keys"])

con = duckdb.connect()
geo = json.loads(con.execute(f"SELECT decode(value) FROM parquet_kv_metadata('{SRC}') WHERE key='geo'").fetchone()[0])
rg_end = geo["lod"]["levels"][max_level]["row_group_end"]
rg_rows = con.execute(f"SELECT row_group_id, max(row_group_num_rows) FROM parquet_metadata('{SRC}') GROUP BY 1 ORDER BY 1").fetchall()
row_limit = sum(n for _, n in rg_rows[: rg_end + 1])

pois = con.execute(
    f"""
SELECT id, tags
FROM read_parquet('{SRC}', file_row_number = true)
WHERE file_row_number < {row_limit}
  AND bbox.xmin BETWEEN {xmin} AND {xmax} AND bbox.ymin BETWEEN {ymin} AND {ymax}
"""
).fetchall()

def normalize(key: str, raw: str) -> list[str]:
    if key in brand_keys:
        return [raw.strip()]
    return [p.strip().lower() for p in raw.split(";") if p.strip()]

tag_count: dict[str, int] = {}
poi_tags: dict[int, list[str]] = {}
dropped: dict[str, int] = {}
names: dict[str, list[str]] = {}
for pid, tags in pois:
    kept = []
    for k, v in (tags or {}).items():
        if k not in allow["keys"]:
            continue
        for part in normalize(k, v):
            tid = f"{k}={part}"
            if tid in allow["entries"]:
                kept.append(tid)
                tag_count[tid] = tag_count.get(tid, 0) + 1
                nm = (tags or {}).get("name:ja") or (tags or {}).get("name")
                if nm and len(names.setdefault(tid, [])) < 3 and nm not in names[tid]:
                    names[tid].append(nm)
            else:
                dropped[tid] = dropped.get(tid, 0) + 1
    poi_tags[pid] = kept

tags_sorted = sorted(tag_count.items(), key=lambda kv: -kv[1])
doc = {
    "bbox": [xmin, ymin, xmax, ymax],
    "max_level": max_level,
    "pois": len(pois),
    "pois_with_tags": sum(1 for v in poi_tags.values() if v),
    "unique_tags": len(tag_count),
    "dropped_by_allowlist": len(dropped),
    "tags": [
        {"id": t, "key": t.split("=", 1)[0], "value": t.split("=", 1)[1], "count": n,
         "role": allow["keys"][t.split("=", 1)[0]]["role"], "sample_names": names.get(t, [])}
        for t, n in tags_sorted
    ],
    "dropped_top": sorted(dropped.items(), key=lambda kv: -kv[1])[:40],
}
out.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
by_role = {}
for t in doc["tags"]:
    by_role[t["role"]] = by_role.get(t["role"], 0) + 1
print(f"POI {len(pois):,} / タグ付き {doc['pois_with_tags']:,} / ユニークタグ {len(tag_count)} {by_role} / 許可リスト外 {len(dropped)} 種")
