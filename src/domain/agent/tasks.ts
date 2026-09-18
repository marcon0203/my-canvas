import { RULES, ACT, TOPIC } from './router';
import { INTENT_META } from './roster';
import { TOOLS_FOR_INTENT } from './tools';
import type { ToolId } from './tools';
import type { IntentKind, ProposalPatch } from './types';

export type TaskId = Exclude<IntentKind, 'chat'>;

/** 这件任务现在是**真的调模型**，还是本地拿项目数据算一版草稿 */
export type Impl =
  /** 桌面端走 Rust + Rig，真发请求。括号里是那个模块 */
  | { readonly by: 'model'; readonly module: string; readonly note: string }
  /**
   * 还没接模型：产物在前端本地生成，形状与真产物一致。
   *
   * **依据到什么程度各不相同**，note 里逐条写清：有的真读了项目现状
   * （场次、幕、资产），有的只是套模板（outline.expand 就只套了标题）。
   * 一律说成「按项目现状算出来」是在替它吹。
   */
  | { readonly by: 'local'; readonly note: string };

export interface TaskSpec {
  readonly id: TaskId;
  readonly name: string;
  readonly icon: string;
  /** 一句话：这件任务到底做什么 */
  readonly summary: string;
  /** 前置条件。不满足时 Agent 明说不行，而不是假装做了 */
  readonly needs: string;
  /**
   * 产出什么补丁 —— 与 plans.ts 实际产出的 patch.t 一致，有测试盯着。
   * `null` = 这件任务只说话不改东西（报告类），没有可采纳的产物。
   */
  readonly patch: ProposalPatch['t'] | null;
  /** 采纳后跳到哪一页。没有产物时为 null */
  readonly goto: string | null;
  readonly impl: Impl;
}

/**
 * 任务注册表：这个产品一共会做哪几件事。
 *
 * **和 Skill 不是一回事**，这两个词以前撞在一起，是「功能清单那页看不懂」的
 * 根因之一：
 * - **任务**（这里）= 用户能提的一件需求，比如「延展这一场的走向」。
 *   它有负责人（哪位智能体）、有前置条件、有产物落到哪一页。
 * - **Skill**（`skill/` crate 与 `domain/skills/`）= 磁盘上一份写给模型的
 *   操作说明文件。一个任务的做法**可以**写在 Skill 文件里（`impl.by === 'model'`
 *   的那几个），也可以内置在程序里。
 *
 * 一句话：任务是「做什么」，Skill 是「怎么做的那份说明」。
 *
 * **这里不复制任何已有的事实**：触发词从 router 的 RULES 取，工具从
 * TOOLS_FOR_INTENT 取，产出的 patch 有测试对着 plans.ts 的真实产物核对。
 * 只有 summary / needs / impl 是这里新写的 —— 前两个是给人看的说明，
 * impl 说的是「这条链路接没接模型」，这件事以前只有读代码才知道。
 */
