import { describe, expect, it } from 'vitest';
import { makeShot } from './model';
import type { Shot } from './model';
import type { Verdict, VidState } from './model';
import {
  awaitingCall, countAwaiting, countCutReady, countUsable, cutReady, cutReadyDur,
  hasClip, needsClip, usable,
} from './usable';

const shot = (vid: VidState, verdict: Verdict, dur = 3): Shot =>
  ({ ...makeShot('s1-1', '场景1'), vid, verdict, dur });

describe('可用口径', () => {
  it('出过片不等于可用 —— 这就是两页对不上的那个洞', () => {
    const s = shot('ok', null);
    expect(hasClip(s)).toBe(true);
    expect(usable(s)).toBe(false);   // 人还没判
    expect(awaitingCall(s)).toBe(true);
    expect(cutReady(s)).toBe(true);  // 但能进时间线
  });

  it('判了重摇就不进时间线，也不算可用', () => {
    const s = shot('ok', 'redo');
    expect(cutReady(s)).toBe(false);
    expect(usable(s)).toBe(false);
    expect(awaitingCall(s)).toBe(false);
  });

  it('判了可用：三个都成立', () => {
    const s = shot('ok', 'ok');
    expect(hasClip(s)).toBe(true);
    expect(cutReady(s)).toBe(true);
    expect(usable(s)).toBe(true);
    expect(awaitingCall(s)).toBe(false);
  });

  it('没出过片的什么都不算', () => {
    for (const v of ['none', 'run'] as const) {
      const s = shot(v, null);
      expect(hasClip(s)).toBe(false);
      expect(cutReady(s)).toBe(false);
      expect(usable(s)).toBe(false);
    }
  });

  it('待转 = 没出过片或判了重摇要重出', () => {
    expect(needsClip(shot('none', null))).toBe(true);
    expect(needsClip(shot('redo', null))).toBe(true);
    expect(needsClip(shot('run', null))).toBe(false);  // 正在跑，别重复排队
    expect(needsClip(shot('ok', null))).toBe(false);
  });

  it('复现走查里那一幕：18 镜出完片、零判定', () => {
    const shots = Array.from({ length: 18 }, () => shot('ok', null, 3));
    expect(countCutReady(shots)).toBe(18);   // 剪辑页看到 18
    expect(countUsable(shots)).toBe(0);      // 数据页看到 0
    expect(countAwaiting(shots)).toBe(18);   // 差额有名字，界面据此给引导
    expect(cutReadyDur(shots)).toBe(54);
  });
});
