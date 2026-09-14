import type { DistStep } from '@/domain/types';
import { sizeOf } from './framing';

/**
 * 角度 → 界面名 / 画面朝向 / 英文提示词片段。
 * 界面说「摄影机在哪」，提示词说「画面看起来什么样」——
 * 图像模型学的是图片描述，不是摄影笔记，两个参照系都要给。
 */

export const azSide = (a: number): '左' | '右' => (a > 0 ? '右' : '左');

export const azName = (a: number): string => {
  const x = Math.abs(a);
  if (x < 20) return '正面';
  if (x > 160) return '背后';
  return azSide(a) + (x < 65 ? '前方' : x < 115 ? '正侧' : '后方');
};

/** 人物在画面里的朝向，给界面用 */
export const azFace = (a: number): string => {
  const x = Math.abs(a);
  if (x < 20) return '正对镜头';
  if (x > 160) return '背对镜头';
  return '朝画面' + (a > 0 ? '左' : '右');
};

export const azFrag = (a: number): string => {
  const x = Math.abs(a);
  const side = a > 0 ? 'left' : 'right';
  if (x < 20) return 'facing the camera directly, full frontal view of the face';
  if (x < 65) return `three-quarter view, body angled, face turned toward the ${side} of frame`;
  if (x < 115) return `full side profile, facing the ${side} of frame`;
  if (x < 160) return `rear three-quarter view, mostly back to camera, cheek turned to the ${side}`;
  return 'seen from directly behind, back to camera, face not visible';
};

export const elName = (e: number): string =>
  e < -18 ? '仰拍' : e < -6 ? '略仰' : e <= 10 ? '平视' : e <= 28 ? '略俯' : '俯拍';

export const elFrag = (e: number): string =>
  e < -18 ? 'low angle shot, camera below the subject looking up'
  : e < -6 ? 'slightly low angle, camera just below eye height'
  : e <= 10 ? 'eye level, camera at the subject eye height'
  : e <= 28 ? 'slightly high angle, camera just above eye height'
  : 'high angle shot, camera above the subject looking down';

export const distName = (d: DistStep): string => sizeOf(d);

/** 灯位（方位 + 高度）落到摄影上常说的那几种光型 */
export const lightName = (a: number, e: number): string => {
  const x = Math.abs(a);
  if (e > 40) return '顶光';
  if (e < -25) return '底光';
  if (x < 30) return '正面光';
  if (x < 75) return e > 15 ? '斜上侧光' : '侧光';
  if (x < 130) return '侧逆光';
  return '逆光';
};

const LIGHT_FRAG: Record<string, string> = {
  '顶光': 'top lighting from above',
  '底光': 'uplighting from below',
  '正面光': 'frontal key light',
  '斜上侧光': 'high side key light',
  '侧光': 'side key light, strong modeling',
  '侧逆光': 'three-quarter backlight',
  '逆光': 'backlit, strong rim separation',
};

export const lightFrag = (a: number, e: number): string => LIGHT_FRAG[lightName(a, e)] ?? 'natural lighting';

export const kName = (k: number): string =>
  k < 3000 ? '烛光暖' : k < 4000 ? '钨丝暖' : k < 5200 ? '中性偏暖' : k < 6000 ? '日光中性' : k < 7000 ? '阴天偏冷' : '冷蓝';

export const kFrag = (k: number): string =>
  k < 3200 ? 'very warm tungsten color, 2700K'
  : k < 4500 ? 'warm tungsten lighting, 3800K'
  : k < 5800 ? 'neutral daylight, 5600K'
  : k < 6800 ? 'cool overcast light, 6500K'
  : 'cold blue tone, 7500K';

export const brFrag = (b: number): string =>
  b < 30 ? 'dim, underexposed, moody'
  : b < 55 ? 'soft moderate exposure'
  : b < 80 ? 'well lit'
  : 'bright, high exposure';

export const ratioFrag = (r: string): string =>
  (({
    '9:16': 'vertical 9:16 framing',
    '3:4': '3:4 portrait framing',
    '4:5': '4:5 portrait framing',
    '1:1': 'square 1:1 framing',
    '4:3': '4:3 framing',
    '16:9': 'widescreen 16:9 framing',
    '2.39:1': 'anamorphic 2.39:1 widescreen',
  }) as Record<string, string>)[r] ?? 'vertical 9:16 framing';
