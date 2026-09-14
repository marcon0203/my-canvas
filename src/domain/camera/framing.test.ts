import { describe, it, expect } from 'vitest';
import { ASPECT, sensorHeight, verticalFov, shotRadius, SHOT_RADIUS } from './framing';

describe('画幅与视场角', () => {
  it('竖画幅长边是高，横画幅长边是宽', () => {
    expect(sensorHeight(ASPECT['9:16'])).toBe(36);
    expect(sensorHeight(ASPECT['1:1'])).toBe(36);
    expect(sensorHeight(ASPECT['16:9'])).toBeCloseTo(20.25, 2);
  });

  it('同焦距下，画幅越宽垂直视场角越小', () => {
    const fovs = (['9:16', '1:1', '4:3', '16:9', '2.39:1'] as const).map((r) =>
      verticalFov(ASPECT[r], 50),
    );
    expect(fovs).toEqual([...fovs].sort((a, b) => b - a));
  });

  it('焦距越长视场角越小', () => {
    const wide = verticalFov(ASPECT['9:16'], 24);
    const tele = verticalFov(ASPECT['9:16'], 135);
    expect(wide).toBeGreaterThan(tele);
  });
});

describe('景别与距离', () => {
  it('景别档越大摄影机越近，必须单调递减', () => {
    expect(SHOT_RADIUS).toEqual([...SHOT_RADIUS].sort((a, b) => b - a));
  });

  it('特写比大远景近一个数量级以上', () => {
    expect(shotRadius(0) / shotRadius(6)).toBeGreaterThan(10);
  });
});
