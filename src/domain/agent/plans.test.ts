import { describe, expect, it } from 'vitest';
import { MOCK_PROJECT } from '@/mock/project';
import { defaultRig } from '@/domain/assets/model';
import { allBeats } from '@/domain/story/model';
import type { AgentContext } from './context';
import { plan } from './plans';
import { defaultConfigs } from './config';
import { taskOf } from './tasks';

/** 用真实 seed 建上下文：计划必须对得上项目现状，不能是写死的文案 */
function ctx(input = '', over: Partial<AgentContext> = {}): AgentContext {
  const p = structuredClone(MOCK_PROJECT);
  for (const group of Object.values(p.assets)) {
    for (const a of group) for (const v of a.views) v.rig ??= defaultRig(v.name);
  }
  for (const s of p.shots) s.rig ??= defaultRig(s.size);
  return {
    proj: p.proj, style: p.style, stylePrompt: p.stylePrompt, styles: p.styles,
    ratio: p.ratio, credits: p.credits, budget: p.budget,
    acts: p.acts, blocks: p.blocks, assets: p.assets, shots: p.shots,
    sel: { step: 'outline', beatId: 'b3', assetId: 'c1', shotId: 's1-1', blockId: null },
    input,
    agentId: 'writer',
    agents: defaultConfigs(),
    globalModels: {},
    ...over,
  };
}

describe('agent/plans · 产物来自项目现状', () => {
  it('拆镜只补没有镜头的场次，不碰已有的', () => {
    const c = ctx();
    const covered = new Set(c.shots.map((s) => s.sceneKey));
    const p = plan('shots.generate', c);
    const shots = p.proposal!.patch.t === 'shots' ? p.proposal!.patch.shots : [];
    expect(shots.length).toBeGreaterThan(0);
    for (const s of shots) expect(covered.has(s.sceneKey)).toBe(false);
    // 新镜头 id 不与既有的撞车
    const ids = new Set(c.shots.map((s) => s.id));
    for (const s of shots) expect(ids.has(s.id)).toBe(false);
  });

  it('拆镜留空提示词，交给下一步补 —— 两步能真的接上', () => {
    const c = ctx();
    const gen = plan('shots.generate', c);
    const shots = gen.proposal!.patch.t === 'shots' ? gen.proposal!.patch.shots : [];
    expect(shots.every((s) => !s.own)).toBe(true);

    const after = ctx('', { shots: [...c.shots, ...shots] });
    const pr = plan('shots.prompt', after);
    const edits = pr.proposal!.patch.t === 'shotPrompts' ? pr.proposal!.patch.edits : [];
    expect(edits.map((e) => e.id).sort()).toEqual(shots.map((s) => s.id).sort());
    expect(edits.every((e) => e.own.length > 0)).toBe(true);
  });

  it('提取资产只给剧本里出现、库里还没有的，且一律建成草稿', () => {
    const p = plan('assets.extract', ctx());
    const add = p.proposal!.patch.t === 'assets' ? p.proposal!.patch.add : [];
    expect(add.length).toBeGreaterThan(0);
    const known = ['艾米', '年糕', '小女孩房间', '宠物医院', '猫神殿', '博物馆'];
    for (const { asset } of add) {
      expect(asset.status).toBe('draft');
      expect(known.some((k) => asset.name.includes(k))).toBe(false);
    }
  });

  it('补形状照只挑没出过图的', () => {
    const c = ctx();
    const p = plan('assets.views', c);
    const gen = p.proposal!.patch.t === 'assetViews' ? p.proposal!.patch.gen : [];
    const all = [...c.assets.角色, ...c.assets.场景, ...c.assets.道具];
    expect(gen.length).toBe(all.flatMap((a) => a.views).filter((v) => !v.gen).length);
    for (const g of gen) {
      const v = all.find((a) => a.id === g.assetId)!.views.find((x) => x.name === g.viewName)!;
      expect(v.gen).toBe(false);
    }
  });

  it('已有大纲时补场，而不是推翻重来', () => {
    const c = ctx('猫从画里走出来');
    const p = plan('outline.draft', c);
    const acts = p.proposal!.patch.t === 'acts' ? p.proposal!.patch.acts : [];
    expect(acts.length).toBe(c.acts.length);
    expect(allBeats(acts).length).toBe(allBeats(c.acts).length + 1);
    // 新场次键不与既有的撞车
    const keys = allBeats(acts).map((b) => b.k);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('空项目起草三幕骨架', () => {
    const p = plan('outline.draft', ctx('一只猫在做梦', { acts: [] }));
    const acts = p.proposal!.patch.t === 'acts' ? p.proposal!.patch.acts : [];
    expect(acts).toHaveLength(3);
    expect(allBeats(acts).length).toBe(6);
  });

  it('前置条件不满足时明说做不了，不产出假产物', () => {
    expect(plan('outline.expand', ctx('', { acts: [] })).blocked).toBeTruthy();
    expect(plan('edit.autocut', ctx('', { shots: [] })).blocked).toBeTruthy();
    expect(plan('shots.prompt', ctx()).blocked).toBeTruthy(); // seed 里每镜都有提示词
    expect(plan('outline.expand', ctx()).proposal).toBeTruthy();
  });

  /**
   * 浏览器里没有 IPC，「延展走向」会回落成三个固定句式套上这一场的标题。
   *
   * 这条测试钉住那个回落的样子，以及**界面说明必须承认它** ——
   * 桌面端走 expand.rs 真发请求，浏览器这条路没有，两者产物形状相同但
   * 内容来源完全不同。不说清的话，在浏览器里试用的人会以为模型已经接上了。
   */
  it('浏览器回落：延展走向只套这一场的标题，没有读别的上下文', () => {
    const base = plan('outline.expand', ctx());
    const alts = base.proposal!.rows.map((r) => r.v);
    expect(alts).toHaveLength(3);

    const beat = allBeats(ctx().acts).find((b) => b.id === 'b3')!;
    for (const a of alts) expect(a.startsWith(beat.t), a).toBe(true);

    // 换掉资产、镜头、画风、输入 —— 三条走向一个字都不变
    const moved = plan('outline.expand', ctx('要更黑暗一点', {
      assets: { 角色: [], 场景: [], 道具: [] },
      shots: [],
      style: '像素风', stylePrompt: 'pixel art',
    }));
    expect(moved.proposal!.rows.map((r) => r.v)).toEqual(alts);

    // 说明里要同时讲清两件事：桌面端送了什么、浏览器里会回落
    const note = taskOf('outline.expand')!.impl.note;
    expect(note).toContain('前后');
    expect(note).toMatch(/浏览器/);
    expect(note).toMatch(/回落|固定句式/);
  });

  it('成本报告用的是真实记账口径', () => {
    const c = ctx();
    const reply = plan('cost.report', c).reply;
    expect(reply).toContain(String(c.budget - c.credits));
    expect(plan('cost.report', c).proposal).toBeUndefined(); // 只是回答，不写项目
  });

  it('换画风不动节点级画风的形状照', () => {
    const c = ctx('换成像素风');
    const p = plan('style.transfer', c);
    const patch = p.proposal!.patch;
    expect(patch.t === 'style' && patch.style).toBe('像素风');
  });
});
