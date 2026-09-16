import type { Modality } from '@/domain/providers/model';
import type { AgentId } from './roster';
import type { IntentKind } from './types';

/**
 * 工具：Agent 真正能动手的那些事。
 *
 * 每一项都对应产品里已经存在的能力（写大纲、出图、渲参考图、算账…），
 * 不是通用的「web search / code interpreter」清单 —— 编一堆用不上的工具没有意义。
 *
 * 工具决定**能不能干**，技能（IntentKind）决定**接不接这个活**。
 * 两者分开：一个 Agent 可以有出图工具却不接「补形状照」这个活。
 */
export type ToolId =
  | 'project.read'
  | 'outline.write'
  | 'script.write'
  | 'asset.write'
  | 'asset.lock'
  | 'shot.write'
  | 'prompt.compile'
  | 'image.generate'
  | 'video.generate'
  | 'stage.render'
  | 'metrics.read'
  | 'file.export';

export interface ToolSpec {
  readonly id: ToolId;
  readonly name: string;
  readonly desc: string;
  /** 需要哪种模型才能跑。undefined = 纯本地操作，不调模型 */
  readonly needs?: Modality;
  /** 会改项目内容（进撤销历史），界面上标出来 */
  readonly writes?: boolean;
}

export const TOOLS: readonly ToolSpec[] = [
  { id: 'project.read', name: '读项目', desc: '读大纲、剧本、资产、分镜与记账数据' },
  { id: 'outline.write', name: '写大纲', desc: '起草或补充幕与场次', needs: 'text', writes: true },
  { id: 'script.write', name: '写剧本', desc: '写正文块、润色已有段落', needs: 'text', writes: true },
  { id: 'asset.write', name: '建资产', desc: '新建角色/场景/道具，写形状照描述', needs: 'text', writes: true },
  { id: 'asset.lock', name: '资产定稿', desc: '锁定版本，让分镜可以引用', writes: true },
  { id: 'shot.write', name: '写分镜', desc: '拆镜、改镜头字段与引用', needs: 'text', writes: true },
  { id: 'prompt.compile', name: '合成提示词', desc: '画风 + 资产 + 镜头语言 → 英文提示词', needs: 'text', writes: true },
  { id: 'image.generate', name: '出图', desc: '生成形状照与关键帧', needs: 'image', writes: true },
  { id: 'video.generate', name: '出视频', desc: '关键帧 → 片段', needs: 'video', writes: true },
  { id: 'stage.render', name: '渲参考图', desc: '布光台离屏渲染白模参考图（本地 WebGL，不花钱）' },
  { id: 'metrics.read', name: '读记账', desc: '命中率、消耗、按模型与景别归因' },
  { id: 'file.export', name: '导出文件', desc: '导出剧本 .md、成片 .mp4' },
];

const BY_ID = new Map(TOOLS.map((t) => [t.id, t]));
export const toolOf = (id: ToolId): ToolSpec | undefined => BY_ID.get(id);

/** 一件活儿至少要哪些工具才干得成 —— 勾掉工具就该看到对应技能变灰 */
export const TOOLS_FOR_INTENT: Record<Exclude<IntentKind, 'chat'>, readonly ToolId[]> = {
  'outline.draft': ['project.read', 'outline.write'],
  'outline.expand': ['project.read', 'outline.write'],
  'script.draft': ['project.read', 'script.write'],
  'script.polish': ['project.read', 'script.write'],
  'assets.extract': ['project.read', 'asset.write'],
  'assets.views': ['project.read', 'image.generate'],
  'style.transfer': ['project.read', 'prompt.compile'],
  'shots.generate': ['project.read', 'shot.write'],
  'shots.prompt': ['project.read', 'prompt.compile'],
  'video.batch': ['project.read', 'video.generate'],
  // 只排时间线，不导出 —— 导出是剪辑页上另一个按钮，别把它捆进来
  'edit.autocut': ['project.read', 'shot.write'],
  'cost.report': ['metrics.read'],
};

/** 这套工具够不够接这件活 */
export const canRun = (tools: readonly ToolId[], kind: IntentKind): boolean =>
  kind === 'chat' || TOOLS_FOR_INTENT[kind].every((t) => tools.includes(t));

/** 缺哪几件工具 */
export const missingTools = (tools: readonly ToolId[], kind: IntentKind): ToolId[] =>
  kind === 'chat' ? [] : TOOLS_FOR_INTENT[kind].filter((t) => !tools.includes(t));

/** 一个 Agent 的默认工具：它认领的活儿所需的并集 + 读项目 */
export function defaultTools(owns: readonly IntentKind[]): ToolId[] {
  const set = new Set<ToolId>(['project.read']);
  for (const k of owns) {
    if (k === 'chat') continue;
    for (const t of TOOLS_FOR_INTENT[k]) set.add(t);
  }
  return TOOLS.filter((t) => set.has(t.id)).map((t) => t.id);
}

/** 摄影指导额外拿到布光台与定稿权 —— 它是 3D 那块的主人 */
export const EXTRA_TOOLS: Partial<Record<AgentId, readonly ToolId[]>> = {
  dp: ['stage.render', 'image.generate'],
  art: ['stage.render', 'asset.lock'],
};
