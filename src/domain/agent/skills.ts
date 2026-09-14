import type { IntentKind } from './types';

/** 技能卡：Agent 空会话时按环节推荐的入口 */
export interface Skill {
  readonly icon: string;
  readonly name: string;
  readonly kind: IntentKind;
}

/**
 * 每个环节推荐的技能。技能卡点击 = 直接派发 kind，
 * 不经过自由文本路由 —— 点卡片的意图是确定的。
 */
export const SKILLS: Record<string, readonly Skill[]> = {
  outline: [
    { icon: 'spark', name: '从一句灵感起草大纲', kind: 'outline.draft' },
    { icon: 'map', name: '延展这一场的剧情走向', kind: 'outline.expand' },
    { icon: 'book', name: '为选中场次写正文', kind: 'script.draft' },
    { icon: 'layers', name: '按大纲生成分镜', kind: 'shots.generate' },
  ],
  script: [
    { icon: 'text', name: '为选中场次写正文', kind: 'script.draft' },
    { icon: 'wand', name: '润色当前文档块', kind: 'script.polish' },
    { icon: 'users', name: '从剧本提取角色与场景', kind: 'assets.extract' },
    { icon: 'layers', name: '按大纲生成分镜', kind: 'shots.generate' },
  ],
  assets: [
    { icon: 'users', name: '从剧本提取角色与场景', kind: 'assets.extract' },
    { icon: 'image', name: '补齐缺失的形状照', kind: 'assets.views' },
    { icon: 'wand', name: '统一画风', kind: 'style.transfer' },
    { icon: 'layers', name: '按大纲生成分镜', kind: 'shots.generate' },
  ],
  storyboard: [
    { icon: 'layers', name: '按大纲生成分镜', kind: 'shots.generate' },
    { icon: 'text', name: '为缺提示词的镜头补写', kind: 'shots.prompt' },
    { icon: 'video', name: '批量转视频', kind: 'video.batch' },
    { icon: 'bolt', name: '成本与命中率报告', kind: 'cost.report' },
  ],
  editing: [
    { icon: 'scissors', name: '按节拍自动成片', kind: 'edit.autocut' },
    { icon: 'video', name: '批量转视频', kind: 'video.batch' },
    { icon: 'bolt', name: '成本与命中率报告', kind: 'cost.report' },
    { icon: 'wand', name: '统一画风', kind: 'style.transfer' },
  ],
  overview: [
    { icon: 'spark', name: '从一句灵感起草大纲', kind: 'outline.draft' },
    { icon: 'layers', name: '按大纲生成分镜', kind: 'shots.generate' },
    { icon: 'video', name: '批量转视频', kind: 'video.batch' },
    { icon: 'bolt', name: '成本与命中率报告', kind: 'cost.report' },
  ],
  metrics: [
    { icon: 'bolt', name: '成本与命中率报告', kind: 'cost.report' },
    { icon: 'text', name: '为缺提示词的镜头补写', kind: 'shots.prompt' },
    { icon: 'wand', name: '统一画风', kind: 'style.transfer' },
    { icon: 'users', name: '从剧本提取角色与场景', kind: 'assets.extract' },
  ],
};

export const skillsFor = (step: string): readonly Skill[] => SKILLS[step] ?? SKILLS.script!;
