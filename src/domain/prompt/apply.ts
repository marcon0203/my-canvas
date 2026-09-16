import type { Rig, CineKey } from '@/domain/assets/model';
import { viewRig, type AssetView } from '@/domain/assets/model';
import { SIZE_ORDER } from '@/domain/types';
import type { Intent } from './vocabulary';
import { intentPatch, type RigAngle } from './vocabulary';

/**
 * 意图卡 → rig 的应用逻辑（domain 层唯一一份）：
 * 尺寸档换距离、俯仰词换角度、过肩带方位、lens/dof 换算 mm/fstop，
 * 同时把涉及的维度加入专业模式展开列表。
 */
export function applyIntentToView(v: AssetView, it: Intent): void {
  applyIntentToRig(viewRig(v), it);
}

export function applyIntentToRig(r: Rig, it: Intent): void {
  const p = intentPatch(it);
  if (p.size) r.size = p.size as Rig['size'];
  if (p.angle !== undefined) {
    r.angle = p.angle as RigAngle;
    if (p.angle === '过肩' && r.az === 0) r.az = 150;
  }
  if (p.cam) r.cam = p.cam;
  if (p.mm) r.mm = p.mm;
  if (p.fstop) r.fstop = p.fstop;
  for (const k of ['light', 'comp', 'time', 'mood'] as const) {
    const v = p[k];
    if (v) (r[k] as string[]) = [...v];
  }
  for (const k of p.addDims ?? []) {
    if (!r.dims.includes(k)) r.dims.push(k);
  }
  // 尺寸档与距离档同步：意图给的是景别词，rig 存的是距离档
  // 换景别就回到该档正中，别把上一次的档内微调带过来
  if (p.size) { r.dist = sizeToDist(p.size); r.distFine = 0; }
  else if (p.dist !== undefined) { r.dist = p.dist as Rig['dist']; r.distFine = 0; }
}

function sizeToDist(size: string): Rig['dist'] {
  const i = SIZE_ORDER.indexOf(size as (typeof SIZE_ORDER)[number]);
  return (i === -1 ? 3 : i) as Rig['dist'];
}

/** 「套用到其它形状照」复制的机位/灯光/器材字段，景别各留各的 */
export const RIG_COPY_KEYS: readonly (keyof Rig)[] = [
  'az', 'el', 'lightAz', 'lightEl', 'bright', 'kelvin', 'rim', 'rimHex', 'gel', 'gelHex',
  'body', 'lensKit', 'mm', 'fstop', 'cam',
];

export type { CineKey };
