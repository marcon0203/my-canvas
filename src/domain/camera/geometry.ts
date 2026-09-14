import type { DistStep } from '@/domain/types';
import { SHOT_RADIUS, verticalFov, ASPECT } from './framing';
import type { AspectRatio } from '@/domain/types';

/**
 * 方位/俯仰/距离 ↔ 世界坐标；轨道半径、视高。
 * 舞台指示物、真实取景相机、取景示意 SVG 三处共用同一套算法，
 * 否则「平视」在图里看着像仰视。
 */

export const DEG2RAD = Math.PI / 180;

/** 舞台上约定的视线高（世界单位） */
export const STAGE_EYE = 38;

/** 舞台轨道半径：与 SHOT_RADIUS 同向，16–720 的跨度画不下，对数压到 42–132 */
export function stageOrbitRadius(d: DistStep): number {
  const r = SHOT_RADIUS[d]!;
  const t = (Math.log(r) - Math.log(16)) / (Math.log(720) - Math.log(16));
  return 42 + 90 * t;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const onOrbit = (azDeg: number, elDeg: number, radius: number, eyeY: number): Vec3 => {
  const rr = radius * Math.cos(elDeg * DEG2RAD);
  return {
    x: rr * Math.sin(azDeg * DEG2RAD),
    y: eyeY + radius * Math.sin(elDeg * DEG2RAD),
    z: rr * Math.cos(azDeg * DEG2RAD),
  };
};

/** 摄影机指示物在舞台上的位置 */
export const stageCamPos = (rig: { dist: DistStep; az: number; el: number }): Vec3 =>
  onOrbit(rig.az, rig.el, stageOrbitRadius(rig.dist), STAGE_EYE);

/** 灯指示物在舞台上的位置（固定轨道半径） */
export const LIGHT_ORBIT = 150;
export const stageLightPos = (rig: { lightAz: number; lightEl: number }): Vec3 =>
  onOrbit(rig.lightAz, rig.lightEl, LIGHT_ORBIT, STAGE_EYE);

/** 真实取景相机的定位：距离档定景别，焦段变则后退/前凑，取景不变、透视压缩变 */
export function shotCamera(
  rig: { dist: DistStep; az: number; el: number; angle: string; mm: string; ratio?: string },
): { fov: number; position: Vec3; target: Vec3; roll: number } {
  const focal = parseInt(rig.mm, 10) || 50;
  const aspect = ASPECT[(rig.ratio || '9:16') as AspectRatio] ?? 9 / 16;
  const fov = Math.min(110, Math.max(6, verticalFov(aspect, focal)));
  const R = SHOT_RADIUS[rig.dist]! * (focal / 50);
  const az = rig.az * DEG2RAD;
  const el = (rig.angle === '顶拍' ? 85 : rig.el) * DEG2RAD;
  const ty = STAGE_EYE; // 对准胸口，头顶自然留白
  return {
    fov,
    position: {
      x: R * Math.sin(az) * Math.cos(el),
      y: ty + R * Math.sin(el),
      z: R * Math.cos(az) * Math.cos(el),
    },
    target: { x: 0, y: ty, z: 0 },
    roll: rig.angle === '荷兰角' ? 8 : 0,
  };
}

/** 人物占画幅高度的倍数（取景示意 SVG 用）：>1 表示已被画框裁切 */
export const FIGURE_SCALE: Record<string, number> = {
  '大远景': 0.10, '远景': 0.24, '全景': 0.66, '中景': 1.10, '中近景': 1.55, '近景': 2.5, '特写': 4.4,
};
