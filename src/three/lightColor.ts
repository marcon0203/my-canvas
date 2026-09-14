import { Color } from 'three';
import { GELS, gelOf, hueName } from '@/domain/prompt/vocabulary';
import type { GelKey } from '@/domain/assets/model';

/**
 * 色温 → RGB（Kelvin 近似公式），再叠色片。
 * 主光最终颜色 = 色温 × 色片；轮廓光独立取色。
 */
export function kelvinColor(kelvin: number): Color {
  const t = kelvin / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.52 * Math.log(t - 10) - 305.04;
  const f = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new Color(f(r), f(g), f(b));
}

export function keyLightColor(rig: { kelvin: number; gel: GelKey; gelHex?: string }): Color {
  const base = kelvinColor(rig.kelvin);
  const hex = rig.gel === 'custom' ? (rig.gelHex || '#ffffff') : gelOf(rig.gel).c;
  return base.multiply(new Color(hex));
}

export { GELS, hueName };
