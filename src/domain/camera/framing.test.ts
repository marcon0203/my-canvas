import { describe, it, expect } from 'vitest';
import { ASPECT, sensorHeight, verticalFov, shotRadius, SHOT_RADIUS, figureHeightFactor, refImageSize } from './framing';

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

describe('画幅换算', () => {
  it('竖幅与方幅的纵向视场一致 —— 人物占高比例不变', () => {
    expect(figureHeightFactor(ASPECT['9:16'])).toBeCloseTo(1);
    expect(figureHeightFactor(ASPECT['3:4'])).toBeCloseTo(1);
    expect(figureHeightFactor(ASPECT['1:1'])).toBeCloseTo(1);
  });

  it('横幅纵向视场变窄 —— 同一机位下人物占更多高度', () => {
    expect(figureHeightFactor(ASPECT['16:9'])).toBeCloseTo(16 / 9);
    expect(figureHeightFactor(ASPECT['2.39:1'])).toBeCloseTo(2.39);
    // 越横，人物占高越多
    expect(figureHeightFactor(ASPECT['16:9'])).toBeGreaterThan(figureHeightFactor(ASPECT['4:3']));
  });

  it('参考图尺寸满足接口硬约束：两边 ≥300、宽高比 0.4–2.5', () => {
    for (const [name, a] of Object.entries(ASPECT)) {
      const { width, height } = refImageSize(a);
      expect(Math.min(width, height), name).toBeGreaterThanOrEqual(300);
      expect(width / height, name).toBeCloseTo(a, 2);
      expect(Math.max(width, height), name).toBe(1280);
    }
  });
});
