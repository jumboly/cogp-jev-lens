/**
 * JEV に投げる state と質問の組み立て。
 *
 * 文言は実験 01（`experiments/01-jev-tag-eval/run.ts`）と一字一句同じにしてある。
 * ここを変えると 01 の結果と比べられなくなるため、変えるときは SCHEMA_VERSION を上げて
 * キャッシュを無効化する（#6）。
 */

/** 問い方（state の注意書き・criteria・Choice の選択肢）を変えたら上げる（#6 のキャッシュ鍵）。 */
export const SCHEMA_VERSION = 1;

export const PRIMITIVES = ['noul', 'score', 'choice'] as const;
export type Primitive = (typeof PRIMITIVES)[number];

/**
 * Choice の選択肢。下の `buildQuestion` の criteria のキーと同じ順で並べる。
 * 可視化側（#8）の配色・混色がこの順に依存するため、定義をここ 1 か所に置く。
 */
export const CHOICE_OPTIONS = ['主役', '脇役', '背景', '妨げ', '無関係'] as const;
export type ChoiceOption = (typeof CHOICE_OPTIONS)[number];

/** Score のレベル数（0〜4）。中央の 2 が「変化なし」の絶対アンカー（#8）。 */
export const SCORE_LEVELS = 5;
export const SCORE_NEUTRAL = 2;

export function buildState(lens: string): Record<string, unknown> {
  return {
    task: '地図上の場所（POI）に付いた OpenStreetMap のタグを、利用者が指定した「Lens（見方）」に照らして評価する。',
    lens,
    notes: [
      'タグは "key=value" 形式で、その場所が何であるか（分類）、何を扱うか（細分）、どのブランドかを表す。',
      'Lens はその場所を検索する条件ではなく、地図全体を眺めるときの観点である。Lens に沿う場所は浮かび上がり、反する場所は沈み、無関係な場所は変化しない。',
      'Lens の言葉と字面が似ていることは、関係がある理由にはならない。',
      'Lens が「〜ではない」「〜向けでない」と除外を述べている場合、除外された性質を持つ場所は Lens に反する側である。',
    ],
  };
}

/** 実験 01 で採用した版: noul = 確信度、choice = v3。 */
export function buildQuestion(tagId: string, primitive: Primitive): Record<string, unknown> {
  switch (primitive) {
    case 'noul':
      return {
        type: 'boolean',
        instructions: `タグ「${tagId}」だけを手がかりに、それを持つ場所をこの Lens でどう扱うか（浮かせる・沈める・変えない）を迷いなく判断できるか。`,
        criteria: {
          true: 'このタグは決定的で、他のタグや名前を見なくても扱いが決まる。',
          false: 'このタグだけでは判断できない。他のタグや名前など追加の情報が必要。',
        },
      };
    case 'score':
      return {
        type: 'score',
        instructions: `タグ「${tagId}」を持つ場所は、この Lens で地図を見るとき、どう扱うべきか。`,
        criteria: [
          'Lens に明確に反する。地図上で沈める。',
          'Lens にやや反する、または Lens の目的には不向き。やや沈める。',
          'Lens と無関係、または判断できない。変化させない。',
          'Lens に沿う。やや浮かせる。',
          'Lens をまさに体現する場所。最も浮かせる。',
        ],
      };
    case 'choice':
      return {
        type: 'choice',
        instructions: `タグ「${tagId}」を持つ場所は、この Lens に対してどういう意味で関わるか。最も当てはまるものを選ぶ。迷ったら「無関係」を選ぶ。`,
        criteria: {
          主役: 'その場所自体が Lens の対象であり、Lens が指す性質をそのまま持っている。',
          脇役: 'Lens の対象そのものではないが、Lens の目的を果たすのに実際に役立つ設備・サービス・店。「役立つ」と言い切れる場合だけ選ぶ。',
          背景: 'Lens の対象ではなく役立つわけでもないが、周囲の雰囲気・景観として Lens の性質を強める。',
          妨げ: 'Lens の目的にとって邪魔になる、または避けたい場所。',
          無関係: 'Lens とは関係がない。',
        },
      };
  }
}

/**
 * Lens 文字列の正規化（#6 の決定）。軽くだけ揃える。
 * 同義表現（子ども / 子供）は束ねない。
 */
export function normalizeLens(lens: string): string {
  return lens
    .normalize('NFKC') // 全角英数記号を半角に
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[。.]+$/, '');
}
