/**
 * タグ評価から POI 評価への集約と、地図の見え方への割り当て（#7 / #8）。
 *
 * JEV が評価するのはタグだが、地図に出るのは POI。1 POI が持つ複数タグの評価を
 * どう 1 つに畳むかで見え方が決まる。
 */

import { CHOICE_OPTIONS, SCORE_NEUTRAL } from '../server/questions.js';
import { UNEVALUATED_COLOR, mixChoice } from './colors.js';

/** 1 タグぶんの評価。プリミティブごとに独立して届くので、すべて任意。 */
export interface TagEval {
  /** 確信度（このタグだけで扱いが決まるか）。見え方には使わず集約の重みだけに使う（#7）。 */
  noul?: number;
  /** 0 沈める 〜 2 変化なし 〜 4 最も浮かせる。 */
  score?: number;
  /** CHOICE_OPTIONS の順の確率。 */
  choice?: number[];
}

export type LensState = 'none' | 'partial' | 'full';

export interface PoiStyle {
  state: LensState;
  /** 見え方に効く評価（score か choice）が届いたタグ数。 */
  evaluated: number;
  /** この POI の評価対象タグ数。 */
  total: number;
  score: number | null;
  choice: number[] | null;
  radius: number;
  opacity: number;
  color: string;
}

/**
 * 素の点の半径（z14）。Lens の中立（Score 2）をこの値に合わせてあるので、
 * 「変化なし」と判断された POI は Lens を掛けても大きさが動かない。
 */
const BASE_RADIUS = 3;
const MIN_RADIUS = 1.5;
const MAX_RADIUS = 6;

const BASE_OPACITY = 0.75;
/**
 * 沈む側の透明度の下限。これ以上薄くすると背景地図に埋もれ、
 * 「沈んでいる」ではなく「無い」に見える（#8 の「暗すぎたら弱める」）。
 */
const MIN_OPACITY = 0.3;
/** 浮く側は一律で不透明にする。浮沈の強さは大きさが担う。 */
const RAISED_OPACITY = 0.9;

/** 未評価の POI は Lens 適用前とまったく同じ見え方にする（#13）。 */
export const UNEVALUATED_STYLE: PoiStyle = {
  state: 'none',
  evaluated: 0,
  total: 0,
  score: null,
  choice: null,
  radius: BASE_RADIUS,
  opacity: BASE_OPACITY,
  color: UNEVALUATED_COLOR,
};

function radiusFor(score: number): number {
  return score >= SCORE_NEUTRAL
    ? BASE_RADIUS + ((score - SCORE_NEUTRAL) / SCORE_NEUTRAL) * (MAX_RADIUS - BASE_RADIUS)
    : MIN_RADIUS + (score / SCORE_NEUTRAL) * (BASE_RADIUS - MIN_RADIUS);
}

function opacityFor(score: number): number {
  return score >= SCORE_NEUTRAL
    ? RAISED_OPACITY
    : MIN_OPACITY + (score / SCORE_NEUTRAL) * (BASE_OPACITY - MIN_OPACITY);
}

/**
 * POI のタグ評価を 1 つに畳む。
 *
 * 重みは確信度（Noul）。値は全体に低く最大でも 0.76 だったので、POI 内の相対値に
 * 正規化してから使う（#7）。これで分類タグに対してブランド・細分タグが自然に弱まる。
 * 届いたものだけで畳むので、JEV の一時障害でプリミティブが不揃いでも表示は進む。
 */
export function aggregate(tagIds: readonly string[], evals: Map<string, TagEval>): PoiStyle {
  if (tagIds.length === 0) return UNEVALUATED_STYLE;

  const items: { eval: TagEval; weight: number }[] = [];
  let noulSum = 0;
  let noulMax = 0;
  let noulCount = 0;
  for (const id of tagIds) {
    const e = evals.get(id);
    if (!e) continue;
    items.push({ eval: e, weight: 1 });
    if (e.noul === undefined) continue;
    noulSum += e.noul;
    noulMax = Math.max(noulMax, e.noul);
    noulCount++;
  }

  // 確信度が 1 つも届いていない（または全部 0）なら、重みなしの単純平均に落ちる。
  // 一部だけ届いている場合、欠けたタグには届いた確信度の平均を置く。1 を置くと
  // 「たまたま評価が届かなかったタグ」が最も強い重みを得てしまう。
  if (noulMax > 0) {
    const fallback = noulSum / noulCount;
    for (const item of items) item.weight = (item.eval.noul ?? fallback) / noulMax;
  }

  let scoreSum = 0;
  let scoreWeight = 0;
  const choiceSum = new Array<number>(CHOICE_OPTIONS.length).fill(0);
  let choiceWeight = 0;
  let evaluated = 0;

  for (const { eval: e, weight } of items) {
    let counted = false;
    if (e.score !== undefined) {
      scoreSum += weight * e.score;
      scoreWeight += weight;
      counted = true;
    }
    if (e.choice) {
      for (let i = 0; i < choiceSum.length; i++) choiceSum[i]! += weight * (e.choice[i] ?? 0);
      choiceWeight += weight;
      counted = true;
    }
    if (counted) evaluated++;
  }

  if (evaluated === 0) return { ...UNEVALUATED_STYLE, total: tagIds.length };

  const score = scoreWeight > 0 ? scoreSum / scoreWeight : null;
  const choice = choiceWeight > 0 ? choiceSum.map((v) => v / choiceWeight) : null;

  return {
    state: evaluated === tagIds.length ? 'full' : 'partial',
    evaluated,
    total: tagIds.length,
    score,
    choice,
    // Score が未達なら大きさ・透明度は素のまま。色だけ先に載る。
    radius: score === null ? BASE_RADIUS : radiusFor(score),
    opacity: score === null ? BASE_OPACITY : opacityFor(score),
    // Choice が未達なら色は未評価のまま。大きさだけ先に載る。
    color: choice === null ? UNEVALUATED_COLOR : mixChoice(choice),
  };
}
