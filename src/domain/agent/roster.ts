import type { IconName } from '@/ui/Icon';
import type { IntentKind } from './types';

/**
 * Agent 班底：一个环节一位，各有专长。
 *
 * 「专长」不是文案 —— 它是 `owns`：这位 Agent 能接哪些活儿。
 * 接不了的会**转交**给对的那位（见 api/agent.ts 的 handoff），
 * 所以「找错人」在这个产品里不是死路，是一次交接。
 */

/** 出厂那五位的 id。这个联合类型还留着，是因为有几张表按位置登记（EXTRA_TOOLS、头像配色） */
export type BuiltinAgentId = 'writer' | 'art' | 'dp' | 'editor' | 'producer';

/**
 * 一位 Agent 的 id。**不是联合类型** —— 用户可以自己建，id 在运行时才产生。
 *
 * 出厂五位的 id 仍然是那五个字符串，内置逻辑（环节归属、头像配色）按它们认人。
 */
export type AgentId = string;

export interface Persona {
  readonly id: AgentId;
  /** 用户自己建的。内置的没有这个标记 —— 内置的不能删 */
  readonly custom?: boolean;
  readonly name: string;
  readonly en: string;
  readonly icon: IconName;
  /** 一句专长，显示在侧栏抬头 */
  readonly tagline: string;
  /** 主场环节。第一个是转交时要跳过去的那个 */
  readonly steps: readonly string[];
  /** 能接的活儿 —— 这就是「擅长」的定义 */
  readonly owns: readonly IntentKind[];
  /** 空会话时的自我介绍 */
  readonly greeting: string;
  /**
   * 系统提示词（Rig 的 preamble）—— **自主执行下，这才是每位的判断倾向**。
   * 技能决定它接什么活，工具决定它能动什么，这段决定它**怎么想**：
   * 先看什么、什么算做完、拿不准时偏向哪边。
   * 设置里可以整段改写，改的就是这个 Agent 的判断倾向。
   */
  readonly preamble: string;
  /** 把活儿转交出去时说的话（%s 是接手方） */
  readonly handoff: string;
}

export const BUILTIN_PERSONAS: readonly Persona[] = [
  {
    id: 'writer', name: '编剧', en: 'Writer', icon: 'book',
    tagline: '三幕、场次、正文、润色',
    steps: ['outline', 'script'],
    owns: ['outline.draft', 'outline.expand', 'script.draft', 'script.polish'],
    greeting: '先把幕和场定下来，再写字。结构定了之后改一场，不会牵动别的场。',
    handoff: '这个我接不了，%s 更懂。转过去了。',
    preamble: `管结构与文字。

每一场先说清它承担什么功能。功能说不清，就别往下写台词。
动作先行，台词只留最必要的那句。
一场写完要能回答：看完这场，观众多知道了什么。答不上来就是这场还不成立。

宁可少写、留一行待补，也不要拿漂亮的空句子把篇幅填满。

场次键（场景1、场景2…）由程序统一编号，别自己编。
画面怎么拍不归你：景别、机位、光线是摄影指导的事，不要在剧本里替他定下来。`,
  },
  {
    id: 'art', name: '美术', en: 'Art Director', icon: 'users',
    tagline: '角色、场景、道具的一致性',
    steps: ['assets'],
    owns: ['assets.extract', 'assets.views', 'style.transfer'],
    greeting: '角色长什么样、场景什么调子，在这儿定死。没定稿的资产分镜引不上。',
    handoff: '资产的事找我，这件不是。%s 接手更合适。',
    preamble: `管资产与画风的一致性。

有一条规矩不绕：**没定稿的资产，分镜引用不上。** 宁可让人多点一次定稿，
也不要让一个草稿资产进到出图那一步。那样每次跑出来的角色长相都不一样，
钱花了还得重摇。

建不建资产，看这个东西以后出现几次。只出现一次的不建；反复出现的必须建，
而且要锁版本。

改画风之前先说影响面：哪几张形状照是节点级画风（单独指定过的，不跟全局走）。

你可以建草稿，但不替人定稿。定稿是一个承诺。`,
  },
  {
    id: 'dp', name: '摄影指导', en: 'DP', icon: 'video',
    tagline: '每一镜怎么拍',
    steps: ['storyboard'],
    owns: ['shots.generate', 'shots.prompt', 'video.batch'],
    greeting: '机位和灯在布光台上是能拖的。先把参数定死再跑，比多摇几次便宜。',
    handoff: '镜头的事找我，这件不是。%s 接手更合适。',
    preamble: `管镜头与光。

先定机位和光，再写提示词。理由很直接：布光台是本地渲染，不花钱；跑一次真生成要花钱。
能在布光台里拖出来的东西，不要靠改提示词碰运气。

不确定构图就先渲一张白模参考图看看，再决定要不要跑。

一镜的提示词由三段合成：画风、它引用的资产描述、这一镜自己的内容。
被问到某一句为什么在里面，你要能指出它来自哪一段。

镜号（s1-1、s1-2…）由程序分配。`,
  },
  {
    id: 'editor', name: '剪辑', en: 'Editor', icon: 'scissors',
    tagline: '素材筛选、时间线、导出',
    steps: ['editing'],
    owns: ['edit.autocut'],
    greeting: '只用判定为「可用」的片段。重摇没通过的不进时间线，也不算进片长。',
    handoff: '这段不归剪辑管，%s 才是对的人。转过去了。',
    preamble: `管成片。

只用判定为「可用」的片段。重摇没通过的既不进时间线，也不算进片长。

顺序先服从场次，再谈节奏。要打乱叙事顺序，得单独说明为什么。

素材不够就直说不够。把不够的素材凑成一条片子，比没有片子更糟。`,
  },
  {
    id: 'producer', name: '制片', en: 'Producer', icon: 'bolt',
    tagline: '消耗、命中率、归因',
    steps: ['metrics', 'overview'],
    owns: ['cost.report'],
    greeting: '我只盯一个数：命中率。它决定第二部片能不能比第一部便宜。',
    handoff: '算账我在行，这件事 %s 更快。转过去了。',
    preamble: `管账。

命中率 = 可用镜头 ÷ 累计生成次数。这是你唯一要盯的数。

任何建议都要落到它上面：说某个做法好，就说清它让命中率高在哪一环。
说不清就别给建议。

判定数据不够（大部分镜头还没标可用/重摇）就说算不出来，先让人去补判定。
拿五六个样本做按模型、按景别的归因，结论会反过来。`,
  },
];

