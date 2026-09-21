# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.3"]
# ///
"""
COGP POI サンプル（OSM 由来・3,005 万件）の `tags` を全件プロファイリングする。

なぜ全件か: JEV へ渡すタグを決め打ちせず、データの実態（どのキーが分類的で、
どれが ID/URL/電話などのメタ情報か、値の重複率がどれほどか）から方針を決めるため。
サンプリングだと希少キーの取りこぼしと、値の重複率の過大評価が起きる。

なぜ 2 パスか: 30M 行 × 平均 5 タグ = 1.5 億ペアを (key,value) で丸ごと GROUP BY すると
名前系の高カーディナリティで 8GB RAM を超える。まずキー単位の集計（数千行）で
カーディナリティを見積もり、値の展開はカーディナリティの低いキーに絞る。

    uv run scripts/profile_tags.py [data/pois.cogp.parquet] [reports/tag-profile]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import duckdb

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "data/pois.cogp.parquet")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "reports/tag-profile")
OUT.mkdir(parents=True, exist_ok=True)

# 値展開の対象にするキーの近似ユニーク値数の上限。
# これを超えるキー（name, addr:*, website …）は「自由記述/固有」とみなし値は展開しない。
VALUE_EXPAND_MAX_DISTINCT = 20_000
# 値展開したキーの、各キーで保存する上位値の数
TOP_VALUES_PER_KEY = 50

con = duckdb.connect()
con.execute("SET memory_limit = '4GB'")
con.execute("SET preserve_insertion_order = false")
con.execute(f"SET temp_directory = '{(OUT / '.duckdb-tmp').resolve()}'")

t0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - t0:7.1f}s] {msg}", flush=True)


def sql(q: str):
    return con.execute(q)


def to_csv(q: str, name: str) -> None:
    sql(f"COPY ({q}) TO '{OUT / name}' (HEADER, DELIMITER ',')")
    log(f"wrote {name}")


src = f"read_parquet('{SRC}', file_row_number = true)"
summary: dict = {"source": str(SRC), "rows": None}

# --- LOD レベル境界（footer の geo.lod.levels）------------------------------
geo = json.loads(
    sql(f"SELECT decode(value) FROM parquet_kv_metadata('{SRC}') WHERE key = 'geo'").fetchone()[0]
)
levels = geo["lod"]["levels"]
rg_rows = sql(
    f"SELECT row_group_id, max(row_group_num_rows) FROM parquet_metadata('{SRC}') GROUP BY 1 ORDER BY 1"
).fetchall()
# row group → 先頭行番号
starts, acc = [], 0
for _, n in rg_rows:
    starts.append(acc)
    acc += n
level_bounds = []  # (level, first_row, last_row_exclusive)
prev_rg = -1
for i, lv in enumerate(levels):
    end_rg = lv["row_group_end"]
    first = starts[prev_rg + 1]
    last = starts[end_rg] + rg_rows[end_rg][1]
    level_bounds.append((i, first, last, lv["resolution"]))
    prev_rg = end_rg
summary["lod_levels"] = [
    {"level": i, "first_row": f, "rows": l - f, "resolution_deg_per_px": r} for i, f, l, r in level_bounds
]
case_level = "CASE " + " ".join(
    f"WHEN file_row_number < {l} THEN {i}" for i, _, l, _ in level_bounds
) + " ELSE -1 END"

# --- 1. 行単位 -------------------------------------------------------------
log("pass 1: row-level stats")
sql(
    f"""
CREATE TABLE rows AS
SELECT
  id,
  cardinality(tags) AS ntags,
  ({case_level}) AS level,
  bbox.xmin AS lon, bbox.ymin AS lat,
  tags['name'] IS NOT NULL AS has_name,
  tags
