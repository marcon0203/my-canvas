import { RULES, ACT, TOPIC } from './router';
import { INTENT_META } from './roster';
import { TOOLS_FOR_INTENT } from './tools';
import type { ToolId } from './tools';
import type { IntentKind, ProposalPatch } from './types';

export type SkillId = Exclude<IntentKind, 'chat'>;

/** 这件活现在是**真的调模型**，还是本地拿项目数据算一版草稿 */
export type Impl =
  /** 桌面端走 Rust + Rig，真发请求。括号里是那个模块 */
  | { readonly by: 'model'; readonly module: string; readonly note: string }
  /** 还没接模型：产物由前端按项目现状算出来，形状与真产物一致 */
  | { readonly by: 'local'; readonly note: string };

export interface SkillSpec {
  readonly id: SkillId;
  readonly name: string;
  readonly icon: string;
  /** 一句话：这件活到底干什么 */
  readonly summary: string;
  /** 前置条件。不满足时 Agent 明说不行，而不是假装做了 */
  readonly needs: string;
  /**
   * 产出什么补丁 —— 与 plans.ts 实际产出的 patch.t 一致，有测试盯着。
   * `null` = 这件活只说话不改东西（报告类），没有可采纳的产物。
   */
  readonly patch: ProposalPatch['t'] | null;
  /** 采纳后跳到哪一页。没有产物时为 null */
  readonly goto: string | null;
  readonly impl: Impl;
}

/**
 * Skill 注册表。
 *
 * **这里不复制任何已有的事实**：触发词从 router 的 RULES 取，工具从
 * TOOLS_FOR_INTENT 取，产出的 patch 有测试对着 plans.ts 的真实产物核对。
 * 只有 summary / needs / impl 是这里新写的 —— 前两个是给人看的说明，
 * impl 说的是「这条链路接没接模型」，这件事以前只有读代码才知道。
 */
