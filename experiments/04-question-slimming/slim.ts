/**
 * 実験 04: 質問の「薄い版」。
 *
 * #4 の調査で、質問の 95〜98% が全問同じ定型文で、変わるのはタグ名の約 10 文字だけと分かった。
 * 1 リクエスト内で指示を共有する仕組みは仕様にないが、**仕様が明示的に許す範囲で
 * 質問自体を薄くする**余地が 54% ある。ここではその薄い版を組み立てる。
 *
 * | プリミティブ | 根拠 | 現行 | 削減後（見積り） |
 * | --- | --- | --- | --- |
 * | Noul | `criteria` は任意なので落とせる | 221 | 94 |
 * | Score | レベルは短いラベルでよい（公式例も `["Calm", "Frustrated", "Very angry"]`） | 248 | 143 |
 * | Choice | 値に `null` を使える（"use null when an option needs no extra detail"） | 403 | 168 |
 *
 * **これは判断基準の文言を消す変更なので、出力が変わりうる。** 変わらないことを
 * 確かめるのがこの実験の目的。instructions（タグ名を含む本文）は現行と一字一句同じにし、
 * 落とすのは criteria だけにする。何が効いたかを切り分けられるようにするため。
 */

import { CHOICE_OPTIONS, type Primitive } from '../../src/server/questions.ts'

export function buildSlimQuestion(tagId: string, primitive: Primitive): Record<string, unknown> {
  switch (primitive) {
    case 'noul':
      // criteria を落とすだけ。instructions は現行と同一。
      return {
        type: 'boolean',
        instructions: `タグ「${tagId}」だけを手がかりに、それを持つ場所をこの Lens でどう扱うか（浮かせる・沈める・変えない）を迷いなく判断できるか。`,
      }
    case 'score':
      // 5 段のレベルは残す（順序と段数が変わると Score の意味が変わる）。
      // 各段の説明を短いラベルに置き換える。
      return {
        type: 'score',
        instructions: `タグ「${tagId}」を持つ場所は、この Lens で地図を見るとき、どう扱うべきか。`,
        criteria: ['明確に反する', 'やや反する', '無関係', '沿う', 'まさに体現する'],
      }
    case 'choice':
      // 選択肢の並びは現行と同じ。各選択肢の定義を null にする。
      return {
        type: 'choice',
        instructions: `タグ「${tagId}」を持つ場所は、この Lens に対してどういう意味で関わるか。最も当てはまるものを選ぶ。迷ったら「無関係」を選ぶ。`,
        criteria: Object.fromEntries(CHOICE_OPTIONS.map((name) => [name, null])),
      }
  }
}