export const TASKS: readonly TaskSpec[] = [
  {
    id: 'outline.draft', ...INTENT_META['outline.draft'],
    summary: '从一句灵感搭出三幕结构；已有大纲时只补最薄的那一幕，不推翻重来。',
    needs: '无。空项目也可执行，它是流程的第一步。',
    patch: 'acts', goto: 'outline',
    impl: { by: 'model', module: 'agent/src/outline.rs',
      note: '走 Rig 的 Extractor 让模型填 schema；场次编号由 Rust 补，不信模型编的 id。' },
  },
  {
    id: 'outline.expand', ...INTENT_META['outline.expand'],
    summary: '围绕选中的一场给三条不同走向，改的是谁在场、谁知情，不是换形容词。',
    needs: '大纲里至少有一场。',
    patch: 'alts', goto: 'outline',
    impl: { by: 'model', module: 'agent/src/expand.rs',
      note: '这一场的功能、所在幕、前后各两场、已定稿的角色都会送过去 —— 只给标题的话模型给的三条和模板差别不大。条数与长度由 Rust 收拾（去重、截断、最多 4 条）。浏览器里没有这条链路，会回落成三个固定句式套标题。' },
  },
  {
    id: 'script.draft', ...INTENT_META['script.draft'],
    summary: '为选中场次写正文块：地点时间 + 动作 + 最必要的那几句台词。',
    needs: '大纲里至少有一场。',
    patch: 'blocks', goto: 'script',
    impl: { by: 'model', module: 'agent/src/script.rs',
      note: '**前一场的结尾会送进提示词**，这一场要接得上它 —— 这是它相对模板的意义。模型只填地点/时间/正文行，场次键与幕标题由 Rust 拼（body_of），块 id 由前端分配。' },
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
    summary: '从剧本正文里找出反复出现的人、地方、关键道具，立成草稿资产。',
    needs: '剧本里至少有一个非空的正文块。',
    patch: 'assets', goto: 'assets',
    impl: { by: 'model', module: 'agent/src/assets.rs',
      note: '正文真送进去，所以能认出「他/老李/李明」是同一个人，也能写出出图用得上的外形描述。分组只认角色/场景/道具，不合法的整条丢掉；aid 由前端接着库里已有的号编。' },
  },
  {
    id: 'assets.views', ...INTENT_META['assets.views'],
    summary: '为尚未出图的形状照补充生成。',
    needs: '存在尚未生成过图的形状照条目。',
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
    summary: '把尚无镜头的场次各拆成镜头，几镜由这场本身决定。提示词保持留空。',
    needs: '存在尚无任何镜头的场次。',
    patch: 'shots', goto: 'storyboard',
    impl: { by: 'model', module: 'agent/src/shots.rs',
      note: '**不再一律三镜** —— 送正文进去，拆几镜看画面变了几次。场次键与景别由 Rust 核对，模型编的整条丢掉并把丢了几条报到产物卡上；镜号与资产引用由前端分配。' },
  },
  {
    id: 'shots.prompt', ...INTENT_META['shots.prompt'],
    summary: '给缺提示词的镜头各写一条英文提示词：景别术语 + 引用资产描述 + 画风。',
    needs: '存在提示词为空的镜头。',
    patch: 'shotPrompts', goto: 'storyboard',
    impl: { by: 'model', module: 'agent/src/shotprompt.rs',
      note: '资产引用在前端展开成描述再送过去；镜号由 Rust 核对，模型编的会被丢掉。' },
  },
  {
    id: 'video.batch', ...INTENT_META['video.batch'],
    summary: '把尚未生成视频的镜头排入队列批量转换。',
    needs: '存在尚未生成过视频的镜头。',
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
    needs: '无。没有记录时会明确提示暂无数据。',
    // 报告类：只说话，不产出可采纳的补丁
    patch: null, goto: null,
    impl: { by: 'local', note: '纯本地统计，读的是记账数据，不调模型。' },
  },
];

const BY_ID = new Map(TASKS.map((s) => [s.id, s]));
export const taskOf = (id: TaskId): TaskSpec | undefined => BY_ID.get(id);

/** URL 段是不是一个真的任务 id —— 路由直达时用它挡住乱填的名字 */
export const isTaskId = (id: string | undefined): id is TaskId =>
  !!id && BY_ID.has(id as TaskId);

/** 这件任务要哪些工具。**取自 tools.ts，不在这儿重写一遍** */
export const toolsOf = (id: TaskId): readonly ToolId[] => TOOLS_FOR_INTENT[id];

export interface Triggers {
  /** 祈使动词，权重 10 —— 动词决定意图 */
  readonly act: readonly string[];
  /** 主题名词，权重 3 —— 只加权 */
  readonly topic: readonly string[];
}

/** 这件任务的触发词。**取自 router.ts 的 RULES，不在这儿重写一遍** */
export function triggersOf(id: TaskId): Triggers {
  const r = RULES.find((x) => x.kind === id);
  return { act: r?.act ?? [], topic: r?.topic ?? [] };
}

export const TRIGGER_WEIGHT = { act: ACT, topic: TOPIC };

/** 产出落到哪一页，给人话 */
export const GOTO_LABEL: Record<string, string> = {
  outline: '剧情大纲', script: '剧本', assets: '资产',
  storyboard: '分镜', editing: '剪辑', metrics: '数据',
};