FROM {src}
"""
)
summary["rows"] = sql("SELECT count(*) FROM rows").fetchone()[0]
summary["tags_per_row"] = dict(
    zip(
        ["min", "p25", "median", "p75", "p95", "p99", "max", "mean"],
        sql(
            "SELECT min(ntags), quantile_cont(ntags,.25), quantile_cont(ntags,.5), quantile_cont(ntags,.75),"
            " quantile_cont(ntags,.95), quantile_cont(ntags,.99), max(ntags), avg(ntags) FROM rows"
        ).fetchone(),
    )
)
summary["rows_with_name"] = sql("SELECT count(*) FROM rows WHERE has_name").fetchone()[0]
summary["rows_empty_tags"] = sql("SELECT count(*) FROM rows WHERE ntags = 0 OR tags IS NULL").fetchone()[0]
to_csv("SELECT ntags, count(*) AS rows FROM rows GROUP BY 1 ORDER BY 1", "tags_per_row_hist.csv")

# 地理分布: 世界全体のサンプルなので、日本の割合と大陸レベルの散らばりを見る
summary["extent"] = dict(
    zip(["xmin", "ymin", "xmax", "ymax"], sql("SELECT min(lon), min(lat), max(lon), max(lat) FROM rows").fetchone())
)
summary["rows_in_japan_bbox"] = sql(
    "SELECT count(*) FROM rows WHERE lon BETWEEN 122 AND 154 AND lat BETWEEN 20 AND 46"
).fetchone()[0]
to_csv(
    "SELECT floor(lon/10)*10 AS lon10, floor(lat/10)*10 AS lat10, count(*) AS rows FROM rows GROUP BY 1,2 ORDER BY 3 DESC",
    "geo_grid10.csv",
)
to_csv(
    "SELECT level, count(*) AS rows, avg(ntags) AS mean_tags, sum(has_name::int)/count(*) AS name_ratio FROM rows GROUP BY 1 ORDER BY 1",
    "lod_levels.csv",
)

# --- 2. キー単位 -----------------------------------------------------------
log("pass 2: key-level stats (unnest)")
sql(
    """
CREATE TABLE pairs_view AS
SELECT id, level, e.key AS key, e.value AS value
FROM (SELECT id, level, unnest(map_entries(tags)) AS e FROM rows)
"""
)
summary["tag_pairs_total"] = sql("SELECT count(*) FROM pairs_view").fetchone()[0]
log(f"pairs: {summary['tag_pairs_total']:,}")

sql(
    """
CREATE TABLE keys AS
SELECT
  key,
  count(*)                                         AS n,
  approx_count_distinct(value)                     AS nd_approx,
  avg(length(value))                               AS avg_len,
  quantile_cont(length(value), .5)                 AS med_len,
  max(length(value))                               AS max_len,
  sum((value LIKE '%;%')::int)                     AS multi_semicolon,
  sum((value IN ('yes','no'))::int)                AS yes_no,
  sum((value IN ('yes'))::int)                     AS yes_only,
  sum(regexp_matches(value, '^[-+]?[0-9]+([.,][0-9]+)?$')::int) AS numeric_like,
  sum(regexp_matches(value, '^https?://')::int)    AS url_like,
  sum(regexp_matches(value, '^\\+?[0-9][0-9 ()\\-./]{5,}$')::int) AS phone_like,
  sum(regexp_matches(value, '^Q[0-9]+$')::int)     AS wikidata_qid,
  sum(regexp_matches(value, '^[a-z]{2,3}:')::int)  AS lang_prefixed,
  sum((value <> lower(value))::int)                AS has_upper,
  sum(regexp_matches(value, '[^\\x00-\\x7F]')::int) AS non_ascii,
  sum((length(value) > 40)::int)                   AS len_gt40,
  sum((value ~ '^[a-z0-9_]+(;[a-z0-9_]+)*$')::int) AS osm_token_like,
  min(level)                                       AS min_level,
  quantile_cont(level, .5)                         AS med_level
FROM pairs_view
GROUP BY key
"""
)
summary["distinct_keys"] = sql("SELECT count(*) FROM keys").fetchone()[0]
to_csv(
    f"""
SELECT key, n, round(n / {summary['rows']}, 5) AS row_ratio, nd_approx,
       round(1 - nd_approx / n, 4) AS dup_ratio,
       round(avg_len,1) AS avg_len, med_len, max_len,
       round(multi_semicolon / n, 4) AS multi_ratio,
       round(yes_no / n, 4) AS yes_no_ratio,
       round(numeric_like / n, 4) AS numeric_ratio,
       round(url_like / n, 4) AS url_ratio,
       round(phone_like / n, 4) AS phone_ratio,
       round(wikidata_qid / n, 4) AS qid_ratio,
       round(has_upper / n, 4) AS upper_ratio,
       round(non_ascii / n, 4) AS non_ascii_ratio,
       round(len_gt40 / n, 4) AS long_ratio,
       round(osm_token_like / n, 4) AS token_ratio,
       min_level, med_level