export const SKILLS: readonly SkillSpec[] = [
  {
    id: 'outline.draft', ...INTENT_META['outline.draft'],
    summary: '从一句灵感搭出三幕结构；已有大纲时只补最薄的那一幕，不推翻重来。',
    needs: '无。空项目也能跑 —— 它就是第一步。',
    patch: 'acts', goto: 'outline',
    impl: { by: 'model', module: 'agent/src/outline.rs',
      note: '走 Rig 的 Extractor 让模型填 schema；场次编号由 Rust 补，不信模型编的 id。' },
  },
  {
    id: 'outline.expand', ...INTENT_META['outline.expand'],
    summary: '围绕选中的一场给三条不同走向，改的是谁在场、谁知情，不是换形容词。',
    needs: '大纲里至少有一场。',
    patch: 'alts', goto: 'outline',
    impl: { by: 'local', note: '产物由 drafts.ts 按这一场的功能算出来，还没接模型。' },
  },
  {
    id: 'script.draft', ...INTENT_META['script.draft'],
    summary: '为选中场次写正文块：场景描写 + 对白 + 动作。',
    needs: '大纲里至少有一场。',
    patch: 'blocks', goto: 'script',
    impl: { by: 'local', note: '产物由 drafts.ts 按这一场的功能算出来，还没接模型。' },
  },
  {
    id: 'script.polish', ...INTENT_META['script.polish'],
    summary: '把当前文档块改短、改上口，一句一行。',
    needs: '有一个正文块，且它还没被拆成一句一行。',
    patch: 'blockBody', goto: 'script',
    impl: { by: 'local', note: '本地按标点断句，还没接模型。' },
  },
  {
    id: 'assets.extract', ...INTENT_META['assets.extract'],
    summary: '从剧本正文里扒出还没进资产库的角色与场景，建成条目。',
    needs: '剧本里出现了资产库里没有的名字。',
    patch: 'assets', goto: 'assets',
    impl: { by: 'local', note: '本地按正文里的人名/地名匹配，还没接模型。' },
  },
  {
    id: 'assets.views', ...INTENT_META['assets.views'],
    summary: '给还没出图的形状照补生成。',
    needs: '有形状照条目还没生成过图。',
    patch: 'assetViews', goto: 'assets',
    impl: { by: 'local', note: '排期本地算，出图要接上图片模型才真的会跑。' },
  },
  {
    id: 'style.transfer', ...INTENT_META['style.transfer'],
    summary: '把项目画风换成另一种，并重新合成所有受影响的提示词。',
    needs: '目标画风与当前不同。',
    patch: 'style', goto: 'storyboard',
    impl: { by: 'local', note: '画风词表在 prompt/vocabulary.ts，合成是本地的，不花钱。' },
  },
  {
    id: 'shots.generate', ...INTENT_META['shots.generate'],
    summary: '给还没有镜头的场次各拆三镜：交代环境、看清动作、靠近情绪。提示词故意留空。',
    needs: '有场次还没有任何镜头。',
    patch: 'shots', goto: 'storyboard',
    impl: { by: 'local', note: '三镜结构本地生成，还没接模型。' },
  },
  {
    id: 'shots.prompt', ...INTENT_META['shots.prompt'],
    summary: '给缺提示词的镜头各写一条英文提示词：景别术语 + 引用资产描述 + 画风。',
    needs: '有镜头的提示词是空的。',
    patch: 'shotPrompts', goto: 'storyboard',
    impl: { by: 'model', module: 'agent/src/shotprompt.rs',
      note: '资产引用在前端展开成描述再送过去；镜号由 Rust 核对，模型编的会被丢掉。' },
  },
  {
    id: 'video.batch', ...INTENT_META['video.batch'],
    summary: '把还没出视频的镜头排进队列批量转。',
    needs: '有镜头还没生成过视频。',
    patch: 'run', goto: 'storyboard',
    impl: { by: 'local', note: '排期本地算，真跑要接上视频模型。' },
  },
  {
    id: 'edit.autocut', ...INTENT_META['edit.autocut'],
    summary: '把判定可用的片段按节拍排进时间线。',
    needs: '有判定为可用的视频片段。',
    patch: 'run', goto: 'editing',
    impl: { by: 'local', note: '排序本地算，还没接模型。' },
  },
  {
    id: 'cost.report', ...INTENT_META['cost.report'],
    summary: '按模型与景别归因，算命中率与消耗。',
    needs: '无。没有记录时会如实说没数据。',
    // 报告类：只说话，不产出可采纳的补丁
    patch: null, goto: null,
    impl: { by: 'local', note: '纯本地统计，不调模型 —— 它读的是记账数据。' },
  },
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
export const skillOf = (id: SkillId): SkillSpec | undefined => BY_ID.get(id);

/** URL 段是不是一个真的 Skill —— 路由直达时用它挡住乱填的名字 */
export const isSkillId = (id: string | undefined): id is SkillId =>
  !!id && BY_ID.has(id as SkillId);

/** 这件活要哪些工具。**取自 tools.ts，不在这儿重写一遍** */
export const toolsOf = (id: SkillId): readonly ToolId[] => TOOLS_FOR_INTENT[id];

export interface Triggers {
  /** 祈使动词，权重 10 —— 动词决定意图 */
  readonly act: readonly string[];
  /** 主题名词，权重 3 —— 只加权 */
  readonly topic: readonly string[];
}

/** 这件活的触发词。**取自 router.ts 的 RULES，不在这儿重写一遍** */
export function triggersOf(id: SkillId): Triggers {
  const r = RULES.find((x) => x.kind === id);
  return { act: r?.act ?? [], topic: r?.topic ?? [] };
}

export const TRIGGER_WEIGHT = { act: ACT, topic: TOPIC };

/** 产出落到哪一页，给人话 */
export const GOTO_LABEL: Record<string, string> = {
  outline: '剧情大纲', script: '剧本', assets: '资产',
  storyboard: '分镜', editing: '剪辑', metrics: '数据',
};
