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
