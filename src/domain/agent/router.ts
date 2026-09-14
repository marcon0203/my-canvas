import type { IntentKind } from './types';

/**
 * 自由输入 → 意图。真接 LLM 时这里换成一次 function-calling，下游 kind 契约不变。
 *
 * 打分规则：**动词决定意图，主题词只做加权**。
 * 「按大纲拆镜」里 `大纲` 是主题、`拆镜` 是动作，要落到分镜而不是大纲；
 * 「润色一下这段台词」同理落到润色而不是写正文。
 */

const ACT = 10;
const TOPIC = 3;

interface Rule {
  readonly kind: IntentKind;
  /** 祈使动词 / 明确动作 */
  readonly act: readonly string[];
  /** 主题名词 */
  readonly topic: readonly string[];
}

const RULES: readonly Rule[] = [
  { kind: 'outline.draft',
    act: ['起草', '搭个结构', '写大纲', 'outline'],
    topic: ['大纲', '幕', '结构', '故事线', '灵感', '想法', '开头'] },
  { kind: 'outline.expand',
    act: ['延展', '展开', '换个'],
    topic: ['走向', '备选', '分支', '另一种', '可能性', '反转', '如果'] },
  { kind: 'script.draft',
    act: ['写这场', '写正文', '写一下', 'script'],
    topic: ['正文', '剧本', '对白', '台词', '旁白', '场景描写'] },
  { kind: 'script.polish',
    act: ['润色', '改写', '精简', '打磨', '重写', 'polish'],
    topic: ['语感', '更口语', '啰嗦'] },
  { kind: 'assets.extract',
    act: ['提取', '抽取', '扒出来'],
    topic: ['角色', '人物', '资产', '道具', '设定', '场景表'] },
  { kind: 'assets.views',
    act: ['补齐', '补全'],
    topic: ['形状照', '多视角', '参考图', '三视图', '视角'] },
  { kind: 'shots.generate',
    act: ['拆镜', '生成分镜', '拆成镜头', 'storyboard'],
    topic: ['分镜', '镜头表'] },
  { kind: 'shots.prompt',
    act: ['补写', '写提示词'],
    topic: ['提示词', 'prompt', '镜头描述'] },
  { kind: 'style.transfer',
    act: ['统一', '换成', '改风格'],
    topic: ['画风', '风格', 'style', '质感'] },
  { kind: 'video.batch',
    act: ['转视频', '批量生成', '出片'],
    topic: ['视频', 'video'] },
  { kind: 'edit.autocut',
    act: ['成片', '卡点', '排序', '自动剪'],
    topic: ['剪辑', '节拍', '时间线'] },
  { kind: 'cost.report',
    act: ['花了', '算一下'],
    topic: ['成本', '积分', '消耗', '命中率', '报告', '预算', '贵'] },
];

/** 命中的关键词（界面上可以解释「为什么这么理解」） */
export interface RouteResult {
  readonly kind: IntentKind;
  readonly matched: readonly string[];
}

export function route(text: string): RouteResult {
  const t = text.toLowerCase();
  const hit = (words: readonly string[]) => words.filter((w) => t.includes(w.toLowerCase()));

  let best: RouteResult = { kind: 'chat', matched: [] };
  let bestScore = 0;
  for (const r of RULES) {
    const acts = hit(r.act);
    const topics = hit(r.topic);
    if (!acts.length && !topics.length) continue;
    const score = acts.length * ACT + topics.length * TOPIC;
    if (score > bestScore) {
      bestScore = score;
      best = { kind: r.kind, matched: [...acts, ...topics] };
    }
  }
  return best;
}

export const routeKind = (text: string): IntentKind => route(text).kind;
