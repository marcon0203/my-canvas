// @vitest-environment jsdom
// Vite 把这个文件当模块 id 处理，import.meta.url 在 jsdom 环境下不是 file:// ——
// 用 ?raw 直接把 fixture 内容编进来，路径由打包器解析，不依赖运行时的 URL 形式
import FIXTURE from './__fixtures__/rust-patches.json?raw';
import { describe, expect, it } from 'vitest';
import { useProject } from '@/store/project';
import type { ProposalPatch } from '@/domain/agent/types';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';

/**
 * **真拿 Rust 算出来的补丁喂给 store。**
 *
 * 两侧各写一份「补丁长什么样」的话，对不上的那天是这样发现的：界面上采纳了、
 * 卡片变成「已采纳」、项目里什么都没变 —— 不报错，不留日志。所以这里不手写
 * JSON，吃的是 Rust 生成的 fixture（`npm run fixtures` 重新生成）。
 *
 * 为什么不在测试里直接调 cargo：那样每跑一次前端测试都要编一遍 Rust，而且
 * 没装 Rust 的环境会静静跳过 —— **一个会静静跳过的守卫等于没有**（第一版就是
 * 这么写的，结果它在这个容器里一直是 skipped）。fixture 的新鲜度由 Rust 侧
 * `patch::tests::样本文件与当前实现一致` 盯着。
 */

const SAMPLES = JSON.parse(FIXTURE) as Record<string, ProposalPatch>;

/** 取一个样本。缺了就直接报「fixture 里没有这个工具」，而不是一串 undefined */
function sample(tool: string): ProposalPatch {
  const p = SAMPLES[tool];
  if (!p) throw new Error(`fixture 里没有 ${tool} —— 跑 npm run fixtures`);
  return p;
}

describe('Rust 算出的补丁能被 store 应用', () => {
  const reset = () => {
    const t = useProject.temporal.getState();
    t.pause();
    useProject.getState().hydrate({
      project: structuredClone(MOCK_PROJECTS['p1']!),
      config: structuredClone(MOCK_CONFIG),
    });
    t.clear();
    t.resume();
  };

  it('每个样本的 t 都是 store 认识的分支 —— 不认识的会被 switch 静默吃掉', () => {
    const known: ProposalPatch['t'][] = [
      'acts', 'alts', 'blocks', 'blockBody', 'assets', 'assetsDraft',
      'assetViews', 'shots', 'shotPrompts', 'shotRig', 'style', 'assetLock', 'run',
    ];
    for (const [tool, p] of Object.entries(SAMPLES)) {
      expect(known, `${tool} 给的 t=${p.t}`).toContain(p.t);
    }
  });

  it('写剧本：新块接在后面，块 id 不和已有的撞', () => {
    reset();
    const before = useProject.getState().blocks.length;
    useProject.getState().applyAgentPatch(sample('script.write'));
    const blocks = useProject.getState().blocks;
    expect(blocks.length).toBe(before + 1);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });

  it('建资产：aid 用 Rust 编的那个，形状照由前端补全', () => {
    reset();
    useProject.getState().applyAgentPatch(sample('asset.write'));
    const chars = useProject.getState().assets.角色;
    const added = chars[chars.length - 1]!;
    expect(added.aid).toMatch(/^CHAR-\d{3}$/);
    // 形状照不能是空的，否则资产页进去是一张白纸
    expect(added.views.length).toBeGreaterThan(0);
    expect(added.views[0]!.rig).toBeDefined();
    expect(added.status).toBe('draft');   // 新资产是草稿，定稿要人点
  });

  it('设机位：只改给到的字段，其余保持原样', () => {
    reset();
    const p = sample('shot.rig');
    if (p.t !== 'shotRig') throw new Error('样本类型变了');
    const id = p.edits[0]!.id;
    const before = structuredClone(useProject.getState().shots.find((s) => s.id === id)!.rig);
    useProject.getState().applyAgentPatch(p);
    const after = useProject.getState().shots.find((s) => s.id === id)!.rig;
    for (const k of Object.keys(before) as (keyof typeof before)[]) {
      if (k in p.edits[0]!.rig) continue;
      expect(after[k], `${k} 不该被动`).toEqual(before[k]);
    }
    for (const [k, v] of Object.entries(p.edits[0]!.rig)) {
      expect(after[k as keyof typeof after]).toEqual(v);
    }
  });

  it('换画风：项目画风与英文片段一起换 —— 只换一个会让提示词和画风不符', () => {
    reset();
    useProject.getState().applyAgentPatch(sample('style.apply'));
    const s = useProject.getState();
    expect(s.style).toBe('胶片质感');
    expect(s.stylePrompt).toBe('film photography, grainy');
  });

  it('写大纲与写分镜的补丁仍然能应用（回归）', () => {
    reset();
    useProject.getState().applyAgentPatch(sample('outline.write'));
    expect(useProject.getState().acts.length).toBeGreaterThan(0);
    reset();
    const n = useProject.getState().shots.length;
    useProject.getState().applyAgentPatch(sample('shot.write'));
    expect(useProject.getState().shots.length).toBe(n + 1);
  });
});
