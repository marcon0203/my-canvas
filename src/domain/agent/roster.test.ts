import { describe, expect, it } from 'vitest';
import { PERSONAS, canHandle, intentName, isAgentId, ownerOf, personaForStep, personaById, skillsOf } from './roster';
import type { IntentKind } from './types';

const ALL_KINDS: IntentKind[] = [
  'outline.draft', 'outline.expand', 'script.draft', 'script.polish',
  'assets.extract', 'assets.views', 'shots.generate', 'shots.prompt',
  'style.transfer', 'video.batch', 'edit.autocut', 'cost.report',
];

describe('agent/roster · 分工', () => {
  it('每件活儿恰好有一位 Agent 认领 —— 没有孤儿，也没有两人抢', () => {
    for (const k of ALL_KINDS) {
      const owners = PERSONAS.filter((p) => p.owns.includes(k));
      expect(owners, `${k} 的认领人数`).toHaveLength(1);
    }
  });

  it('每个环节都有当班的 Agent', () => {
    for (const step of ['outline', 'script', 'assets', 'storyboard', 'editing', 'overview', 'metrics']) {
      expect(personaForStep(step)).toBeTruthy();
    }
    expect(personaForStep('outline').id).toBe('writer');
    expect(personaForStep('assets').id).toBe('art');
    expect(personaForStep('storyboard').id).toBe('dp');
    expect(personaForStep('editing').id).toBe('editor');
    expect(personaForStep('metrics').id).toBe('producer');
  });

  it('转交目标的主场环节存在，跳过去不会落空', () => {
    for (const p of PERSONAS) {
      expect(p.steps.length).toBeGreaterThan(0);
      expect(personaForStep(p.steps[0]!).id).toBe(p.id);
    }
  });

  it('闲聊谁都能接，专业活儿只有主人能接', () => {
    for (const p of PERSONAS) expect(canHandle(p, 'chat')).toBe(true);
    const writer = personaById('writer');
    expect(canHandle(writer, 'outline.draft')).toBe(true);
    expect(canHandle(writer, 'video.batch')).toBe(false);
    expect(ownerOf('video.batch')!.id).toBe('dp');
  });

  it('技能卡就是这位 Agent 能接的活儿 —— 两处不会走偏', () => {
    for (const p of PERSONAS) {
      const kinds = skillsOf(p).map((s) => s.kind);
      expect(kinds).toEqual(p.owns.filter((k) => k !== 'chat'));
      for (const s of skillsOf(p)) expect(s.name).toBe(intentName(s.kind));
    }
  });

  it('转交话术里留着接手方的占位符', () => {
    for (const p of PERSONAS) expect(p.handoff).toContain('%s');
  });
});

describe('roster · URL 段校验', () => {
  it('五位都认得', () => {
    for (const p of PERSONAS) expect(isAgentId(p.id)).toBe(true);
  });

  it('乱填的名字不认 —— 路由靠它挡住白屏', () => {
    for (const bad of ['nobody', '', 'Writer', 'writer ', 'constructor', 'toString']) {
      expect(isAgentId(bad)).toBe(false);
    }
    expect(isAgentId(undefined)).toBe(false);
  });
});
