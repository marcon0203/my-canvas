import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKILL_FOR_TASK } from '@/api/agent';
import { MOCK_PROJECT } from '@/mock/project';
import { defaultRig } from '@/domain/assets/model';
import { INTENT_META } from './roster';
import { RULES } from './router';
import { TOOLS_FOR_INTENT } from './tools';
import { plan } from './plans';
import { defaultConfigs } from './config';
import type { AgentContext } from './context';
import { TASKS, isTaskId, taskOf, toolsOf, triggersOf } from './tasks';
import type { TaskId } from './tasks';

const ALL = Object.keys(INTENT_META) as TaskId[];

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
    sel: { step: 'outline', beatId: 'b3', assetId: 'c1', shotId: 's1-1', blockId: 'd1' },
    input: '', agentId: 'writer', agents: defaultConfigs(), globalModels: {},
    ...over,
  };
}

describe('agent/skills · 注册表不能是装饰', () => {
  it('12 件活一件不多一件不少，顺序与 INTENT_META 一致', () => {
    expect(TASKS.map((s) => s.id)).toEqual(ALL);
  });

  it('名字与图标取自 INTENT_META，不在注册表里另写一份', () => {
    for (const s of TASKS) {
      expect(s.name, s.id).toBe(INTENT_META[s.id].name);
      expect(s.icon, s.id).toBe(INTENT_META[s.id].icon);
    }
  });

  it('工具取自 tools.ts —— 同一份事实，不会两处打架', () => {
    for (const s of TASKS) expect(toolsOf(s.id), s.id).toBe(TOOLS_FOR_INTENT[s.id]);
  });

  it('触发词取自 router 的 RULES —— 改了路由，界面上跟着变', () => {
    for (const s of TASKS) {
      const rule = RULES.find((r) => r.kind === s.id)!;
      expect(triggersOf(s.id).act, s.id).toEqual(rule.act);
      expect(triggersOf(s.id).topic, s.id).toEqual(rule.topic);
    }
  });

  it('每件活都有触发词，否则自由输入永远路由不到它', () => {
    for (const s of TASKS) {
      const t = triggersOf(s.id);
      expect(t.act.length + t.topic.length, s.id).toBeGreaterThan(0);
    }
  });

  it('声明的 patch 与 plans.ts 真实产出的一致 —— 这条挡住注册表变成过期文档', () => {
    const c = ctx();
    for (const s of TASKS) {
      const p = plan(s.id, c);
      if (p.blocked) continue;           // 这个 seed 上跑不了的，换个上下文再核
      expect(p.proposal?.patch.t ?? null, s.id).toBe(s.patch);
      expect(p.proposal?.goto ?? null, s.id).toBe(s.goto);
    }
  });

  it('seed 上被挡住的那几件，换成空项目再核一遍 patch', () => {
    const empty = ctx({ acts: [], blocks: [], shots: [] });
    for (const s of TASKS) {
      const p = plan(s.id, empty);
      if (p.blocked) continue;
      expect(p.proposal?.patch.t ?? null, s.id).toBe(s.patch);
    }
  });

  it('三种上下文合起来要把 12 件活全核到 —— 不能有谁在哪儿都被跳过', () => {
    const covered = new Set<string>();
    // seed 里每一镜都有提示词，空项目又没有镜头 —— 补写提示词在两边都会被挡住，
    // 所以第三种上下文是「有镜头但提示词空着」
    const blank = ctx();
    const noPrompt = ctx({ shots: blank.shots.map((sh) => ({ ...sh, own: '' })) });
    for (const c of [ctx(), ctx({ acts: [], blocks: [], shots: [] }), noPrompt]) {
      for (const s of TASKS) if (!plan(s.id, c).blocked) covered.add(s.id);
    }
    expect([...covered].sort()).toEqual([...ALL].sort());
  });

  /**
   * 「已接模型」不能是一个手写的清单 —— 原来这条测试就是写死的两个 id，
   * 加一条链路时它拦不住任何东西（漏标 local 也一样过）。
   * 改成对着真实的接线查：Rust 模块在不在、SKILL.md 在不在、
   * 两张表对不对得上。
   */
  it('标了 by: model 的，Rust 模块与 SKILL.md 都真的在', () => {
    const wired = TASKS.filter((s) => s.impl.by === 'model');
    expect(wired.length).toBeGreaterThan(0);
    for (const s of wired) {
      const mod = (s.impl as { module: string }).module;
      expect(existsSync(join(process.cwd(), 'src-tauri', mod)), `缺 ${mod}`).toBe(true);
      const skill = SKILL_FOR_TASK[s.id];
      expect(skill, `${s.id} 没有对应的 skill`).toBeTruthy();
      expect(
        existsSync(join(process.cwd(), 'resources/skills', skill!, 'SKILL.md')),
        `缺 resources/skills/${skill}/SKILL.md`,
      ).toBe(true);
    }
  });

  it('两张表对得上：有 skill 的就是接了模型的，反之也成立', () => {
    const wired = TASKS.filter((s) => s.impl.by === 'model').map((s) => s.id).sort();
    expect(Object.keys(SKILL_FOR_TASK).sort()).toEqual(wired);
  });

  it('标了 by: local 的不指任何 Rust 模块 —— 那会让人以为它接上了', () => {
    for (const s of TASKS) {
      if (s.impl.by === 'local') expect('module' in s.impl, s.id).toBe(false);
    }
  });

  it('乱填的 id 不认 —— 路由靠它挡住白屏', () => {
    for (const s of TASKS) expect(isTaskId(s.id)).toBe(true);
    for (const bad of ['chat', 'nope', '', 'constructor', 'toString']) {
      expect(isTaskId(bad), bad).toBe(false);
    }
    expect(isTaskId(undefined)).toBe(false);
    expect(taskOf('nope' as TaskId)).toBeUndefined();
  });
});
