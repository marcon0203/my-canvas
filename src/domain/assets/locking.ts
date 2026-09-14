import type { Asset } from './model';

/**
 * 引用与版本：定稿锁定才能被引用；升版后引用旧版的镜头标记「漂移」，
 * 由人决定哪些值得重摇 —— 升版永不自动重跑。
 */

/** 尚未定稿的引用：绑不上参考图，模型会自由发挥 */
export function unlockedRefs(
  s: { refs: readonly string[] },
  byAid: (aid: string) => Asset | undefined,
): string[] {
  return s.refs.filter((r) => {
    const a = byAid(r);
    return !a || a.status !== 'locked';
  });
}

/** 已升版的引用：此镜还锁在旧版本号上，待确认是否重摇 */
export function driftedRefs(
  s: { refs: readonly string[]; refVer: Record<string, number> },
  byAid: (aid: string) => Asset | undefined,
): string[] {
  return s.refs.filter((r) => {
    const a = byAid(r);
    return !!a && a.status === 'locked' && (s.refVer[r] ?? 0) < a.ver;
  });
}
