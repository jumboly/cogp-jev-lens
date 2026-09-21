# /// script
# requires-python = ">=3.12"
# ///
"""
Taginfo（OSM タグ統計 API）の wiki_pages から、タグの日本語・英語の説明文を取る。

なぜ必要か: JEV に渡す表現の比較実験（トークンのみ / 説明文付き）で、説明文は
人手で書かず OSM wiki の定義を使う。手書きだと書き手の解釈が混ざり、比較にならない。
ブランド（brand=*）は固有名なので説明文は取らない。

    uv run scripts/fetch_tag_descriptions.py <tags.json> <out.json>
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

src = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[2])
cache = json.loads(out.read_text()) if out.exists() else {}

UA = "cogp-jev-lens/0.1 (experiment; https://github.com/jumboly/cogp-jev-lens)"

def fetch(key: str, value: str) -> dict:
    q = urllib.parse.urlencode({"key": key, "value": value})
    req = urllib.request.Request(f"https://taginfo.openstreetmap.org/api/4/tag/wiki_pages?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)["data"]
    desc = {d["lang"]: d.get("description") for d in data if d.get("description")}
    return {"ja": desc.get("ja"), "en": desc.get("en")}

todo = [t for t in src["tags"] if t["role"] != "brand" and t["id"] not in cache]
print(f"{len(todo)} tags to fetch ({len(cache)} cached)")
for i, t in enumerate(todo, 1):
    try:
        cache[t["id"]] = fetch(t["key"], t["value"])
    except Exception as e:  # noqa: BLE001
        cache[t["id"]] = {"ja": None, "en": None, "error": str(e)}
    if i % 25 == 0:
        out.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
        print(f"  {i}/{len(todo)}", flush=True)
    time.sleep(0.25)  # Taginfo は個人運営に近い共有資源なので間隔を空ける
out.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
ja = sum(1 for v in cache.values() if v.get("ja"))
en = sum(1 for v in cache.values() if v.get("en"))
print(f"done: {len(cache)} tags, ja={ja}, en={en}")
