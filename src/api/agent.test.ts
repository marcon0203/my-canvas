import { describe, expect, it } from 'vitest';
import { MOCK_PROJECT } from '@/mock/project';
import { defaultRig } from '@/domain/assets/model';
import { defaultConfigs } from '@/domain/agent/config';
import type { AgentContext } from '@/domain/agent/context';
import { promptProposal, shotBriefs } from './agent';

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  const p = structuredClone(MOCK_PROJECT);
  for (const group of Object.values(p.assets)) {
    for (const a of group) for (const v of a.views) v.rig ??= defaultRig(v.name);
  }
  for (const s of p.shots) s.rig ??= defaultRig(s.size);
  return {
    proj: p.proj, style: p.style, stylePrompt: p.stylePrompt, styles: p.styles,
    ratio: p.ratio, credits: p.credits, budget: p.budget,
    acts: p.acts, blocks: p.blocks, assets: p.assets, shots: p.shots,
    sel: { step: 'storyboard', beatId: 'b3', assetId: 'c1', shotId: 's1-1', blockId: null },
    input: '', agentId: 'dp', agents: defaultConfigs(), globalModels: {},
    ...over,
  };
}

describe('api/agent · 补写提示词送给模型的简报', () => {
  it('引用展开成「名字：描述」—— Rust 侧不认识资产库', () => {
    const c = ctx();
    const shot = c.shots.find((s) => s.refs.length > 0)!;
    const [brief] = shotBriefs(c, [shot]);
    expect(brief!.refs.length).toBe(shot.refs.length);
    // 送过去的不是 aid，而是人能读、模型能用的描述
    for (const r of brief!.refs) {
      expect(shot.refs.some((aid) => r.includes(aid))).toBe(false);
      expect(r).toContain('：');
    }
  });

  it('景别带上词表里的英文术语，不让模型自己翻', () => {
    const c = ctx();
    const shot = { ...c.shots[0]!, size: '特写' as const };
    expect(shotBriefs(c, [shot])[0]!.sizeEn).toBe('extreme close-up');
  });

  it('遇到词表外的景别回落到 medium shot，而不是送个 undefined 过去', () => {
    const c = ctx();
    const shot = { ...c.shots[0]!, size: '斜四十五度' as unknown as (typeof c.shots)[0]['size'] };
    expect(shotBriefs(c, [shot])[0]!.sizeEn).toBe('medium shot');
  });
});

describe('api/agent · 提示词产物卡', () => {
  const draft = (n: number) => ({
    reply: 'x',
    prompts: Array.from({ length: n }, (_, i) => ({ id: `s1-${i + 1}`, own: `full shot ${i}` })),
  });

  it('全补齐时标题只报镜数', () => {
    expect(promptProposal(draft(3), 3).title).toBe('补写提示词 · 3 镜');
  });

  it('模型漏写时标题如实报 n/总数，不假装全补上了', () => {
    expect(promptProposal(draft(2), 5).title).toBe('补写提示词 · 2/5 镜');
  });

  it('产物是 shotPrompts 补丁，采纳后直接落回分镜', () => {
    const p = promptProposal(draft(2), 2);
    expect(p.patch.t).toBe('shotPrompts');
    expect(p.patch.t === 'shotPrompts' && p.patch.edits.map((e) => e.id)).toEqual(['s1-1', 's1-2']);
    expect(p.goto).toBe('storyboard');
  });
});
