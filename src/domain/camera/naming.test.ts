import { describe, expect, it } from 'vitest';
import { azName, azFace, azFrag, elName, lightName, kName, distName } from './naming';
import { stageCamPos, stageLightPos, shotCamera, stageOrbitRadius } from './geometry';
import type { DistStep } from '@/domain/types';

describe('camera/naming', () => {
  it('方位角分档正确且左右对称', () => {
    expect(azName(0)).toBe('正面');
    expect(azName(45)).toBe('右前方');
    expect(azName(-45)).toBe('左前方');
    expect(azName(90)).toBe('右正侧');
    expect(azName(150)).toBe('右后方');
    expect(azName(170)).toBe('背后');
    expect(azName(180)).toBe('背后');
  });

  it('界面朝向与提示词片段各说各的参照系', () => {
    expect(azFace(60)).toBe('朝画面左');
    expect(azFrag(0)).toContain('full frontal');
    expect(azFrag(90)).toContain('side profile');
    expect(azFrag(180)).toContain('behind');
  });

  it('俯仰 / 光型 / 色温', () => {
    expect(elName(-30)).toBe('仰拍');
    expect(elName(0)).toBe('平视');
    expect(elName(50)).toBe('俯拍');
    expect(lightName(0, 60)).toBe('顶光');
    expect(lightName(-60, 20)).toBe('斜上侧光');
    expect(lightName(180, 14)).toBe('逆光');
    expect(kName(3200)).toBe('钨丝暖');
    expect(kName(7500)).toBe('冷蓝');
  });

  it('距离档 → 景别名', () => {
    expect(distName(0)).toBe('大远景');
    expect(distName(6)).toBe('特写');
  });
});

describe('camera/geometry', () => {
  it('轨道半径随景别单调递减且落在画布范围内', () => {
    let prev = Infinity;
    for (let d = 0 as DistStep; d <= 6; d = (d + 1) as DistStep) {
      const r = stageOrbitRadius(d);
      expect(r).toBeLessThanOrEqual(132);
      expect(r).toBeGreaterThanOrEqual(42);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it('正面机位在 +z，背后机位在 -z，仰拍抬高俯拍压低', () => {
    const front = stageCamPos({ dist: 3, az: 0, el: 0 });
    expect(front.z).toBeGreaterThan(0);
    const back = stageCamPos({ dist: 3, az: 180, el: 0 });
    expect(back.z).toBeLessThan(0);
    const high = stageCamPos({ dist: 3, az: 0, el: 50 });
    const low = stageCamPos({ dist: 3, az: 0, el: -30 });
    expect(high.y).toBeGreaterThan(low.y);
  });

  it('灯轨道半径固定', () => {
    const p = stageLightPos({ lightAz: 120, lightEl: 10 });
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(150 * Math.cos(10 * Math.PI / 180), 5);
  });

  it('取景相机：焦段变化改 FOV 与距离，但视线目标恒为胸口', () => {
    const wide = shotCamera({ dist: 3, az: 0, el: 0, angle: '', mm: '24mm', ratio: '9:16' });
    const tele = shotCamera({ dist: 3, az: 0, el: 0, angle: '', mm: '135mm', ratio: '9:16' });
    expect(wide.fov).toBeGreaterThan(tele.fov);
    expect(wide.target).toEqual({ x: 0, y: 38, z: 0 });
    const rWide = Math.hypot(wide.position.x, wide.position.z);
    const rTele = Math.hypot(tele.position.x, tele.position.z);
    expect(rTele).toBeGreaterThan(rWide);
  });

  it('荷兰角带 8° 滚转', () => {
    expect(shotCamera({ dist: 3, az: 0, el: 0, angle: '荷兰角', mm: '50mm' }).roll).toBe(8);
  });
});
