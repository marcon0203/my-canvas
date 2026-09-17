// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_PERSONAS, customPersonas, hasPersona, personaById, roster,
} from '@/domain/agent/roster';
import { ownerOfConfigured } from '@/domain/agent/config';
import { useSettings } from './settings';

/**
 * 自己建的 Agent。
 *
 * 要盯的不是「能不能存下来」，而是**建完之后这位在整个应用里算不算数**：
 * 班底里有它、按 id 找得到、能接活儿、删掉之后它认领的活儿变成没人接
 * （而不是静静地谁也不做）。
 */
const NEW = {
  name: '广告片编剧', tagline: '15 秒，前 3 秒要留住人',
  icon: 'book', preamble: '只写 15 秒能拍完的东西。',
  owns: ['outline.draft'] as const,
};

describe('新建智能体', () => {
  beforeEach(() => {
    for (const p of customPersonas()) useSettings.getState().removeAgent(p.id);
  });

  it('建完之后进班底，按 id 找得到，也有了自己的配置', () => {
    const before = roster().length;
    const id = useSettings.getState().addAgent({ ...NEW, owns: [...NEW.owns] });

    expect(roster()).toHaveLength(before + 1);
    expect(hasPersona(id)).toBe(true);
    expect(personaById(id).name).toBe('广告片编剧');
    expect(personaById(id).custom).toBe(true);
    const cfg = useSettings.getState().agents[id]!;
    expect(cfg.agentId).toBe(id);
    // 认领的活儿要的工具自动补齐了，否则它勾着活儿却接不了
    expect(cfg.skills).toContain('outline.draft');
    expect(cfg.tools).toContain('outline.write');
  });

  it('不替用户编内容：没填描述和提示词就是空的', () => {
    const id = useSettings.getState().addAgent({
      name: '随便一位', tagline: '', icon: 'users', preamble: '', owns: [],
    });
    const p = personaById(id);
    expect(p.tagline).toBe('');
    expect(p.preamble).toBe('');
    // 也不会凭空得到一堆活儿
    expect(p.owns).toEqual([]);
  });

  it('能接活儿 —— 把内置那位的活儿撸掉之后，归属落到新建的这位', () => {
    const id = useSettings.getState().addAgent({ ...NEW, owns: [...NEW.owns] });
    expect(ownerOfConfigured('outline.draft', useSettings.getState().agents)).toBe('writer');

    useSettings.getState().patchAgent('writer', { skills: [] });
    expect(ownerOfConfigured('outline.draft', useSettings.getState().agents)).toBe(id);
  });

  it('id 不重复，连着建三位都在', () => {
    const ids = [1, 2, 3].map(() => useSettings.getState().addAgent({ ...NEW, owns: [] }));
    expect(new Set(ids).size).toBe(3);
    expect(customPersonas()).toHaveLength(3);
  });
});

describe('从某位复制一份', () => {
  beforeEach(() => {
    for (const p of customPersonas()) useSettings.getState().removeAgent(p.id);
    useSettings.getState().resetAgent('dp');
  });

  it('提示词、活儿、工具照搬，名字带副本，不占原来的环节', () => {
    const src = personaById('dp');
    const id = useSettings.getState().copyAgent('dp');
    const copy = personaById(id);

    expect(copy.name).toBe('摄影指导副本');
    expect(copy.preamble).toBe(src.preamble);
    expect(copy.owns).toEqual(src.owns);
    expect(copy.custom).toBe(true);
    // 环节不复制：一个环节只有一位当班，复制一份不该把原来那位顶掉
    expect(copy.steps).toEqual([]);

    const cfg = useSettings.getState().agents[id]!;
    expect(cfg.tools).toEqual(useSettings.getState().agents.dp.tools);
    expect(cfg.agentId, '配置里的 agentId 要换成新的，否则改副本会改到原来那位').toBe(id);
  });

  it('复制过来的那位不抢原来那位的归属 —— 内置的排在前面', () => {
    const id = useSettings.getState().copyAgent('dp');
    expect(ownerOfConfigured('shots.generate', useSettings.getState().agents)).toBe('dp');
    expect(id).not.toBe('dp');
  });
});

describe('删掉一位', () => {
  it('内置五位删不掉 —— 它们对应环节', () => {
    for (const p of BUILTIN_PERSONAS) {
      useSettings.getState().removeAgent(p.id);
      expect(hasPersona(p.id), p.name).toBe(true);
      expect(useSettings.getState().agents[p.id]).toBeTruthy();
    }
  });

  it('删掉自定义的那位：班底、配置都清掉，它独占的活儿变成没人接', () => {
    const id = useSettings.getState().addAgent({ ...NEW, owns: ['cost.report'] });
    useSettings.getState().patchAgent('producer', { skills: [] });
    expect(ownerOfConfigured('cost.report', useSettings.getState().agents)).toBe(id);

    useSettings.getState().removeAgent(id);
    expect(hasPersona(id)).toBe(false);
    expect(useSettings.getState().agents[id]).toBeUndefined();
    // 「没人接」是真的没人接，界面上那条提示才有意义
    expect(ownerOfConfigured('cost.report', useSettings.getState().agents)).toBeUndefined();
    useSettings.getState().resetAgent('producer');
  });

  it('配置里还留着已删掉的 id 时，按 id 找人不崩 —— 给一个能看出问题的占位', () => {
    const p = personaById('custom-已经删了');
    expect(p.name).toBe('custom-已经删了');
    expect(p.owns).toEqual([]);
  });
});
