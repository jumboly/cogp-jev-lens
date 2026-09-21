# /// script
# requires-python = ">=3.12"
# ///
"""
実験 01 の結果（results/*.jsonl）を集計する。

見たいことは 4 つ。
1. 各プリミティブの値の分布（中央に寄るのか、二極化するのか）
2. Lens ごとの上位・下位タグが直感と合うか
3. 「トークンのみ」と「説明文付き」で判定がどれだけ動くか
4. Noul（関係あり確率）と Score（扱い）の関係。Noul が Score の重みとして機能するか

    uv run experiments/01-jev-tag-eval/analyze.py > experiments/01-jev-tag-eval/RESULTS.md
"""
from __future__ import annotations

import json
import statistics as st
from collections import defaultdict
from pathlib import Path

DIR = Path(__file__).parent
RES = DIR / "results"
tags = {t["id"]: t for t in json.loads((DIR / "tags-tokyo-z14.json").read_text())["tags"]}
lenses = {l["id"]: l for l in json.loads((DIR / "lenses.json").read_text())}

# answers[(lens, repr, primitive)][tag] = value
answers: dict[tuple, dict[str, dict]] = defaultdict(dict)
usage = defaultdict(lambda: {"req": 0, "in": 0, "out": 0, "lat": []})
for f in sorted(RES.glob("*.jsonl")):
    for line in f.read_text().splitlines():
        r = json.loads(line)
        if r["status"] != 200:
            continue
        key = (r["lens"], r["repr"], r["primitive"])
        u = usage[key]
        u["req"] += 1
        u["in"] += r["response"].get("usage", {}).get("inputTokens", 0)
        u["out"] += r["response"].get("usage", {}).get("outputTokens", 0)
        u["lat"].append(r["latencyMs"])
        for tag, a in r["response"].get("answers", {}).items():
            answers[key][tag] = a


def val(a: dict, primitive: str):
    if primitive == "noul":
        return a.get("probability", a.get("noul"))
    if primitive == "score":
        return a.get("score")
    return a.get("choice")


def hist(values: list[float], lo: float, hi: float, bins: int = 10) -> str:
    counts = [0] * bins
    for v in values:
        i = min(bins - 1, int((v - lo) / (hi - lo) * bins))
        counts[i] += 1
    mx = max(counts) or 1
    return " ".join(f"{c:>3}" for c in counts) + "   " + "".join("▁▂▃▄▅▆▇█"[min(7, int(c / mx * 7.999))] for c in counts)


out: list[str] = []
P = out.append
P("# 実験 01 結果: OSM タグ × Lens の JEV 評価\n")
P(f"対象: 東京駅周辺 z14、{len(tags)} ユニークタグ、Lens {len(lenses)} 種、Noul / Score / Choice × トークンのみ / 説明文付き\n")

# --- コスト・レイテンシ ---
P("## リクエスト・トークン・レイテンシ\n")
P("| Lens | 表現 | プリミティブ | req | 入力トークン | 出力トークン | レイテンシ中央値 ms |")
P("| --- | --- | --- | --- | --- | --- | --- |")
tin = tout = 0
for key, u in sorted(usage.items()):
    tin += u["in"]; tout += u["out"]
    P(f"| {key[0]} | {key[1]} | {key[2]} | {u['req']} | {u['in']:,} | {u['out']:,} | {int(st.median(u['lat']))} |")
P(f"\n合計: 入力 {tin:,} / 出力 {tout:,} トークン\n")

# --- 分布 ---
P("## 1. 値の分布\n")
P("Noul は 0〜1（関係あり確率）、Score は 0〜4（0 沈める / 2 変化なし / 4 最も浮かせる）。10 区間のヒストグラム。\n")
P("```")
for lens in lenses:
    for primitive, lo, hi in (("noul", 0, 1), ("score", 0, 4)):
        for repr_ in ("token", "described"):
            vs = [val(a, primitive) for a in answers[(lens, repr_, primitive)].values() if val(a, primitive) is not None]
            if not vs:
                continue
            P(f"{lens:<18} {primitive:<6} {repr_:<9} n={len(vs):<4} mean={st.mean(vs):.2f} sd={st.pstdev(vs):.2f}  {hist(vs, lo, hi)}")
P("```\n")