FROM keys ORDER BY n DESC
""",
    "keys.csv",
)

# キーの名前空間（`addr:*` `name:*` `contact:*` …）ごとの集計
to_csv(
    f"""
SELECT CASE WHEN key LIKE '%:%' THEN split_part(key, ':', 1) || ':*' ELSE key END AS key_group,
       count(*) AS distinct_keys, sum(n) AS n, round(sum(n) / {summary['tag_pairs_total']}, 4) AS pair_share
FROM keys GROUP BY 1 ORDER BY n DESC
""",
    "key_groups.csv",
)

# --- 3. 値展開（低カーディナリティのキーだけ）--------------------------------
log("pass 3: key=value counts for low-cardinality keys")
sql(
    f"""
CREATE TABLE pair_counts AS
SELECT p.key, p.value, count(*) AS n, count(DISTINCT p.level) AS n_levels, min(p.level) AS min_level
FROM pairs_view p
JOIN keys k USING (key)
WHERE k.nd_approx <= {VALUE_EXPAND_MAX_DISTINCT}
GROUP BY p.key, p.value
"""
)
summary["expanded_keys"] = sql("SELECT count(DISTINCT key) FROM pair_counts").fetchone()[0]
summary["expanded_pairs_distinct"] = sql("SELECT count(*) FROM pair_counts").fetchone()[0]
summary["expanded_pairs_total"] = sql("SELECT sum(n) FROM pair_counts").fetchone()[0]

# 正確なユニーク値数（展開したキーだけ）を keys に戻す
sql("CREATE TABLE key_exact AS SELECT key, count(*) AS nd_exact FROM pair_counts GROUP BY key")

to_csv(
    f"""
SELECT key, value, n, round(n / {summary['rows']}, 6) AS row_ratio, n_levels, min_level
FROM (SELECT *, row_number() OVER (PARTITION BY key ORDER BY n DESC) AS rk FROM pair_counts)
WHERE rk <= {TOP_VALUES_PER_KEY}
ORDER BY key, n DESC
""",
    "top_values_per_key.csv",
)
to_csv(
    f"""
SELECT key, value, n, round(n / {summary['rows']}, 6) AS row_ratio, n_levels, min_level
FROM pair_counts ORDER BY n DESC LIMIT 2000
""",
    "top_pairs_overall.csv",
)

# key=value の再利用性: 出現回数の階級ごとに「ペア数」と「カバーする出現数」
to_csv(
    """
SELECT bucket, count(*) AS pairs, sum(n) AS occurrences
FROM (
  SELECT n, CASE WHEN n = 1 THEN '1' WHEN n < 10 THEN '2-9' WHEN n < 100 THEN '10-99'
              WHEN n < 1000 THEN '100-999' WHEN n < 10000 THEN '1k-9.9k' WHEN n < 100000 THEN '10k-99k'
              WHEN n < 1000000 THEN '100k-999k' ELSE '1M+' END AS bucket
  FROM pair_counts)
GROUP BY 1 ORDER BY min(n)
""",
    "pair_reuse_buckets.csv",
)

# 全体カバレッジ曲線: 上位 N ペアで（展開対象キーの）出現の何 % を覆うか
to_csv(
    f"""
WITH ranked AS (
  SELECT n, row_number() OVER (ORDER BY n DESC) AS rk, sum(n) OVER (ORDER BY n DESC ROWS UNBOUNDED PRECEDING) AS cum
  FROM pair_counts)
SELECT rk AS top_n_pairs, round(cum / {summary['expanded_pairs_total']}, 4) AS coverage
FROM ranked WHERE rk IN (10,20,50,100,200,500,1000,2000,5000,10000,20000,50000,100000)
ORDER BY rk
""",
    "pair_coverage_curve.csv",
)

# 大文字小文字・空白ゆれ: lower/trim で同一視すると何ペア減るか
to_csv(
    """
