# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.3"]
# ///
"""
profile_tags.py の補足。本体は値展開を「近似ユニーク値数 ≤ 20,000 のキー」に絞ったため、
`cuisine`（`;` 区切りの組み合わせで見かけ上 5.8 万種）や `brand`（7.3 万種）のように
JEV 評価上は重要だが高カーディナリティに見えるキーの値が出ていない。
ここでは対象キーを名指しし、`;` で分解した上での分布も出す。

    uv run scripts/profile_tags_extra.py [data/pois.cogp.parquet] [reports/tag-profile]
"""
from __future__ import annotations

import sys
from pathlib import Path

import duckdb

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "data/pois.cogp.parquet")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "reports/tag-profile")

# `;` 分解の効果を見たいキー（本体で展開されなかった/複数値が多いもの）
SPLIT_KEYS = ["cuisine", "sport", "brand", "clothes", "healthcare:speciality", "vending", "waste", "diet"]
# 値そのものの上位を見たいだけのキー
TOP_KEYS = ["name", "brand", "operator", "addr:country", "name:ja", "denomination", "artwork_type",
            "memorial", "board_type", "shelter_type", "parking", "recycling_type", "location",
            "building", "public_transport", "railway", "emergency", "natural", "place", "highway",
            "landuse", "attraction", "club", "aeroway", "network", "colour", "material"]

con = duckdb.connect()
con.execute("SET memory_limit = '4GB'")
con.execute("SET preserve_insertion_order = false")
con.execute(f"SET temp_directory = '{(OUT / '.duckdb-tmp').resolve()}'")

con.execute(
    f"""
CREATE TABLE pairs AS
SELECT e.key AS key, e.value AS value
FROM (SELECT unnest(map_entries(tags)) AS e FROM read_parquet('{SRC}'))
WHERE e.key IN ({",".join("'" + k + "'" for k in set(SPLIT_KEYS + TOP_KEYS))})
"""
)


def copy(q: str, name: str) -> None:
    con.execute(f"COPY ({q}) TO '{OUT / name}' (HEADER, DELIMITER ',')")
    print("wrote", name, flush=True)


tk = ",".join("'" + k + "'" for k in TOP_KEYS)
copy(
    f"""
SELECT key, value, n
FROM (SELECT key, value, count(*) AS n, row_number() OVER (PARTITION BY key ORDER BY count(*) DESC) AS rk
      FROM pairs WHERE key IN ({tk}) GROUP BY key, value)
WHERE rk <= 40 ORDER BY key, n DESC
""",
    "extra_top_values.csv",
)

sk = ",".join("'" + k + "'" for k in SPLIT_KEYS)
copy(
    f"""
SELECT key,
       count(*) AS n,
       count(DISTINCT value) AS nd_raw,
       count(DISTINCT lower(trim(value))) AS nd_lower,
       sum((value LIKE '%;%')::int) AS n_multi
FROM pairs WHERE key IN ({sk}) GROUP BY key ORDER BY n DESC
""",
    "extra_split_keys_summary.csv",
)
copy(
    f"""
SELECT key, part, n, nd_after_split
FROM (
  SELECT key, part, count(*) AS n,
         count(DISTINCT part) OVER (PARTITION BY key) AS nd_after_split,
         row_number() OVER (PARTITION BY key ORDER BY count(*) DESC) AS rk
  FROM (SELECT key, lower(trim(unnest(string_split(value, ';')))) AS part FROM pairs WHERE key IN ({sk}))
  WHERE part <> ''
  GROUP BY key, part)
WHERE rk <= 40 ORDER BY key, n DESC
""",
    "extra_split_top_parts.csv",
)
# 分解後のユニーク数（ウィンドウを使わず正確に）
copy(
    f"""
SELECT key, count(DISTINCT part) AS nd_after_split, count(*) AS parts_total
FROM (SELECT key, lower(trim(unnest(string_split(value, ';')))) AS part FROM pairs WHERE key IN ({sk}))
WHERE part <> '' GROUP BY key ORDER BY key
""",
    "extra_split_distinct.csv",
)
print("done")