# --- Choice の分布 ---
P("## 2. Choice（Lens との関係の種類）の分布\n")
cats = ["目的地", "立ち寄り先", "雰囲気", "妨げ", "無関係"]
P("| Lens | 表現 | " + " | ".join(cats) + " | 平均確信度 |")
P("| --- | --- | " + " | ".join("---" for _ in cats) + " | --- |")
for lens in lenses:
    for repr_ in ("token", "described"):
        ans = answers[(lens, repr_, "choice")]
        if not ans:
            continue
        cnt = defaultdict(int)
        conf = []
        for a in ans.values():
            cnt[a.get("choice")] += 1
            probs = a.get("probabilities") or {}
            if probs:
                conf.append(max(probs.values()))
        P(f"| {lens} | {repr_} | " + " | ".join(str(cnt.get(c, 0)) for c in cats) + f" | {st.mean(conf):.2f} |" if conf else "")
P("")

# --- 上位・下位 ---
P("## 3. Lens ごとの上位・下位タグ（Score、説明文付き）\n")
P("タグの後の括弧は東京駅周辺での POI 件数。Choice の結果と Noul を併記。\n")
for lens, l in lenses.items():
    ans = answers[(lens, "described", "score")]
    if not ans:
        continue
    noul = answers[(lens, "described", "noul")]
    choice = answers[(lens, "described", "choice")]
    rows = sorted(((t, val(a, "score")) for t, a in ans.items() if val(a, "score") is not None), key=lambda x: -x[1])
    P(f"### {l['text']}" + ("（否定形）" if l.get("negative") else "") + "\n")
    P("| | タグ | 件数 | Score | Noul | Choice |")
    P("| --- | --- | --- | --- | --- | --- |")
    for label, part in (("浮かせる", rows[:15]), ("沈める", rows[-15:])):
        for t, s in part:
            n = val(noul.get(t, {}), "noul")
            c = val(choice.get(t, {}), "choice")
            P(f"| {label} | `{t}` | {tags.get(t, {}).get('count', '')} | {s:.2f} | {n if n is None else f'{n:.2f}'} | {c or ''} |")
    P("")

# --- 表現の違い ---
P("## 4. トークンのみ vs 説明文付き\n")
P("同じ Lens・同じタグで Score がどれだけ動いたか（説明文が取れたタグのみ。ブランドは除外）。\n")
desc = json.loads((DIR / "descriptions.json").read_text()) if (DIR / "descriptions.json").exists() else {}
described_tags = {t for t, d in desc.items() if d.get("ja") or d.get("en")}
P("| Lens | n | 平均 \\|Δ\\| | Δ≥0.5 の割合 | 最も動いたタグ（token → described） |")
P("| --- | --- | --- | --- | --- |")
for lens in lenses:
    a_t = answers[(lens, "token", "score")]
    a_d = answers[(lens, "described", "score")]
    deltas = []
    for t in described_tags:
        if t in a_t and t in a_d and val(a_t[t], "score") is not None and val(a_d[t], "score") is not None:
            deltas.append((t, val(a_t[t], "score"), val(a_d[t], "score")))
    if not deltas:
        continue
    absd = [abs(d - tk) for _, tk, d in deltas]
    big = sorted(deltas, key=lambda x: -abs(x[2] - x[1]))[:4]
    P(f"| {lens} | {len(deltas)} | {st.mean(absd):.2f} | {sum(1 for x in absd if x >= 0.5) / len(absd):.0%} | " + "; ".join(f"`{t}` {tk:.1f}→{d:.1f}" for t, tk, d in big) + " |")
P("")

# --- Noul と Score の関係 ---
P("## 5. Noul（関係あり）と Score（扱い）の関係\n")
P("Noul が「関係あり」を返すタグは Score が中央（2）から離れているはず。Score の中央からの距離 |Score−2| と Noul の相関を見る。\n")
P("| Lens | 表現 | n | 相関 r(Noul, \\|Score−2\\|) | Noul<0.4 の Score 平均 | Noul≥0.7 の \\|Score−2\\| 平均 |")
P("| --- | --- | --- | --- | --- | --- |")
for lens in lenses:
    for repr_ in ("token", "described"):
        a_n = answers[(lens, repr_, "noul")]
        a_s = answers[(lens, repr_, "score")]
        pairs = [(val(a_n[t], "noul"), val(a_s[t], "score")) for t in a_n if t in a_s and val(a_n[t], "noul") is not None and val(a_s[t], "score") is not None]
        if len(pairs) < 3:
            continue
        xs = [p[0] for p in pairs]
        ys = [abs(p[1] - 2) for p in pairs]
        r = st.correlation(xs, ys) if st.pstdev(xs) > 0 and st.pstdev(ys) > 0 else float("nan")
        low = [s for n, s in pairs if n < 0.4]
        high = [abs(s - 2) for n, s in pairs if n >= 0.7]
        P(f"| {lens} | {repr_} | {len(pairs)} | {r:.2f} | {st.mean(low):.2f} (n={len(low)}) | {st.mean(high) if high else float('nan'):.2f} (n={len(high)}) |")
P("")
print("\n".join(out))
