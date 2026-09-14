import type { IntentKind } from './types';

/**
 * Agent 班底：一个环节一位，各有专长。
 *
 * 「专长」不是文案 —— 它是 `owns`：这位 Agent 能接哪些活儿。
 * 接不了的会**转交**给对的那位（见 api/agent.ts 的 handoff），
 * 所以「找错人」在这个产品里不是死路，是一次交接。
 */

export type AgentId = 'writer' | 'art' | 'dp' | 'editor' | 'producer';

export interface Persona {
  readonly id: AgentId;
  readonly name: string;
  readonly en: string;
  readonly icon: string;
  /** 一句专长，显示在侧栏抬头 */
  readonly tagline: string;
  /** 主场环节。第一个是转交时要跳过去的那个 */
  readonly steps: readonly string[];
  /** 能接的活儿 —— 这就是「擅长」的定义 */
  readonly owns: readonly IntentKind[];
  /** 空会话时的自我介绍 */
  readonly greeting: string;
  /** 把活儿转交出去时说的话（%s 是接手方） */
  readonly handoff: string;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'writer', name: '编剧', en: 'Writer', icon: 'book',
    tagline: '管结构与文字：三幕、场次、正文、润色',
    steps: ['outline', 'script'],
    owns: ['outline.draft', 'outline.expand', 'script.draft', 'script.polish'],
    greeting: '我负责把想法变成结构。先定幕和场，再写字 —— 结构定了再写，改起来便宜。',
    handoff: '这不是我的活儿，%s 更懂。我把你转过去。',
  },
  {
    id: 'art', name: '美术', en: 'Art Director', icon: 'users',
    tagline: '管资产与画风：角色、场景、道具、形状照、风格统一',
    steps: ['assets'],
    owns: ['assets.extract', 'assets.views', 'style.transfer'],
    greeting: '我管一致性。角色长什么样、场景什么调子，定稿之后才能进分镜 —— 这条我不绕。',
    handoff: '资产这边我说了算，但这件事得找 %s。转过去了。',
  },
  {
    id: 'dp', name: '摄影指导', en: 'DP', icon: 'video',
    tagline: '管镜头与光：景别、机位、布光台、提示词、出片',
    steps: ['storyboard'],
    owns: ['shots.generate', 'shots.prompt', 'video.batch'],
    greeting: '我管每一镜怎么拍。机位和灯在布光台上是能拖的 —— 参数定死了再跑，比多摇几次便宜得多。',
    handoff: '镜头的事找我，这件不是。%s 接手更合适。',
  },
  {
    id: 'editor', name: '剪辑', en: 'Editor', icon: 'scissors',
    tagline: '管成片：素材筛选、节奏、时间线、导出',
    steps: ['editing'],
    owns: ['edit.autocut'],
    greeting: '我只用判定为「可用」的素材。重摇的不进时间线 —— 这也是命中率那个数字的意义。',
    handoff: '这段不归剪辑管，%s 才是对的人。转过去了。',
  },
  {
    id: 'producer', name: '制片', en: 'Producer', icon: 'bolt',
    tagline: '管账：消耗、命中率、按模型与景别归因',
    steps: ['metrics', 'overview'],
    owns: ['cost.report'],
    greeting: '我盯的是一个数：命中率。它决定第二部片能不能比第一部便宜。',
    handoff: '算账我在行，这件事 %s 更快。转过去了。',
  },
];

const BY_ID = new Map(PERSONAS.map((p) => [p.id, p]));
const BY_STEP = new Map(PERSONAS.flatMap((p) => p.steps.map((s) => [s, p] as const)));
const BY_INTENT = new Map(PERSONAS.flatMap((p) => p.owns.map((k) => [k, p] as const)));

export const personaById = (id: AgentId): Persona => BY_ID.get(id)!;

/** 环节 → 当班的 Agent。没配到的环节交给制片（总览类） */
export const personaForStep = (step: string): Persona => BY_STEP.get(step) ?? personaById('producer');

/** 意图 → 该谁接。chat 谁都能接，返回 undefined 表示「当班的就行」 */
export const ownerOf = (kind: IntentKind): Persona | undefined => BY_INTENT.get(kind);

/** 这位 Agent 接不接得了这件事 */
export const canHandle = (p: Persona, kind: IntentKind): boolean =>
  kind === 'chat' || p.owns.includes(kind);

/* ---------------- 技能卡 ---------------- */

export interface Skill {
  readonly icon: string;
  readonly name: string;
  readonly kind: IntentKind;
}

/** 意图的展示元数据。技能卡与转交提示共用同一份，避免两处措辞打架 */
export const INTENT_META: Record<Exclude<IntentKind, 'chat'>, { icon: string; name: string }> = {
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

/** 一位 Agent 的技能卡 = 它能接的活儿。两处不会再走偏 */
export const skillsOf = (p: Persona): Skill[] =>
  p.owns.filter((k): k is Exclude<IntentKind, 'chat'> => k !== 'chat')
    .map((kind) => ({ kind, ...INTENT_META[kind] }));

export const intentName = (kind: IntentKind): string =>
  kind === 'chat' ? '闲聊' : INTENT_META[kind].name;
