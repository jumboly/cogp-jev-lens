/**
 * タグをバッチに切る規則。BFF（`evaluate-tags.ts`）と、呼び出し側
 * （`src/lens/client.ts`）の両方が使う。
 *
 * なぜ共有するか: 呼び出し側は「1 リクエストがバッチ何本になるか」を
 * 送る前に知る必要がある（下の MAX_BATCHES_PER_REQUEST）。同じ規則を
 * 二度書くと、片方だけ直したときに静かにずれる。
 */
import { buildQuestion, buildState, type Primitive } from './questions.js';

/**
 * 1 リクエストの上限（本文の文字数）。
 *
 * なぜ問数でもトークン量でもなく本文の大きさで切るか。実測で順に潰した。
 *
 * 1. **問数ではない。** 実験 03 で 130 問に固定して中身だけ変えると成功率が
 *    0% / 20% / 30% と動いた。しかも Noul 190 問は実測で最も成功率が高い（42%）
 * 2. **トークン量でもない。** 段階 9 の通し実測で、同じ 28.9k トークンの 2 つが分かれた
 *
 * | 1 リクエスト | 問数 | 入力トークン | 本文 | 成功 |
 * | --- | --- | --- | --- | --- |
 * | Noul | 190 | 14.4k | 25.0 KiB | 42%（5/12） |
 * | Choice | 91 | 28.9k | 34.4 KiB | 21%（8/38） |
 * | Score | 156 | 28.9k | 39.4 KiB | **3%（1/35）** |
 *
 * 28.9k で揃えた 2 つの差（34.4 対 39.4 KiB）は Fisher の正確検定で p = 0.029。
 * 本文の大きさで並べると単調に下がる。
 *
 * 値は **Choice 90 問（34.0 KiB）** に合わせた。実験 02 で全実行 100% 通った唯一の
 * サイズで、段階 9 の不調な時間帯でも 21% と、他より明確に良かった。
 * 1 リクエストの重さをこれ以上にしないまま、軽いプリミティブを積む。
 *
 * 単位が文字数なのは、上流に渡る本文の大きさを表す指標として実測ログ（`requestChars`）と
 * 揃えるため。UTF-8 バイト数との比はプリミティブで 1.87〜2.16 とばらつくので、
 * バイト数で切ると Score に 148 問入ってしまい、実測で落ちた 156 問に近づく。
 */
const REQUEST_BUDGET_CHARS = 34 * 1024;

/**
 * 問数の上限。文字数だけ見れば Noul は 259 問積めるが、**通った実績があるのは 190 問まで**
 * （実験 02 / 03 / 段階 9）。それより上は未検証なので踏み込まない。
 */
const MAX_QUESTIONS = 190;

/**
 * タグを「本文がこの大きさに収まる」単位に切る。
 * z14 の 623 タグなら Choice 7 本 + Score 5 本 + Noul 4 本 = 16 本（問数固定なら 21 本）。
 */
export function splitBatches(tags: string[], primitive: Primitive, overhead: number): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  // state とラッパーは全バッチに乗るので、最初から数に入れる。
  let size = overhead;
  for (const tag of tags) {
    // 質問ごと丸ごと数える。キーはモデルに渡らないが本文には乗る。
    const chars = JSON.stringify({ [tag]: buildQuestion(tag, primitive) }).length;
    if (current.length > 0 && (size + chars > REQUEST_BUDGET_CHARS || current.length >= MAX_QUESTIONS)) {
      out.push(current);
      current = [];
      size = overhead;
    }
    current.push(tag);
    size += chars;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * 1 リクエストで扱うバッチの上限。
 *
 * なぜ上限が要るか: BFF の実行基盤に Cloudflare Workers を想定していて、
 * 無料プランは **1 回の呼び出しにつき外部 fetch 50 回**まで。BFF は 1 バッチにつき
 * 最大 `MAX_ATTEMPTS`（= 6、`jev.ts`）回 JEV を叩くので、8 バッチなら最悪でも
 * 8 × 6 = 48 回で収まる。
 *
 * z14 の冷えた Lens（623 タグ = 16 バッチ）はこれで 2 リクエストに分かれる。
 * 1 バッチ 1 リクエストまで割らないのは、リクエストを増やすほど往復と接続確立が
 * 積み上がるため。NDJSON で流す作りも BFF 側の同時実行の制御もそのまま残せる。
 */
export const MAX_BATCHES_PER_REQUEST = 8;

/** JEV へ 1 回投げる単位。 */
export interface Batch {
  primitive: Primitive;
  tags: string[];
}

/** state とラッパーのぶん。予算はリクエスト本文全体に対する値なので先に引く。 */
export function requestOverhead(lens: string): number {
  return JSON.stringify({ model: '', state: buildState(lens), questions: {} }).length;
}

/**
 * タグとプリミティブから、投げる順に並んだバッチを作る。
 *
 * なぜ並べ替えるか: プリミティブを外側にしたまま流すと Score が全部届いてから
 * Choice が届く順になり、「大きさだけ動いて色は灰のまま」という中途半端な画面が長く続く
 * （段階 8 の実測で 20 秒）。呼び出し元はタグを出現数の多い順に並べて送るので、
 * 先頭のタグを扱うバッチから流せば、多くの POI に効くタグから 3 プリミティブ揃って埋まる。
 */
export function planBatches(lens: string, tags: string[], primitives: Primitive[]): Batch[] {
  const overhead = requestOverhead(lens);
  const planned: { batch: Batch; offset: number }[] = [];
  for (const primitive of primitives) {
    let offset = 0;
    for (const slice of splitBatches(tags, primitive, overhead)) {
      planned.push({ batch: { primitive, tags: slice }, offset });
      offset += slice.length;
    }
  }
  // sort は安定なので、同じ offset の中ではプリミティブの並び順が保たれる。
  planned.sort((a, b) => a.offset - b.offset);
  return planned.map((p) => p.batch);
}

/**
 * バッチ列を「1 リクエスト = 最大 maxBatches 本」に区切る。
 *
 * なぜタグの範囲ではなくバッチ単位で区切るか: タグの範囲で割ると、切り口が
 * どのプリミティブのバッチ境界とも揃わず、各チャンクの末尾に半端なバッチができる。
 * 実測で z14 の 16 バッチが 19 本に増えた（744 タグなら 19 → 23 本）。
 * バッチを作ってから区切れば増分はゼロで、順番もそのまま保たれる。
 */
export function chunkBatches(batches: Batch[], maxBatches = MAX_BATCHES_PER_REQUEST): Batch[][] {
  const out: Batch[][] = [];
  for (let i = 0; i < batches.length; i += maxBatches) {
    out.push(batches.slice(i, i + maxBatches));
  }
  return out;
}
