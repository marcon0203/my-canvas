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

/**
 * 节点级画风 → 英文片段。'全局'（或空）表示跟项目走，
 * 否则查词表；查不到就原样带上（自定义风格名）。
 */
export function styleFrag(style: string | undefined, globalStylePrompt = ''): string {
  if (!style || style === '全局') return globalStylePrompt;
  return STYLEMAP[style] ?? style;
}

/** 一张形状照的自动合成提示词：风格 + 形状照描述 + 镜头语言 */
export function viewPrompt(v: AssetView, globalStylePrompt = ''): string {
  return [styleFrag(v.style, globalStylePrompt), v.prompt, ...rigFrags(viewRig(v))]
    .filter(Boolean)
    .join(', ');
}

/** 实际拿去生成的那条：手改过就用手改的，否则走自动合成 */
export const viewPromptText = (v: AssetView, globalStylePrompt = ''): string =>
  v.custom ?? viewPrompt(v, globalStylePrompt);

/** 这张是不是已经脱管（手改过，不再跟画风/镜头语言联动） */
export const isViewEjected = (v: AssetView): boolean => v.custom !== undefined;

/** 生成一张形状照/一镜的提示词也按段落合成，供界面按来源上色 */
export function viewSegments(v: AssetView, globalStylePrompt = ''): PromptSegment[] {
  const segs: PromptSegment[] = [{ k: 'style', v: styleFrag(v.style, globalStylePrompt) }];
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
  // 走 styleFrag：词表里没有的自定义画风名要原样带上。
  // 原来这儿是 `STYLEMAP[s.style] ?? globalStylePrompt` —— 用户给这一镜单独选了
  // 一个自定义画风，会被静默换成项目画风，而形状照那条路（styleFrag）不会。
  // 同一个概念两种行为，是 Rust 侧的 parity 测试把它抓出来的。
  parts.push({ k: 'style', v: styleFrag(s.style, opts.globalStylePrompt) });
  for (const aid of s.refs) {
    const d = opts.assetDescOf(aid);
    if (d) parts.push({ k: 'ref', v: d });
  }
  // 先 trim：模型回来的本镜内容常带空白，`'   '` 是 truthy，会变成一个空段落
  const own = s.own?.trim();
  if (own) parts.push({ k: 'own', v: own });
  return parts;
}

/**
 * 分段 → 真正发出去的那条。**空段落要滤掉**：画风没设时会留一个空的 style 段，
 * 不滤的话提示词以 `, ` 开头 —— 出图模型会把它读成一个空槽。
 * 分段本身保留空的 style 段，界面按 k 上色要靠它占位。
 */
export const segmentsText = (segs: readonly PromptSegment[]): string =>
  segs.map((p) => p.v.trim()).filter(Boolean).join(', ');