/* ---------------- 班底 = 内置 + 用户建的 ---------------- */

/**
 * 用户自己建的那几位。
 *
 * **这份数据的家在 settings store 里**（要持久化），这儿只是一份副本，
 * 由 store 在变化时推进来。方向是单向的：store → roster。
 * 反过来让 roster 去 import store 会成环（store 本来就 import roster），
 * 而且会把一个纯数据模块变成要有运行时状态才能用的东西。
 *
 * 没推进来时是空的 —— 那时候班底就是内置五位，所有逻辑照旧成立。
 */
let CUSTOM: readonly Persona[] = [];

let BY_ID = new Map<AgentId, Persona>();
let BY_STEP = new Map<string, Persona>();
let BY_INTENT = new Map<IntentKind, Persona>();

function reindex() {
  const all = [...BUILTIN_PERSONAS, ...CUSTOM];
  BY_ID = new Map(all.map((p) => [p.id, p]));
  // 环节与出厂分工只认内置那五位：自定义的不占环节，也不改出厂默认的归属。
  // 谁实际接哪件活由配置说话（config.ts 的 ownerOfConfigured），不是这儿。
  BY_STEP = new Map(BUILTIN_PERSONAS.flatMap((p) => p.steps.map((s) => [s, p] as const)));
  BY_INTENT = new Map(BUILTIN_PERSONAS.flatMap((p) => p.owns.map((k) => [k, p] as const)));
}
reindex();

/** store 在自定义 Agent 变化时调它。传空数组就回到「只有内置五位」 */
export function setCustomPersonas(list: readonly Persona[]): void {
  CUSTOM = list;
  reindex();
}

/** 当前全班底：内置五位 + 用户建的，按这个顺序 */
export const roster = (): readonly Persona[] => [...BUILTIN_PERSONAS, ...CUSTOM];

export const customPersonas = (): readonly Persona[] => CUSTOM;

/**
 * 按 id 找人。
 *
 * **找不到时给一个占位的，不抛也不返回 undefined。** 会找不到是因为配置里
 * 可能留着一位已经删掉的自定义 Agent（某件活儿还记着它的 id）。那种情况下
 * 界面该显示「这位已经不在了」，而不是整页崩掉 —— 崩掉的话人连「哪儿还记着
 * 它」都看不到。占位的名字就写 id，看见 id 的人知道去哪儿找。
 */
export function personaById(id: AgentId): Persona {
  return BY_ID.get(id) ?? ghost(id);
}

/** 这个 id 现在是不是真有这么一位 */
export const hasPersona = (id: AgentId): boolean => BY_ID.has(id);

const ghost = (id: AgentId): Persona => ({
  id, name: id, en: '', icon: 'users', custom: true,
  tagline: '该智能体已被删除',
  steps: [], owns: [],
  greeting: '',
  preamble: '',
  handoff: '该智能体已被删除，转交给 %s。',
});

/** URL 段是不是一个真的 Agent —— 路由直达时用它挡住乱填的名字 */
export const isAgentId = (id: string | undefined): id is AgentId => !!id && BY_ID.has(id);

/** 环节 → 当班的 Agent。没配到的环节交给制片（总览类） */
export const personaForStep = (step: string): Persona => BY_STEP.get(step) ?? personaById('producer');

/** 意图 → 该谁接。chat 谁都能接，返回 undefined 表示「当班的就行」 */
export const ownerOf = (kind: IntentKind): Persona | undefined => BY_INTENT.get(kind);

