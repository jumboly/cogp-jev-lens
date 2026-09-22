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
        prim = r["primitive"]
        if r.get("noulVariant") and r["noulVariant"] != "relevance":
            prim += f"-{r['noulVariant']}"
        if r.get("choiceVariant") and r["choiceVariant"] != "v1":
            prim += f"-{r['choiceVariant']}"
        key = (r["lens"], r["repr"], prim)
        u = usage[key]
        u["req"] += 1
        u["in"] += r["response"].get("usage", {}).get("inputTokens", 0)
        u["out"] += r["response"].get("usage", {}).get("outputTokens", 0)
        u["lat"].append(r["latencyMs"])
        for tag, a in r["response"].get("answers", {}).items():
            answers[key][tag] = a


def val(a: dict, primitive: str):
    if primitive.startswith("noul"):
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
    for primitive, lo, hi in (("noul", 0, 1), ("noul-confidence", 0, 1), ("noul-fit", 0, 1), ("score", 0, 4)):
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

# --- Noul バリアント ---
P("## 6. Noul の意味を変えた再実験（トークンのみ）\n")
P("relevance = 判断材料として関係あるか（初回） / confidence = このタグだけで扱いが決まるか / fit = Lens に沿う側か。\n")
P("| Lens | 変種 | n | 平均 ± SD | r(値, \\|Score−2\\|) | r(値, Score) | 値≥0.8 の割合 | 値≤0.2 の割合 |")
P("| --- | --- | --- | --- | --- | --- | --- | --- |")
for lens in lenses:
    a_s = answers[(lens, "token", "score")]
    for variant in ("noul", "noul-confidence", "noul-fit"):
        a_n = answers[(lens, "token", variant)]
        pairs = [(val(a_n[t], variant), val(a_s[t], "score")) for t in a_n if t in a_s and val(a_n[t], variant) is not None and val(a_s[t], "score") is not None]
        if len(pairs) < 3:
            continue
        xs = [p[0] for p in pairs]
        r_abs = st.correlation(xs, [abs(p[1] - 2) for p in pairs]) if st.pstdev(xs) > 0 else float("nan")
        r_sgn = st.correlation(xs, [p[1] for p in pairs]) if st.pstdev(xs) > 0 else float("nan")
        P(f"| {lens} | {variant.replace('noul-', '') if variant != 'noul' else 'relevance'} | {len(pairs)} | {st.mean(xs):.2f} ± {st.pstdev(xs):.2f} | {r_abs:.2f} | {r_sgn:.2f} | {sum(1 for x in xs if x >= 0.8) / len(xs):.0%} | {sum(1 for x in xs if x <= 0.2) / len(xs):.0%} |")
P("")
P("### confidence が高い / 低いタグの例（静か Lens）\n")
a_c = answers[("quiet", "token", "noul-confidence")]
a_s = answers[("quiet", "token", "score")]
if a_c:
    rows = sorted(((t, val(a, "noul-confidence"), val(a_s.get(t, {}), "score")) for t, a in a_c.items() if val(a, "noul-confidence") is not None), key=lambda x: -x[1])
    P("| | タグ | confidence | Score |")
    P("| --- | --- | --- | --- |")
    for label, part in (("高い", rows[:12]), ("低い", rows[-12:])):
        for t, c, sc in part:
            P(f"| {label} | `{t}` | {c:.2f} | {sc if sc is None else f'{sc:.2f}'} |")
    P("")

# --- Choice v2 / v3 ---
cats2 = ["主役", "脇役", "背景", "妨げ", "無関係"]
for variant, title in (("choice-v2", "v2: 主役 / 脇役 / 背景 / 妨げ / 無関係"), ("choice-v3", "v3: v2 の語で「脇役」を「実際に役立つ」に締め、「無関係」を広げる")):
    if not any(answers[(lens, "token", variant)] for lens in lenses):
        continue
    P(f"## 7. Choice の選択肢を言い換えた再実験（{title}、トークンのみ）\n")
    P("| Lens | " + " | ".join(cats2) + " | 平均確信度 |")
    P("| --- | " + " | ".join("---" for _ in cats2) + " | --- |")
    for lens in lenses:
        ans = answers[(lens, "token", variant)]
        if not ans:
            continue
        cnt = defaultdict(int)
        conf = []
        for a in ans.values():
            cnt[a.get("choice")] += 1
            probs = a.get("probabilities") or {}
            if probs:
                conf.append(max(probs.values()))
        P(f"| {lens} | " + " | ".join(str(cnt.get(c, 0)) for c in cats2) + f" | {st.mean(conf):.2f} |")
    P("")
    for base, base_cats, base_name in (("choice", cats, "v1"), ("choice-v2", cats2, "v2")):
        if base == variant:
            continue
        cross = defaultdict(lambda: defaultdict(int))
        for lens in lenses:
            a1 = answers[(lens, "token", base)]
            a2 = answers[(lens, "token", variant)]
            for t in a1:
                if t in a2:
                    cross[a1[t].get("choice")][a2[t].get("choice")] += 1
        if cross:
            P(f"### {base_name} → {variant.replace('choice-', '')} の対応（全 Lens 合算）。行 = {base_name}、列 = {variant.replace('choice-', '')}\n")
            P(f"| {base_name} \\ {variant.replace('choice-', '')} | " + " | ".join(cats2) + " |")
            P("| --- | " + " | ".join("---" for _ in cats2) + " |")
            for c1 in base_cats:
                P(f"| {c1} | " + " | ".join(str(cross[c1].get(c2, 0)) for c2 in cats2) + " |")
            P("")
    # Score との整合: 各カテゴリの Score 平均（脇役に沈める側が混ざっていないか）
    P(f"### {variant.replace('choice-', '')} 各カテゴリの Score 平均（全 Lens 合算）\n")
    P("| カテゴリ | n | Score 平均 | Score<1.5 の割合 |")
    P("| --- | --- | --- | --- |")
    for c in cats2:
        vals = []
        for lens in lenses:
            a2 = answers[(lens, "token", variant)]
            a_s = answers[(lens, "token", "score")]
            vals += [val(a_s[t], "score") for t, a in a2.items() if a.get("choice") == c and t in a_s and val(a_s[t], "score") is not None]
        if vals:
            P(f"| {c} | {len(vals)} | {st.mean(vals):.2f} | {sum(1 for v in vals if v < 1.5) / len(vals):.0%} |")
    P("")
    P(f"### {variant.replace('choice-', '')} で各カテゴリに入ったタグの例（静か Lens、Score 併記）\n")
    a2 = answers[("quiet", "token", variant)]
    a_s = answers[("quiet", "token", "score")]
    if a2:
        for c in cats2:
            members = sorted(((t, (a.get("probabilities") or {}).get(c, 0)) for t, a in a2.items() if a.get("choice") == c), key=lambda x: -x[1])[:8]
            P(f"- **{c}** ({sum(1 for a in a2.values() if a.get('choice') == c)}): " + ", ".join(f"`{t}` {val(a_s.get(t, {}), 'score') or 0:.1f}" for t, _ in members))
        P("")
print("\n".join(out))
