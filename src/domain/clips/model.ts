import type { Shot } from '@/domain/shots/model';
import { cutReady } from '@/domain/shots/usable';

/** 排时间线只看这两个字段（与 usable.ts 的 Judged 同一套口径） */
type Judged = Pick<Shot, 'vid' | 'verdict'>;
/**
 * 时间线与字幕：成片那两步的数据。
 *
 * 剪辑页上那三条轨原来是写死的占位 —— 工具没有可写的目标，做出来也只能
 * 假装成功。这份模型与 Rust 侧 `doc/src/timeline.rs` 同形（有 parity 测试）。
 *
 * 时间一律用**毫秒整数**：秒用浮点会在累加二十段之后差出几十毫秒，
 * 而卡点对齐这件事对几十毫秒是敏感的。
 */

export interface Clip {
  readonly shotId: string;
  /** 起点，毫秒。由累加算出来，不手填 */
  readonly at: number;
  readonly dur: number;
}

export interface Cue {
  readonly at: number;
  readonly dur: number;
  readonly text: string;
}

export interface Timeline {
  readonly clips: readonly Clip[];
  /** 有值表示按这个卡点对齐过 */
  readonly beatMs?: number;
}

export interface Subtitles {
  readonly lang: string;
  readonly cues: readonly Cue[];
}

export const EMPTY_TIMELINE: Timeline = Object.freeze({ clips: Object.freeze([]) as readonly Clip[] });
export const EMPTY_SUBTITLES: Subtitles = Object.freeze({ lang: 'zh', cues: Object.freeze([]) as readonly Cue[] });

/** 片长（毫秒）。没有片段就是 0 —— 不是 undefined，界面要能直接算宽度 */
export const totalMs = (t: Timeline): number => {
  const last = t.clips[t.clips.length - 1];
  return last ? last.at + last.dur : 0;
};

/** 秒数显示。`6500 → 6.5s`，整秒不显示小数点 */
export const secText = (ms: number): string => {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
};

/** 某个时刻在播哪一段 */
export const clipAt = (t: Timeline, ms: number): Clip | undefined =>
  t.clips.find((c) => ms >= c.at && ms < c.at + c.dur);

/**
 * 排时间线。与 Rust 侧 `doc/src/timeline.rs::plan` 同形（有 parity 测试）。
 *
 * 为什么前端也要有一份：「自动成片」原来的产物是 `{ t: 'run', action: 'edit.autocut' }`，
 * 采纳下去只弹一句「已按场次顺序排好可用片段」—— **什么都没写**。
 * 时间线是纯数据（顺序 + 时长），算它不需要 Rust，所以这一步在哪端都能真的落地。
 *
 * `beatMs` 有值时把每段时长对齐到卡点的整数倍。对齐用四舍五入而不是向上取整：
 * 向上取整会让每一段都变长，二十段之后片子比预期长一截。
 */
export function planTimeline(
  shots: readonly (Judged & { id: string; dur: number })[],
  beatMs?: number,
): Timeline {
  // 口径走统一的那份词表，不在这儿手写 —— 两端算得不一样就是成片顺序不一样
  const list = shots
    .filter(cutReady)
    .slice()
    .sort((a, b) => {
      const [a1, a2] = sortKey(a.id);
      const [b1, b2] = sortKey(b.id);
      return a1 - b1 || a2 - b2;
    });
  const beat = beatMs && beatMs > 0 ? beatMs : undefined;
  let at = 0;
  const clips: Clip[] = [];
  for (const s of list) {
    let dur = Math.round(Math.max(s.dur, 0.1) * 1000);
    // 最少留一个卡点 —— 对齐成 0 长度等于丢掉这段
    if (beat) dur = Math.max(Math.round(dur / beat), 1) * beat;
    clips.push({ shotId: s.id, at, dur });
    at += dur;
  }
  return beat ? { clips, beatMs: beat } : { clips };
}

/**
 * 场次序号 + 镜号里的序号。
 *
 * 按字符串排会把 `s1-10` 排在 `s1-2` 前面 —— 十镜以上的场次顺序就乱了，
 * 而乱掉的成片顺序是那种「看着怪但说不出哪儿怪」的问题。
 */
function sortKey(id: string): [number, number] {
  const nums = id.split(/\D+/).filter(Boolean).map(Number);
  return [nums[0] ?? 0, nums[1] ?? 0];
}
