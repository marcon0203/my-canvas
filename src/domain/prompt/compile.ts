import type { AssetView, Rig } from '@/domain/assets/model';
import { viewRig } from '@/domain/assets/model';
import type { Degrees } from '@/domain/types';
import { azFrag, brFrag, elFrag, kFrag, lightFrag, ratioFrag } from '@/domain/camera/naming';
import { gelFrag, gearFrag, hueName, POSE_FRAG, STYLEMAP, cineFrag } from './vocabulary';

const rimHue = (hex?: string) => hueName(hex || '#8FB8FF');

/** 提示词片段：k 是来源，界面上按来源上色 */
export type SegmentKind = 'style' | 'ref' | 'own';

export interface PromptSegment {
  readonly k: SegmentKind;
  readonly v: string;
}

/** 姿态 + 机位 → 一句话，给「文字 / 两者」模式用 */
export function poseText(r: Rig): string {
  const pose = POSE_FRAG[r.pose] ?? 'neutral standing';
  const occupy = r.dist >= 5 ? 'subject fills the frame'
    : r.dist >= 3 ? 'subject occupies the center of frame'
    : 'subject small within a wide environment';
  return [
    `subject in a ${pose} pose`,
    azFrag(r.az as Degrees),
    elFrag(r.el),
    occupy,
  ].join(', ');
}

/** 形状照 / 镜头共用的镜头语言段。数组项为空串时被滤掉 */
export function rigFrags(r: Rig): string[] {
  return [
    ratioFrag(r.ratio || '9:16'),
    r.poseMode === 'text' || r.poseMode === 'both' ? poseText(r) : '',
    r.poseRef && r.poseMode !== 'text' ? 'pose and framing per the grey reference render' : '',
    cineFrag('size', r.size),
    azFrag(r.az as Degrees),
    elFrag(r.el),
    r.angle ? cineFrag('angle', r.angle) : '',
    gearFrag('body', r.body),
    gearFrag('lensKit', r.lensKit),
    gearFrag('mm', r.mm),
    gearFrag('fstop', r.fstop),
    lightFrag(r.lightAz, r.lightEl),
    kFrag(r.kelvin),
    brFrag(r.bright),
    gelFrag(r.gel, r.gelHex),
    r.rim ? `rim light separation in ${rimHue(r.rimHex)}` : '',
    r.cam && r.cam !== '固定' ? cineFrag('cam', r.cam) : '',
    ...(['light', 'comp', 'time', 'mood'] as const).flatMap((k) =>
      (r[k] ?? []).map((n) => cineFrag(k, n))),
  ].filter(Boolean);
}

/** 一张形状照的完整提示词：风格 + 形状照描述 + 镜头语言 */
export function viewPrompt(v: AssetView): string {
  return [STYLEMAP[v.style] ?? v.style, v.prompt, ...rigFrags(viewRig(v))]
    .filter(Boolean)
    .join(', ');
}

/** 生成一张形状照/一镜的提示词也按段落合成，供界面按来源上色 */
export function viewSegments(v: AssetView): PromptSegment[] {
  const segs: PromptSegment[] = [{ k: 'style', v: STYLEMAP[v.style] ?? v.style }];
  if (v.prompt) segs.push({ k: 'own', v: v.prompt });
  rigFrags(viewRig(v)).forEach((f) => segs.push({ k: 'ref', v: f }));
  return segs;
}

/**
 * 分镜提示词三段式：画风 + 资产引用 + 本镜描述。
 * 资产段自动展开（引用资产的设定），不要求用户在每条提示词里手贴角色描述。
 * 景别机位等镜头语言不在这里 —— 生成资产形状照时已定好，随参考图走。
 */
export function compileShot(
  s: { style?: string; refs: readonly string[]; own?: string },
  opts: { globalStylePrompt: string; assetDescOf: (aid: string) => string | undefined },
): PromptSegment[] {
  const parts: PromptSegment[] = [];
  const style = s.style && s.style !== '全局' ? STYLEMAP[s.style] : undefined;
  parts.push({ k: 'style', v: style ?? opts.globalStylePrompt });
  for (const aid of s.refs) {
    const d = opts.assetDescOf(aid);
    if (d) parts.push({ k: 'ref', v: d });
  }
  if (s.own) parts.push({ k: 'own', v: s.own });
  return parts;
}

export const segmentsText = (segs: readonly PromptSegment[]): string => segs.map((p) => p.v).join(', ');
