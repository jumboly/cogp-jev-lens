/**
 * 表示範囲の POI から JEV に投げるタグ集合を作る。
 *
 * なぜ POI ではなくタグを数えるか: 多数の POI が同じ `tourism=museum` を持っていても
 * JEV の評価は 1 回で済み、結果を該当する全 POI で使い回せる（README）。
 * なぜ許可リストで絞るか: 1 回しか出ないペアが 191 万ある一方、上位 1 万ペアで出現の 91% を
 * 覆う。無条件に送るとタイポや独自値に無駄なリクエストが出る（docs/issues/12）。
 */

import allowlistUrl from '../data-dist/tag-allowlist.v1.slim.json?url';

type Role = 'category' | 'refine' | 'brand';

interface SlimAllowlist {
  roles: Record<string, Role>;
  entries: string[];
}

export interface Allowlist {
  roles: Record<string, Role>;
  ids: Set<string>;
}

export async function loadAllowlist(): Promise<Allowlist> {
  const res = await fetch(allowlistUrl);
  if (!res.ok) throw new Error(`許可リストを読めない: HTTP ${res.status}`);
  const slim = (await res.json()) as SlimAllowlist;
  return { roles: slim.roles, ids: new Set(slim.entries) };
}

/**
 * 1 つの POI のタグを正規化し、許可リストを通った `key=value` を返す。
 * 正規化は許可リスト生成時と同じ規則にする（ずれると命中しない）:
 * 値を `;` で分割して trim、brand 以外は小文字化。
 */
export function normalizePoiTags(
  tags: Record<string, string>,
  allow: Allowlist,
  dropped?: Set<string>,
): string[] {
  const out: string[] = [];
  for (const [key, raw] of Object.entries(tags)) {
    const role = allow.roles[key];
    if (!role) continue;
    const parts =
      role === 'brand' ? [raw.trim()] : raw.split(';').map((p) => p.trim().toLowerCase());
    for (const part of parts) {
      if (!part) continue;
      const id = `${key}=${part}`;
      if (allow.ids.has(id)) out.push(id);
      else dropped?.add(id);
    }
  }
  return out;
}

export interface TagCount {
  id: string;
  /** 表示範囲でこのタグを持つ POI の数。多い順に評価したいときの手がかり。 */
  count: number;
}

/** 正規化済みタグの集まりを、ユニークタグと出現数に畳む。 */
export function countTags(perPoi: Iterable<readonly string[]>): TagCount[] {
  const counts = new Map<string, number>();
  for (const ids of perPoi) {
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
