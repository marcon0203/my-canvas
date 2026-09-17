import { describe, expect, it } from 'vitest';
import {
  AGENT_ICONS, BUILTIN_PERSONAS, canHandle, copyOfPersona, faceClass, hasPersona, intentName,
  isAgentId, makeCustomPersona, ownerOf, personaById, personaForStep, roster, setCustomPersonas,
  skillsOf,
} from './roster';
import type { IntentKind } from './types';

const ALL_KINDS: IntentKind[] = [
  'outline.draft', 'outline.expand', 'script.draft', 'script.polish',
  'assets.extract', 'assets.views', 'shots.generate', 'shots.prompt',
  'style.transfer', 'video.batch', 'edit.autocut', 'cost.report',
];

describe('agent/roster · 分工', () => {
  it('每件活儿恰好有一位 Agent 认领 —— 没有孤儿，也没有两人抢', () => {
    for (const k of ALL_KINDS) {
      const owners = roster().filter((p) => p.owns.includes(k));
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
    for (const p of roster()) {
      expect(p.steps.length).toBeGreaterThan(0);
      expect(personaForStep(p.steps[0]!).id).toBe(p.id);
    }
  });

  it('闲聊谁都能接，专业活儿只有主人能接', () => {
    for (const p of roster()) expect(canHandle(p, 'chat')).toBe(true);
    const writer = personaById('writer');
    expect(canHandle(writer, 'outline.draft')).toBe(true);
    expect(canHandle(writer, 'video.batch')).toBe(false);
    expect(ownerOf('video.batch')!.id).toBe('dp');
  });

  it('技能卡就是这位 Agent 能接的活儿 —— 两处不会走偏', () => {
    for (const p of roster()) {
      const kinds = skillsOf(p).map((s) => s.kind);
      expect(kinds).toEqual(p.owns.filter((k) => k !== 'chat'));
      for (const s of skillsOf(p)) expect(s.name).toBe(intentName(s.kind));
    }
  });

  it('转交话术里留着接手方的占位符', () => {
    for (const p of roster()) expect(p.handoff).toContain('%s');
  });
});

describe('roster · URL 段校验', () => {
  it('五位都认得', () => {
    for (const p of roster()) expect(isAgentId(p.id)).toBe(true);
  });

  it('乱填的名字不认 —— 路由靠它挡住白屏', () => {
    for (const bad of ['nobody', '', 'Writer', 'writer ', 'constructor', 'toString']) {
      expect(isAgentId(bad)).toBe(false);
    }
    expect(isAgentId(undefined)).toBe(false);
  });
});

describe('自定义那几位挂进班底', () => {
  it('没注册过时班底就是内置五位', () => {
    setCustomPersonas([]);
    expect(roster()).toHaveLength(BUILTIN_PERSONAS.length);
    expect(roster().every((p) => !p.custom)).toBe(true);
  });

  it('注册之后按 id 找得到，环节归属仍然只认内置那五位', () => {
    const mine = makeCustomPersona('custom-1', {
      name: '广告片编剧', tagline: '15 秒', icon: 'book',
      preamble: '只写 15 秒能拍完的', owns: ['outline.draft'],
    });
    setCustomPersonas([mine]);
    try {
      expect(personaById('custom-1').name).toBe('广告片编剧');
      expect(hasPersona('custom-1')).toBe(true);
      // 环节不给它：一个环节只有一位当班，出厂那位不该被顶掉
      expect(personaForStep('outline').id).toBe('writer');
      // 出厂分工也不给它 —— 谁实际接活儿由配置说话
      expect(ownerOf('outline.draft')?.id).toBe('writer');
    } finally {
      setCustomPersonas([]);
    }
  });

  it('id 认不出来时给占位，不抛 —— 配置里可能还留着已删掉的那位', () => {
    expect(hasPersona('custom-没了')).toBe(false);
    expect(() => personaById('custom-没了')).not.toThrow();
    expect(personaById('custom-没了').owns).toEqual([]);
  });

  it('头像配色：内置各一个，自己建的共用一个', () => {
    for (const p of BUILTIN_PERSONAS) expect(faceClass(p.id)).toBe(`aface--${p.id}`);
    expect(faceClass('custom-1')).toBe('aface--custom');
  });

  it('不给自定义的编内容：名字空着时用 id 兜底，其余照旧空着', () => {
    const p = makeCustomPersona('custom-7', {
      name: '  ', tagline: '', icon: '不存在的图标', preamble: '', owns: [],
    });
    expect(p.name).toBe('custom-7');
    expect(p.tagline).toBe('');
    expect(p.preamble).toBe('');
    // 图标只认那一组，乱填回落到默认，不会渲染出一个空方块
    expect(AGENT_ICONS).toContain(p.icon);
  });

  it('复制一份：提示词与活儿照搬，环节不搬', () => {
    const src = BUILTIN_PERSONAS.find((p) => p.id === 'dp')!;
    const c = copyOfPersona(src, 'custom-2');
    expect(c.name).toBe('摄影指导副本');
    expect(c.preamble).toBe(src.preamble);
    expect(c.owns).toEqual(src.owns);
    expect(c.steps).toEqual([]);
    expect(c.custom).toBe(true);
  });
});
