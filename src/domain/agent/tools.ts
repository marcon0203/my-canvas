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
  // 读
  | 'project.read' | 'project.search' | 'metrics.read' | 'cost.estimate'
  // 写项目
  | 'outline.write' | 'script.write' | 'asset.write' | 'asset.lock' | 'shot.write'
  // 提示词
  | 'prompt.compile' | 'prompt.translate' | 'style.apply'
  // 生成
  | 'image.generate' | 'image.edit' | 'image.upscale'
  | 'video.generate' | 'video.extend'
  | 'audio.tts' | 'audio.music' | 'audio.sfx'
  // 镜头
  | 'stage.render' | 'shot.rig'
  // 成片
  | 'edit.timeline' | 'edit.subtitle' | 'file.export'
  // 查资料
  | 'web.search' | 'web.fetch';

/** 分组：二十几个工具平铺一片没法看 */
export type ToolGroup = 'read' | 'write' | 'prompt' | 'generate' | 'camera' | 'deliver' | 'research';

export const GROUP_LABEL: Record<ToolGroup, string> = {
  read: '读', write: '写项目', prompt: '提示词',
  generate: '生成', camera: '镜头', deliver: '成片', research: '查资料',
};

/** 实现到什么程度。与 Rust 侧 tools.rs 的 Status 同义 */
export type ToolStatus = 'ready' | 'declared';

export interface ToolSpec {
  readonly id: ToolId;
  readonly group: ToolGroup;
  readonly name: string;
  readonly desc: string;
  /** 需要哪种模型才能跑。undefined = 纯本地操作，不调模型 */
  readonly needs?: Modality;
  /** 会改项目内容（进撤销历史），界面上标出来 */
  readonly writes?: boolean;
  /** 实现到什么程度 —— 没实现的不要让它看起来一样能用 */
  readonly status: ToolStatus;
  /** 没实现时缺的是什么 */
  readonly blockedBy?: string;
}

/**
 * 全部工具。**与 Rust 侧 `core/src/tools.rs` 的注册表一一对应**，有 parity 测试。
 *
 * `status` 如实标实现到哪一步 —— 一张看起来都能用的清单比一张诚实的短清单更糟。
 * 没实现的在 `blockedBy` 里写清缺什么。
 */
export const TOOLS: readonly ToolSpec[] = [
  /* 读 */
  { id: 'project.read', group: 'read', name: '读项目', desc: '读大纲、剧本、资产、分镜', status: 'ready' },
  { id: 'project.search', group: 'read', name: '找内容', desc: '在项目里按关键词找，比整份读进来省', status: 'ready' },
  { id: 'metrics.read', group: 'read', name: '读记账', desc: '命中率、消耗、按景别归因', status: 'ready' },
  { id: 'cost.estimate', group: 'read', name: '估花费', desc: '真花之前先报个数', status: 'ready' },

  /* 写项目 */
  { id: 'outline.write', group: 'write', name: '写大纲', desc: '起草或补充幕与场次', needs: 'text', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },
  { id: 'script.write', group: 'write', name: '写剧本', desc: '写正文块、润色已有段落', needs: 'text', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },
  { id: 'asset.write', group: 'write', name: '建资产', desc: '新建角色/场景/道具', needs: 'text', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },
  { id: 'asset.lock', group: 'write', name: '资产定稿', desc: '锁定版本，让分镜可以引用', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },
  { id: 'shot.write', group: 'write', name: '写分镜', desc: '拆镜、改镜头字段与引用', needs: 'text', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },

  /* 提示词 */
  { id: 'prompt.compile', group: 'prompt', name: '合成提示词', desc: '画风 + 资产 + 镜头语言 → 英文提示词', needs: 'text', writes: true, status: 'declared', blockedBy: '合成规则要先从前端搬到 core' },
  { id: 'prompt.translate', group: 'prompt', name: '提示词中译英', desc: '只译看得见的东西，不译情节与心理', needs: 'text', status: 'declared', blockedBy: '要能在 agent loop 里被调用' },
  { id: 'style.apply', group: 'prompt', name: '换画风', desc: '换画风并重算受影响的提示词', needs: 'text', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },

  /* 生成 */
  { id: 'image.generate', group: 'generate', name: '出图', desc: '生成形状照与关键帧', needs: 'image', writes: true, status: 'declared', blockedBy: '缺厂商适配器（异步任务接口）' },
  { id: 'image.edit', group: 'generate', name: '改图', desc: '局部重绘或扩图，比重出整张省', needs: 'image', writes: true, status: 'declared', blockedBy: '缺厂商适配器（异步任务接口）' },
  { id: 'image.upscale', group: 'generate', name: '放大', desc: '定稿后放大到成片分辨率', needs: 'image', writes: true, status: 'declared', blockedBy: '缺厂商适配器（异步任务接口）' },
  { id: 'video.generate', group: 'generate', name: '出视频', desc: '关键帧 → 片段', needs: 'video', writes: true, status: 'declared', blockedBy: '缺厂商适配器（异步任务接口）' },
  { id: 'video.extend', group: 'generate', name: '续接片段', desc: '把已有片段往后续几秒', needs: 'video', writes: true, status: 'declared', blockedBy: '缺厂商适配器（异步任务接口）' },
  { id: 'audio.tts', group: 'generate', name: '配音', desc: '台词 → 语音，音色按角色配', writes: true, status: 'declared', blockedBy: '缺厂商适配器（异步任务接口）' },
  { id: 'audio.music', group: 'generate', name: '配乐', desc: '按情绪与时长生成背景音乐', writes: true, status: 'declared', blockedBy: '缺厂商适配器（异步任务接口）' },
  { id: 'audio.sfx', group: 'generate', name: '音效', desc: '雨声、脚步、关门这类单个音效', writes: true, status: 'declared', blockedBy: '缺厂商适配器（异步任务接口）' },

  /* 镜头 */
  { id: 'stage.render', group: 'camera', name: '渲参考图', desc: '布光台白模离屏渲染，本地不花钱', status: 'declared', blockedBy: '要由前端执行再把结果回传' },
  { id: 'shot.rig', group: 'camera', name: '设机位光线', desc: '改这一镜的机位、焦距、光位', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },

  /* 成片 */
  { id: 'edit.timeline', group: 'deliver', name: '排时间线', desc: '可用片段按场次与节拍排进时间线', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },
  { id: 'edit.subtitle', group: 'deliver', name: '生成字幕', desc: '按正文与配音时间轴生成字幕', writes: true, status: 'declared', blockedBy: '要先解决与前端 store 的同步' },
  { id: 'file.export', group: 'deliver', name: '导出文件', desc: '导出剧本 .md、成片 .mp4', status: 'declared', blockedBy: '导出路径要用户选，不能由 Agent 决定' },

  /* 查资料 */
  { id: 'web.search', group: 'research', name: '搜网页', desc: '查产品卖点、考据这类外部资料', status: 'declared', blockedBy: '查询词会发出本机，要先想清边界' },
  { id: 'web.fetch', group: 'research', name: '读网页', desc: '读指定网址的正文', status: 'declared', blockedBy: '内容会发出本机，要先想清边界' },
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
