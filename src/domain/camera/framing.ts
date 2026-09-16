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

/**
 * 相对竖幅，本画幅下人物占画幅**高度**的倍率。
 *
 * 长边固定 36mm：竖幅（含 1:1）高就是 36mm，横幅高只有 36/aspect ——
 * 纵向视场变窄，同一机位下人物自然占满更多高度。
 * 所以切画幅是**裁切形状变了**，不是把人推远拉近。
 */
export const figureHeightFactor = (aspect: number): number => 36 / sensorHeight(aspect);

/**
 * 参考图输出尺寸：长边 1280，短边按画幅推。
 * 同时满足 api/schemas.ts 的硬约束（两边 ≥300px、宽高比 0.4–2.5）。
 */
export function refImageSize(aspect: number): { width: number; height: number } {
  const LONG = 1280;
  const width = aspect >= 1 ? LONG : Math.round(LONG * aspect);
  const height = aspect >= 1 ? Math.round(LONG / aspect) : LONG;
  return { width, height };
}
