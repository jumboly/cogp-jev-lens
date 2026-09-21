# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.3"]
# ///
"""
タグ方針 v1（docs/tag-policy.md）に従って、JEV 評価対象の `key=value` 許可リストを生成する。

なぜ許可リストか: 1 回しか出ないペアが 191 万ある一方、上位 1 万ペアで出現の 91% を覆う。
ビューポート内のペアを無条件に JEV へ送るとタイポ・独自値に無駄なリクエストが出る。
世界での出現回数 ≥ 閾値 のペアだけを静的に持ち、正規化辞書・説明文・キャッシュ鍵の置き場も兼ねる。

なぜ `;` 分解をここで行うか: `cuisine=japanese;ramen` のような複数値を 1 値ずつに割ると
種類数が 1/5 になり、順序違いも同一視できる。分解後の値で出現回数を数える。

    uv run scripts/build_allowlist.py [data/pois.cogp.parquet] [data-dist/tag-allowlist.v1.json] [100]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "data/pois.cogp.parquet")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "data-dist/tag-allowlist.v1.json")
MIN_COUNT = int(sys.argv[3] if len(sys.argv) > 3 else 100)
OUT.parent.mkdir(parents=True, exist_ok=True)

# docs/tag-policy.md「評価対象キー」と一致させる
CATEGORY_KEYS = [
    "amenity", "shop", "tourism", "leisure", "historic", "healthcare", "office", "craft",
    "man_made", "natural", "public_transport", "railway", "aeroway", "emergency", "attraction",
    "club", "place", "highway", "building", "landuse",
]
REFINE_KEYS = [
    "cuisine", "religion", "denomination", "information", "vending", "sport",
    "artwork_type", "memorial", "archaeological_site", "historic:civilization",
    "board_type", "shelter_type", "parking", "bicycle_parking", "recycling_type",
    "social_facility", "social_facility:for", "healthcare:speciality",
    "waste", "clothes", "swimming_pool",
]
BRAND_KEYS = ["brand"]
# 分類キー・細分キーの「種別不明値」。ブランド名には適用しない（"Yes" というブランドは無いが念のため）
UNKNOWN_VALUES = ["yes", "no"]

all_keys = CATEGORY_KEYS + REFINE_KEYS + BRAND_KEYS
klist = ",".join(f"'{k}'" for k in all_keys)
blist = ",".join(f"'{k}'" for k in BRAND_KEYS)

con = duckdb.connect()
con.execute("SET memory_limit = '4GB'")
con.execute("SET preserve_insertion_order = false")

# ブランド名は固有名なので大文字小文字を保つ（表示にも使う）。それ以外は OSM トークンなので小文字化する。
rows = con.execute(
    f"""
WITH pairs AS (
  SELECT e.key AS key, e.value AS raw
  FROM (SELECT unnest(map_entries(tags)) AS e FROM read_parquet('{SRC}'))
  WHERE e.key IN ({klist})
),
split AS (
  SELECT key,
         CASE WHEN key IN ({blist}) THEN trim(raw)
              ELSE lower(trim(unnest(string_split(raw, ';')))) END AS value
  FROM pairs
)
SELECT key, value, count(*) AS n
FROM split
WHERE value <> ''
  AND NOT (key NOT IN ({blist}) AND value IN ({",".join(f"'{v}'" for v in UNKNOWN_VALUES)}))
GROUP BY key, value
HAVING count(*) >= {MIN_COUNT}
ORDER BY key, n DESC
"""
).fetchall()

# 全体（閾値なし）の出現数も取り、カバー率を出す
total = con.execute(
    f"""
WITH pairs AS (
  SELECT e.key AS key, e.value AS raw
  FROM (SELECT unnest(map_entries(tags)) AS e FROM read_parquet('{SRC}'))
  WHERE e.key IN ({klist})
)
SELECT key, count(*) FROM pairs GROUP BY key
"""
).fetchall()
total_by_key = dict(total)

entries = {}
by_key: dict[str, dict] = {}
for key, value, n in rows:
    entries[f"{key}={value}"] = {"key": key, "value": value, "count": n}
    bk = by_key.setdefault(key, {"pairs": 0, "covered": 0})
    bk["pairs"] += 1
    bk["covered"] += n

role = {k: "category" for k in CATEGORY_KEYS} | {k: "refine" for k in REFINE_KEYS} | {k: "brand" for k in BRAND_KEYS}
keys_meta = {
    k: {
        "role": role[k],
        "pairs": by_key.get(k, {}).get("pairs", 0),
        "occurrences_total": total_by_key.get(k, 0),
        # 分解後の出現数は分解前の総数を超え得るので、上限 1.0 に丸める
        "coverage": min(1.0, by_key.get(k, {}).get("covered", 0) / total_by_key[k]) if total_by_key.get(k) else 0,
    }
    for k in all_keys
}

doc = {
    "schema": "cogp-jev-lens/tag-allowlist",
    "version": 1,
    "source": "COGP v1.0.0 pois.cogp.parquet (OpenStreetMap, ODbL)",
    "policy": "docs/tag-policy.md",
    "min_count": MIN_COUNT,
    "normalization": {
        "split": ";",
        "lowercase": "all keys except brand",
        "trim": True,
        "drop_values": UNKNOWN_VALUES,
    },
    "keys": keys_meta,
    "entries": entries,
}
OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1))

print(f"wrote {OUT}  entries={len(entries):,}  size={OUT.stat().st_size/1024:.0f} KiB")
print(f"{'key':<24}{'role':<10}{'pairs':>8}{'occurrences':>14}{'coverage':>10}")
for k, m in sorted(keys_meta.items(), key=lambda kv: -kv[1]["occurrences_total"]):
    print(f"{k:<24}{m['role']:<10}{m['pairs']:>8,}{m['occurrences_total']:>14,}{m['coverage']:>10.3f}")
