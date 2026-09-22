/**
 * Choice の確率分布を地図上の 1 色に混ぜる（#8 の決定）。
 *
 * なぜ OKLab で混ぜるか: sRGB の成分をそのまま平均すると、明度の違う 2 色の中間が
 * 実際より暗く濁って見える。OKLab は知覚的に均等な空間なので、確率 0.5 / 0.5 の
 * 混色が「ちょうど中間に見える」色になる。
 * なぜ混ぜるか: JEV は最尤の 1 択だけでなく分布を返す。分布を捨てて最尤色を塗ると
 * 「0.51 対 0.49 で割れた POI」と「0.99 の POI」が同じ見え方になる。
 * 無関係が灰なので、判断が割れた POI は自然にくすむ。
 */

import { CHOICE_OPTIONS, type ChoiceOption } from '../server/questions.js';

/**
 * Okabe-Ito 系の配色。暖色 = Lens に沿う、寒色 = 反する。
 * 浮沈は Score（大きさ・透明度）が担うので、色は浮く側 3 つの区別を主眼にする。
 */
export const CHOICE_COLORS: Record<ChoiceOption, string> = {
  主役: '#D55E00',
  脇役: '#E69F00',
  背景: '#009E73',
  妨げ: '#0072B2',
  無関係: '#999999',
};

/**
 * まだ評価が届いていない POI の色。
 * 「無関係」の灰（#999999）より暗くして、**判断されて灰になった**のか
 * **まだ判断されていない**のかを区別できるようにする。JEV の一時障害で
 * 評価が欠けたとき、欠測を「無関係」と誤読させないための区別（#13 の「穴」と同じ考え方）。
 */
export const UNEVALUATED_COLOR = '#333333';

type Lab = readonly [number, number, number];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function hexToOklab(hex: string): Lab {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = srgbToLinear(((n >> 16) & 0xff) / 255);
  const g = srgbToLinear(((n >> 8) & 0xff) / 255);
  const b = srgbToLinear((n & 0xff) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  let out = '#';
  for (const c of rgb) {
    const v = Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255);
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}

/** 起動時に 1 度だけ変換しておく。混色は POI ごとに走るため。 */
const PALETTE: Lab[] = CHOICE_OPTIONS.map((name) => hexToOklab(CHOICE_COLORS[name]));

/**
 * Choice の確率（CHOICE_OPTIONS の順）を加重混色して色を返す。
 * 確率の合計が 1 でなくても（複数タグの集約結果など）正しく扱えるよう正規化する。
 */
export function mixChoice(probabilities: readonly number[]): string {
  let total = 0;
  let L = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < PALETTE.length; i++) {
    const w = probabilities[i] ?? 0;
    if (w <= 0) continue;
    total += w;
    L += w * PALETTE[i]![0];
    a += w * PALETTE[i]![1];
    b += w * PALETTE[i]![2];
  }
  if (total === 0) return UNEVALUATED_COLOR;
  return oklabToHex([L / total, a / total, b / total]);
}
