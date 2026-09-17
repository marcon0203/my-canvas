// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useProject } from './project';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';
import { submitGen } from '@/api/generation';

/**
 * 生成失败要留在镜头上，不是飘一条 toast。
 * toast 会走，而失败是要人回头处理的东西。
 */
describe('failRun', () => {
  beforeEach(() => {
    useProject.getState().hydrate({
      project: structuredClone(MOCK_PROJECTS['p1']!),
      config: structuredClone(MOCK_CONFIG),
    });
  });

  const shot = (id: string) => useProject.getState().shots.find((s) => s.id === id)!;

  it('连续失败累加次数 —— 失败一次和三次，下一步要做的事不一样', () => {
    useProject.getState().failRun('s1-1', '余额不足');
    expect(shot('s1-1').fail).toEqual({ n: 1, why: '余额不足' });
    useProject.getState().failRun('s1-1', '审核拒绝');
    expect(shot('s1-1').fail).toEqual({ n: 2, why: '审核拒绝' });
  });

  it('失败不加 takes —— takes 是记账口径，没出图不该计入命中率分母', () => {
    const before = shot('s1-1').takes;
    useProject.getState().failRun('s1-1', 'x');
    expect(shot('s1-1').takes).toBe(before);
  });

  it('跑成一次就把失败清掉，红字不能一直挂着', () => {
    useProject.getState().failRun('s1-1', 'x');
    useProject.getState().commitRun('s1-1');
    expect(shot('s1-1').fail).toBeUndefined();
  });

  it('不把「生成中」留在原地', () => {
    useProject.getState().setShotField('s1-1', { vid: 'run' });
    useProject.getState().failRun('s1-1', 'x');
    expect(shot('s1-1').vid).toBe('none');
  });

  it('镜头不存在时不炸 —— 失败回调可能比删镜头晚到', () => {
    expect(() => useProject.getState().failRun('s9-9', 'x')).not.toThrow();
  });
});

describe('submitGen 的失败终态', () => {
  it('空提示词当场失败，不进队列也不扣分', async () => {
    let failed: string | undefined;
    const t = submitGen(
      { model: 'm', prompt: '   ', ratio: '9:16', batch: 1, refs: [] },
      undefined,
      (x) => { failed = x.error; },
    );
    expect(t.status).toBe('failed');
    expect(t.error).toContain('提示词是空的');
    await new Promise((r) => setTimeout(r, 5));
    expect(failed).toContain('提示词是空的');
  });

  it('batch 不合法也是失败，而不是提交一个跑不出东西的任务', () => {
    const t = submitGen({ model: 'm', prompt: 'a cat', ratio: '9:16', batch: 0, refs: [] });
    expect(t.status).toBe('failed');
  });
});
