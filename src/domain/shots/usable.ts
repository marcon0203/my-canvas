import type { Shot } from './model';

/**
 * 「可用」这个词在这个产品里有三个不同的意思，页面上曾经都写成「可用」，
 * 于是数据页说「可用镜头 0」而剪辑页同时说「18 段可用」—— 两边各数了一个字段：
 * 数据页数 `verdict === 'ok'`，剪辑页数 `vid === 'ok'`，而出完视频只会置 `vid`。
 *
 * 所以词表收在这里，页面一律调这几个函数，不再自己 filter：
 *
 * - `hasClip`       出过片了（`vid === 'ok'`，磁盘上有文件）—— **不代表人认可**
 * - `awaitingCall`  出过片但还没判定 —— 命中率算不出来就是因为它不为零
 * - `cutReady`      能进时间线：出过片且没被判「重摇」
 * - `usable`        人判定为可用 —— **只有这个才配叫「可用」**
 *
 * 一条硬规矩：`usable` 永远不由生成流程写。出片只置 `vid`，判定是人的动作。
 * 谁想在生成成功时顺手把 verdict 设成 'ok'，命中率就再也没有意义了。
 */

/** 出过片：磁盘上有这一镜的视频 */
export const hasClip = (s: Shot): boolean => s.vid === 'ok';

/** 出过片但人还没判定 —— 这些就是命中率上不去的原因 */
export const awaitingCall = (s: Shot): boolean => hasClip(s) && s.verdict === null;

/**
 * 能进时间线：出过片，且没被判「重摇」。
 *
 * 未判定的也算 —— 否则一个刚跑完 18 镜的人点自动成片会得到空时间线，
 * 而他并没有做错任何事。判过「重摇」的才排除。
 */
export const cutReady = (s: Shot): boolean => hasClip(s) && s.verdict !== 'redo';

/** 人判定为可用。命中率、单条成本都只认这个 */
export const usable = (s: Shot): boolean => s.verdict === 'ok';

/** 还没出过片，批量转视频要转的就是这些 */
export const needsClip = (s: Shot): boolean => s.vid === 'none' || s.vid === 'redo';

export const countClips = (shots: readonly Shot[]): number => shots.filter(hasClip).length;
export const countAwaiting = (shots: readonly Shot[]): number => shots.filter(awaitingCall).length;
export const countCutReady = (shots: readonly Shot[]): number => shots.filter(cutReady).length;
export const countUsable = (shots: readonly Shot[]): number => shots.filter(usable).length;

/** 能进时间线的总时长，秒 */
export const cutReadyDur = (shots: readonly Shot[]): number =>
  shots.filter(cutReady).reduce((n, s) => n + s.dur, 0);
