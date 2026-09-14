import type { AspectRatio, DistStep, ShotSize } from '@/domain/types';
import { SIZE_ORDER } from '@/domain/types';

/** 画幅比值（宽 / 高） */
export const ASPECT: Record<AspectRatio, number> = {
  '9:16': 9 / 16,
  '3:4': 3 / 4,
  '4:5': 4 / 5,
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '2.39:1': 2.39,
};

/**
 * 传感器长边固定 36mm，映射到画面长边。
 * 竖画幅时 36mm 是高，横画幅时 36mm 是宽 —— 不这么算，切到横幅取景就是错的。
 */
export const sensorHeight = (aspect: number): number => (aspect < 1 ? 36 : 36 / aspect);

/** 垂直视场角（度） */
export const verticalFov = (aspect: number, focalMm: number): number =>
  2 * Math.atan(sensorHeight(aspect) / 2 / focalMm) * (180 / Math.PI);

/** 景别档 → 名称 */
export const sizeOf = (d: DistStep): ShotSize => SIZE_ORDER[d];

/** 真实拍摄距离：景别越近，摄影机离人越近 */
export const SHOT_RADIUS: readonly number[] = [720, 300, 109, 65, 46, 29, 16];

export const shotRadius = (d: DistStep): number => SHOT_RADIUS[d]!;