SELECT key, count(*) AS raw_variants, count(DISTINCT lower(trim(value))) AS normalized_variants,
       count(*) - count(DISTINCT lower(trim(value))) AS collapsed
FROM pair_counts GROUP BY key HAVING collapsed > 0 ORDER BY collapsed DESC
""",
    "case_variants.csv",
)

# `;` 区切りの複数値: 分解後のトークン数とトップ
to_csv(
    """
SELECT key, count(*) AS multi_pairs, sum(n) AS occurrences,
       round(avg(length(value) - length(replace(value, ';', '')) + 1), 2) AS avg_parts
FROM pair_counts WHERE value LIKE '%;%' GROUP BY key ORDER BY occurrences DESC
""",
    "multi_value_keys.csv",
)

# --- 4. 主要分類キーの共起（OSM の primary feature key を観測対象として）----------
# 方針決定のためではなく「1 POI に分類キーが何個付くか」の実態を見るための観測。
PRIMARY = ["amenity", "shop", "tourism", "leisure", "historic", "office", "craft", "healthcare",
           "emergency", "public_transport", "railway", "aeroway", "man_made", "natural", "building",
           "highway", "landuse", "place", "sport", "attraction", "club"]
plist = ",".join(f"'{k}'" for k in PRIMARY)
to_csv(
    f"""
SELECT n_primary, count(*) AS rows
FROM (SELECT id, count(*) AS n_primary FROM pairs_view WHERE key IN ({plist}) GROUP BY id
      UNION ALL SELECT id, 0 FROM rows WHERE id NOT IN (SELECT id FROM pairs_view WHERE key IN ({plist})))
GROUP BY 1 ORDER BY 1
""",
    "primary_key_count_per_row.csv",
)
to_csv(
    f"""
SELECT a.key AS key_a, b.key AS key_b, count(*) AS rows
FROM pairs_view a JOIN pairs_view b ON a.id = b.id AND a.key < b.key
WHERE a.key IN ({plist}) AND b.key IN ({plist})
GROUP BY 1,2 ORDER BY rows DESC LIMIT 100
""",
    "primary_key_cooccurrence.csv",
)

# --- 5. LOD レベル別の頻出キー --------------------------------------------------
to_csv(
    """
SELECT level, key, n, round(n / lv_rows, 4) AS row_ratio
FROM (
  SELECT p.level, p.key, count(*) AS n, r.lv_rows,
         row_number() OVER (PARTITION BY p.level ORDER BY count(*) DESC) AS rk
  FROM pairs_view p JOIN (SELECT level, count(*) AS lv_rows FROM rows GROUP BY 1) r USING (level)
  GROUP BY p.level, p.key, r.lv_rows)
WHERE rk <= 15 ORDER BY level, n DESC
""",
    "lod_top_keys.csv",
)

# --- 6. 高カーディナリティ・キーのサンプル値（値展開しなかったキー） -----------------
to_csv(
    f"""
SELECT k.key, k.n, k.nd_approx, list(v.value)[1:8] AS samples
FROM keys k
JOIN (SELECT key, value FROM pairs_view USING SAMPLE 2000000 ROWS) v USING (key)
WHERE k.nd_approx > {VALUE_EXPAND_MAX_DISTINCT}
GROUP BY k.key, k.n, k.nd_approx ORDER BY k.n DESC
""",
    "high_cardinality_samples.csv",
)

# --- 7. 日本域だけの頻出キー（利用者の主な表示範囲になる想定のため） -----------------
to_csv(
    f"""
WITH jp AS (SELECT id FROM rows WHERE lon BETWEEN 122 AND 154 AND lat BETWEEN 20 AND 46)
SELECT p.key, count(*) AS n, round(count(*) / {max(summary['rows_in_japan_bbox'],1)}, 4) AS row_ratio_jp
FROM pairs_view p JOIN jp USING (id) GROUP BY 1 ORDER BY n DESC LIMIT 300
""",
    "keys_japan.csv",
)

summary["elapsed_sec"] = round(time.time() - t0, 1)
(OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str))
log("done")
print(json.dumps(summary, indent=2, ensure_ascii=False, default=str))
