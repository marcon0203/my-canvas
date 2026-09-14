import type { Shot, Verdict } from '@/domain/shots/model';

/**
 * 记账口径：命中率 = 可用镜头 ÷ 累计生成次数。
 * 这个数字决定第二部片能不能比第一部便宜。
 */

export const totalTries = (shots: readonly Shot[]): number =>
  shots.reduce((n, s) => n + s.takes, 0);

export const usableShots = (shots: readonly Shot[]): number =>
  shots.filter((s) => s.verdict === 'ok').length;

export const hitRate = (shots: readonly Shot[]): number => {
  const t = totalTries(shots);
  return t ? Math.round((usableShots(shots) / t) * 100) : 0;
};

export interface Attribution {
  readonly tries: number;
  readonly usable: number;
}

/** 按模型归因：哪个模型更容易过 */
export function byModel(shots: readonly Shot[]): Record<string, Attribution> {
  const acc: Record<string, { t: number; o: number }> = {};
  for (const s of shots) {
    if (!s.takes) continue;
    acc[s.model] ??= { t: 0, o: 0 };
    acc[s.model]!.t += s.takes;
    if (s.verdict === 'ok') acc[s.model]!.o += 1;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { tries: v.t, usable: v.o }]));
}

/** 按景别归因：哪类景别最难拍 */
export function bySize(shots: readonly Shot[]): Record<string, Attribution> {
  const acc: Record<string, { t: number; o: number }> = {};
  for (const s of shots) {
    if (!s.takes) continue;
    acc[s.size] ??= { t: 0, o: 0 };
    acc[s.size]!.t += s.takes;
    if (s.verdict === 'ok') acc[s.size]!.o += 1;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { tries: v.t, usable: v.o }]));
}

/** 判定写回：mark-ok / mark-redo 的记账语义 */
export function applyVerdict(s: Shot, v: Verdict, extraTakes = 0): void {
  s.verdict = v;
  if (extraTakes) s.takes += extraTakes;
}
