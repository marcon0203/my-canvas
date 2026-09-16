import { describe, it, expect } from 'vitest';
import { ASPECT, sensorHeight, verticalFov, shotRadius, SHOT_RADIUS, figureHeightFactor, refImageSize, shotRadiusAt, effectiveDist } from './framing';

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

describe('档内连续距离', () => {
  it('整数档与原表一致 —— 插值不改既有档位', () => {
    SHOT_RADIUS.forEach((r, i) => expect(shotRadiusAt(i)).toBe(r));
  });

  it('档与档之间单调递减，不跳变', () => {
    let prev = Infinity;
    for (let d = 0; d <= 6.0001; d += 0.1) {
      const r = shotRadiusAt(d);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it('每 0.1 档的变化幅度远小于整档 —— 这就是"递增幅度减小"', () => {
    const stepJump = shotRadiusAt(3) / shotRadiusAt(4);        // 中景 → 中近景
    const fineJump = shotRadiusAt(3) / shotRadiusAt(3.1);
    expect(stepJump).toBeGreaterThan(1.3);
    expect(fineJump).toBeLessThan(1.08);
  });

  it('对数插值：档内中点是两端的几何平均，感知上才是均匀的', () => {
    expect(shotRadiusAt(3.5)).toBeCloseTo(Math.sqrt(SHOT_RADIUS[3]! * SHOT_RADIUS[4]!), 6);
  });

  it('超出范围被夹住，不会算出负数或无穷', () => {
    expect(shotRadiusAt(-2)).toBe(SHOT_RADIUS[0]);
    expect(shotRadiusAt(99)).toBe(SHOT_RADIUS[6]);
  });

  it('effectiveDist：没有微调时就是档位本身', () => {
    expect(effectiveDist({ dist: 3 })).toBe(3);
    expect(effectiveDist({ dist: 3, distFine: -0.4 })).toBeCloseTo(2.6);
  });
});
