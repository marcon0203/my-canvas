/**
 * 故事结构：幕 / 场 / 剧本块。
 * 原先住在 mock 层，但 Agent 要产出这些结构，domain 不能反向依赖 mock —— 提到这里。
 */

export interface Beat {
  id: string;
  /** 场次键，与 Shot.sceneKey 对齐，如 '场景1' */
  k: string;
  t: string;
}

export interface Act {
  id: string;
  t: string;
  span: string;
  beats: Beat[];
}

export type BlockType = 'character' | 'outline' | 'text';

export interface DocBlock {
  id: string;
  type: BlockType;
  label: string;
  body: string;
}

export const allBeats = (acts: readonly Act[]): Beat[] => acts.flatMap((a) => a.beats);

export const actOfBeat = (acts: readonly Act[], beatId: string): Act | undefined =>
  acts.find((a) => a.beats.some((b) => b.id === beatId));

/** 下一个可用的场次键：场次编号全局递增，不与已有键冲突 */
export function nextSceneKey(acts: readonly Act[]): string {
  const used = new Set(allBeats(acts).map((b) => b.k));
  let n = used.size + 1;
  while (used.has(`场景${n}`)) n += 1;
  return `场景${n}`;
}

/** 下一个可用 id：同前缀里取最大序号 +1，避免与已删除的 id 撞车 */
export function nextId(prefix: string, existing: readonly { id: string }[]): string {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const max = existing.reduce((m, x) => {
    const hit = re.exec(x.id);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}${max + 1}`;
}