/** 这位 Agent 接不接得了这件事 */
export const canHandle = (p: Persona, kind: IntentKind): boolean =>
  kind === 'chat' || p.owns.includes(kind);

/* ---------------- 新建一位 ---------------- */

/** 可以给自定义 Agent 挑的图标。都是界面上已有的那套，不另引一套 */
export const AGENT_ICONS: readonly IconName[] = [
  'users', 'book', 'video', 'scissors', 'bolt', 'wand', 'map', 'layers', 'image', 'spark',
];

/** 出厂五位的头像有各自的配色，自定义的统一用一个 —— 见 prototype.css 的 .aface--custom */
export const faceClass = (id: AgentId): string =>
  BUILTIN_PERSONAS.some((p) => p.id === id) ? `aface--${id}` : 'aface--custom';

/**
 * 造一个 id。名字里的中文没法当 id，所以不从名字生成 —— 那会出现
 * `agent--1` 这种一半是随机数的东西。直接编号，可读、不会撞。
 */
export function nextAgentId(existing: readonly AgentId[]): AgentId {
  const used = new Set(existing);
  for (let i = 1; ; i += 1) {
    const id = `custom-${i}`;
    if (!used.has(id)) return id;
  }
}

export interface NewAgent {
  readonly name: string;
  readonly tagline: string;
  /**
   * 表单里填的、或是从旧版配置里读出来的 —— 所以这层收 `string`，
   * 在 `makeCustomPersona` 里归一到 `AGENT_ICONS`。
   * 界面往下传的 `Persona.icon` 才是 `IconName`。
   */
  readonly icon: string;
  readonly preamble: string;
  readonly owns: readonly IntentKind[];
}

/**
 * 把新建表单变成一位 Persona。
 *
 * 空着的字段**不替用户编内容**：没写描述就是没有描述，界面上如实空着；
 * 没写提示词就没有提示词，这位 Agent 只按工具和活儿行事。编一段
 * 「你是一个有用的助手」进去，等于让每一位新建的 Agent 都带上同一段废话。
 */
export function makeCustomPersona(id: AgentId, a: NewAgent): Persona {
  return {
    id,
    custom: true,
    name: a.name.trim() || id,
    en: '',
    icon: (AGENT_ICONS as readonly string[]).includes(a.icon) ? (a.icon as IconName) : 'users',
    tagline: a.tagline.trim(),
    steps: [],
    owns: [...a.owns],
    greeting: a.tagline.trim(),
    preamble: a.preamble.trim(),
    handoff: '这件事不在我这儿，%s 接手更合适。',
  };
}

/** 从某位身上复制一份：提示词、活儿、图标照搬，名字换成「XX 副本」 */
export function copyOfPersona(src: Persona, id: AgentId, name?: string): Persona {
  return {
    ...src,
    id,
    custom: true,
    name: (name ?? `${src.name}副本`).trim() || id,
    en: '',
    // 环节不跟着复制：一个环节只有一位当班，复制一份不该把原来那位顶掉
    steps: [],
  };
}

/* ---------------- 技能卡 ---------------- */

export interface Skill {
  readonly icon: IconName;
  readonly name: string;
  readonly kind: IntentKind;
}

/** 意图的展示元数据。技能卡与转交提示共用同一份，避免两处措辞打架 */
export const INTENT_META: Record<Exclude<IntentKind, 'chat'>, { icon: IconName; name: string }> = {
  'outline.draft': { icon: 'spark', name: '从一句灵感起草大纲' },
  'outline.expand': { icon: 'map', name: '延展这一场的剧情走向' },
  'script.draft': { icon: 'text', name: '为选中场次写正文' },
  'script.polish': { icon: 'wand', name: '润色当前文档块' },
  'assets.extract': { icon: 'users', name: '从剧本提取角色与场景' },
  'assets.views': { icon: 'image', name: '补齐缺失的形状照' },
  'style.transfer': { icon: 'wand', name: '统一画风' },
  'shots.generate': { icon: 'layers', name: '按大纲生成分镜' },
  'shots.prompt': { icon: 'text', name: '为缺提示词的镜头补写' },
  'video.batch': { icon: 'video', name: '批量转视频' },
  'edit.autocut': { icon: 'scissors', name: '按节拍自动成片' },
  'cost.report': { icon: 'bolt', name: '成本与命中率报告' },
};

/** 一组活儿的技能卡。措辞与转交提示共用 INTENT_META，两处不会走偏 */
export const skillsOfKinds = (kinds: readonly IntentKind[]): Skill[] =>
  kinds.filter((k): k is Exclude<IntentKind, 'chat'> => k !== 'chat')
    .map((kind) => ({ kind, ...INTENT_META[kind] }));

/** 一位 Agent 的**出厂**技能卡。界面上该按配置来（配置才是运行时那份） */
export const skillsOf = (p: Persona): Skill[] => skillsOfKinds(p.owns);

export const intentName = (kind: IntentKind): string =>
  kind === 'chat' ? '闲聊' : INTENT_META[kind].name;
