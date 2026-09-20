import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';
import { useProject } from './project';
import { toBundleFrom } from '@/api/store';

/**
 * 真实用量与积分是两套口径。
 *
 * 积分是本地常量拍的（大纲 2、分镜 3…），走完一整条流程看到「已消耗 38 积分」，
 * 那个 38 不对应任何真实开销。所以厂商报回来的 token 单独记、单独落盘。
 */
beforeEach(() => {
  const t = useProject.temporal.getState();
  t.pause();
  useProject.getState().hydrate({
    project: structuredClone(MOCK_PROJECTS['p1']!),
    config: structuredClone(MOCK_CONFIG),
  });
  t.clear();
  t.resume();
});

describe('真实用量记账', () => {
  it('累加而不是覆盖 —— 一轮里可能发几次请求', () => {
    const { addUsage } = useProject.getState();
    addUsage({ inputTokens: 100, outputTokens: 20 });
    addUsage({ inputTokens: 80, outputTokens: 15 });
    expect(useProject.getState().usage).toEqual({
      inputTokens: 180, outputTokens: 35, unreported: 0,
    });
  });

  it('全 0 记成「那家没报」，不当成花了 0 个 token', () => {
    useProject.getState().addUsage({ inputTokens: 0, outputTokens: 0 });
    const u = useProject.getState().usage;
    expect(u.inputTokens).toBe(0);
    expect(u.unreported, '要记下来，否则 token 偏低看起来像很省').toBe(1);
  });

  it('只报了出没报进也算报了 —— 有些家只给一个数', () => {
    useProject.getState().addUsage({ inputTokens: 0, outputTokens: 42 });
    expect(useProject.getState().usage).toEqual({
      inputTokens: 0, outputTokens: 42, unreported: 0,
    });
  });

  it('记用量不动积分，扣积分不动用量 —— 两套口径互不影响', () => {
    const before = useProject.getState().credits;
    useProject.getState().addUsage({ inputTokens: 5000, outputTokens: 900 });
    expect(useProject.getState().credits, 'token 不该换算成积分').toBe(before);

    useProject.getState().spend(7);
    expect(useProject.getState().usage.inputTokens).toBe(5000);
    expect(useProject.getState().credits).toBe(before - 7);
  });

  it('落盘：token 跟着项目存，关掉应用不会丢', () => {
    useProject.getState().addUsage({ inputTokens: 1234, outputTokens: 56 });
    useProject.getState().addUsage({ inputTokens: 0, outputTokens: 0 });
    const s = useProject.getState();
    const meta = toBundleFrom('p1', {
      proj: s.proj, ratio: s.ratio, style: s.style, stylePrompt: s.stylePrompt,
      styles: s.styles, credits: s.credits, budget: s.budget, usage: s.usage,
      acts: s.acts, blocks: s.blocks, assets: s.assets, shots: s.shots,
    }).meta;
    expect(meta.inputTokens).toBe(1234);
    expect(meta.outputTokens).toBe(56);
    expect(meta.unreportedRuns).toBe(1);
  });

  it('老项目没有这几个字段，读回来是 0 而不是 NaN', () => {
    const old = structuredClone(MOCK_PROJECTS['p1']!) as Record<string, unknown>;
    delete old.inputTokens;
    delete old.outputTokens;
    delete old.unreportedRuns;
    useProject.getState().hydrate({
      project: old as never,
      config: structuredClone(MOCK_CONFIG),
    });
    expect(useProject.getState().usage).toEqual({
      inputTokens: 0, outputTokens: 0, unreported: 0,
    });
  });
});
