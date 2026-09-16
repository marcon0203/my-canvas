import { INTENT_META } from './roster';
import type { IntentKind } from './types';

/**
 * 从一句需求到成片的执行计划。
 *
 * 首页收到的是「我要做什么」，不是「跑哪个 skill」。这里把它翻成一串有序的活儿，
 * 由 Agent 一步步跑，每步出产物等人点头（或按自主度自动采纳）。
 */

export type ProjectKind = '短剧' | '广告' | 'MV' | '动画';

export const KINDS: readonly ProjectKind[] = ['短剧', '广告', 'MV', '动画'];

export interface Stage {
  readonly kind: Exclude<IntentKind, 'chat'>;
  /** 为什么这一步在这儿 —— 界面上摆出来，人才知道能不能跳过 */
  readonly why: string;
}

/**
 * 主干是固定的：**结构 → 文字 → 资产 → 分镜 → 提示词 → 视频 → 成片**。
 * 类型改的是其中某几步要不要，不是整条链路重来 ——
 * 不同类型之间真正的差别只有那么几处，编出一堆差异反而是假的。
 */
const BACKBONE: readonly Stage[] = [
  { kind: 'outline.draft', why: '先定结构。结构定了再写字，改起来便宜' },
  { kind: 'script.draft', why: '按场写正文，后面拆镜要从字里拿画面' },
  { kind: 'assets.extract', why: '把反复出现的人和地方立成资产，跨镜头才一致' },
  { kind: 'shots.generate', why: '每场拆成镜头，提示词先留空' },
  { kind: 'shots.prompt', why: '按各自景别与引用合成提示词' },
  { kind: 'video.batch', why: '批量转视频' },
  { kind: 'edit.autocut', why: '按节拍排进时间线' },
];

/** 某个类型跳过哪几步，以及为什么 —— 写在一处，界面照着说 */
const SKIP: Partial<Record<ProjectKind, Partial<Record<string, string>>>> = {
  MV: { 'script.draft': 'MV 没有对白，画面直接从歌词和结构来' },
};

export function pipelineFor(kind: ProjectKind): Stage[] {
  const skip = SKIP[kind] ?? {};
  return BACKBONE.filter((s) => !skip[s.kind]);
}

/** 这个类型跳过了什么，界面上如实说一句 */
export function skippedFor(kind: ProjectKind): { kind: string; name: string; why: string }[] {
  return Object.entries(SKIP[kind] ?? {}).map(([k, why]) => ({
    kind: k,
    name: INTENT_META[k as Exclude<IntentKind, 'chat'>]?.name ?? k,
    why: why!,
  }));
}

/** 关键词 → 类型。命中越靠前越优先 */
const HINTS: readonly { kind: ProjectKind; words: readonly string[] }[] = [
  { kind: '广告', words: ['广告', '宣传片', '带货', '卖点', '品牌', '产品', 'tvc', '种草'] },
  { kind: 'MV', words: ['mv', '音乐', '歌', '歌词', '演唱', '节奏卡点'] },
  { kind: '动画', words: ['动画', '二次元', '番剧', '动漫', '卡通'] },
  { kind: '短剧', words: ['短剧', '剧情', '故事', '反转', '男主', '女主', '情节'] },
];

/**
 * 猜类型。**这是关键词匹配，不是理解** —— 所以界面上要让人一眼能改，
 * 而不是猜完就闷头往下跑。
 */
export function detectKind(brief: string): { kind: ProjectKind; matched: string[] } {
  const t = brief.toLowerCase();
  for (const h of HINTS) {
    const hit = h.words.filter((w) => t.includes(w));
    if (hit.length) return { kind: h.kind, matched: hit };
  }
  return { kind: '短剧', matched: [] };
}

/**
 * 从需求里取一个项目名。
 *
 * 逗号也算断句：「做一支洗发水宣传片，突出洗完第二天还蓬松」该叫
 * 「做一支洗发水宣传片」，不是把整段截断加省略号 —— 它还要当目录名，
 * 所以宁可短，也不要一串带省略号的半句话。
 */
export function nameFromBrief(brief: string): string {
  const first = brief.trim().split(/[\n。！？!?，,；;]/).map((x) => x.trim()).find(Boolean) ?? '';
  const cut = first.length > 14 ? first.slice(0, 14) : first;
  return cut || '未命名项目';
}
