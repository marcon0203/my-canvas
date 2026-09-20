import { describe, expect, it } from 'vitest';
import FIXTURE from '@/store/__fixtures__/rust-patches.json';
import { planTimeline, totalMs } from './model';
import type { Verdict, VidState } from '@/domain/shots/model';

/**
 * 前端的 planTimeline 必须和 Rust 的 `timeline::plan` 算出同一条时间线 ——
 * 两端都能排（浏览器里没有 Rust），所以两端算得不一样这件事必须被测住。
 *
 * 夹具由 `npm run fixtures` 从 Rust 侧生成。
 */
const SHOTS = [
  { id: 's1-1', dur: 2, vid: 'ok', verdict: null },
  { id: 's1-2', dur: 3, vid: 'ok', verdict: null },
  { id: 's1-3', dur: 4, vid: 'ok', verdict: 'redo' },   // 重摇的不进片子
  { id: 's1-4', dur: 4, vid: 'none', verdict: null },   // 没出片的也不进
] satisfies { id: string; dur: number; vid: VidState; verdict: Verdict }[];

describe('时间线 parity', () => {
  it('和 Rust 夹具里的 edit.timeline 一字不差', () => {
    const want = FIXTURE['edit.timeline'];
    const got = planTimeline(SHOTS, 500);
    expect(got).toEqual(want.timeline);
    expect(totalMs(got)).toBe(want.totalMs);
  });

  it('十镜以上按数字排，不按字符串', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `s1-${12 - i}`, dur: 1, vid: 'ok' as VidState, verdict: null as Verdict,
    }));
    expect(planTimeline(many).clips.map((c) => c.shotId))
      .toEqual(Array.from({ length: 12 }, (_, i) => `s1-${i + 1}`));
  });

  it('不卡点时不写 beatMs，起点是累加出来的', () => {
    const t = planTimeline(SHOTS);
    expect(t.beatMs).toBeUndefined();
    expect(t.clips).toEqual([
      { shotId: 's1-1', at: 0, dur: 2000 },
      { shotId: 's1-2', at: 2000, dur: 3000 },
    ]);
  });

  it('对齐用四舍五入，且最少留一个卡点', () => {
    const t = planTimeline([{ id: 's1-1', dur: 0.2, vid: 'ok' as VidState, verdict: null as Verdict }], 1000);
    expect(t.clips[0]!.dur).toBe(1000);   // 200ms 对齐到 0 等于丢掉这段
  });
});
