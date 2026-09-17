// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Outcome } from '@/api/desktop';
import type { ToolId } from '@/domain/agent/tools';

/** 每个用例自己决定这次工具调用返回什么 */
let next: Outcome | (() => never);
const calls: { tool: string; approved?: boolean }[] = [];

vi.mock('@/api/desktop', async (orig) => ({
  ...(await orig<typeof import('@/api/desktop')>()),
  toolCall: vi.fn(async (a: { tool: string; approved?: boolean }) => {
    calls.push({ tool: a.tool, approved: a.approved });
    if (typeof next === 'function') next();
    return next;
  }),
}));

const { useAgent } = await import('./agent');
const { useProject } = await import('./project');
const { MOCK_PROJECTS } = await import('@/mock/project');
const { MOCK_CONFIG } = await import('@/mock/config');

/**
 * 工具调用的六种结果各有各的下一步。只测跑通那一种没有意义 ——
 * 界面上真正会卡住人的是另外五种。
 */
describe('runTool：每种结果都有落点', () => {
  beforeEach(() => {
    calls.length = 0;
    useAgent.getState().reset();
    useProject.getState().hydrate({
      project: structuredClone(MOCK_PROJECTS['p1']!),
      config: structuredClone(MOCK_CONFIG),
    });
  });

  const last = () => useAgent.getState().messages.at(-1)!;
  const run = async (tool: ToolId) => {
    useAgent.getState().runTool(tool);
    await vi.waitFor(() => expect(last().tool?.state).not.toBe('running'));
  };

  it('补丁 → 产物卡，待采纳（不直接写项目）', async () => {
    next = { t: 'patch', tool: 'edit.timeline', patch: { t: 'timeline', timeline: { clips: [{ shotId: 's1-1', at: 0, dur: 2000 }], beatMs: 500 } } };
    const before = useProject.getState().timeline.clips.length;
    await run('edit.timeline');
    expect(last().proposal?.title).toContain('1 段');
    expect(last().verdict).toBe('pending');
    expect(useProject.getState().timeline.clips.length).toBe(before);   // 还没写
  });

  it('要人点头 → 同意卡；点同意后带 approved 再调一次', async () => {
    next = { t: 'needsApproval', tool: 'file.export', risk: 'egress', why: '会把东西送出这台机器' };
    await run('edit.timeline');
    expect(last().tool?.state).toBe('approval');
    expect(last().tool?.why).toContain('送出');

    next = { t: 'ok', value: { filename: 'x.csv', bytes: 2048 } };
    const id = last().id;
    useAgent.getState().approveTool(id);
    await vi.waitFor(() => expect(useAgent.getState().messages.at(-1)!.tool?.state).toBe('done'));
    expect(calls.map((c) => c.approved)).toEqual([false, true]);
    // 复用同一条消息，不再冒一条新的
    expect(useAgent.getState().messages.at(-1)!.id).toBe(id);
    expect(useAgent.getState().messages.at(-1)!.text).toContain('x.csv');
  });

  it('没点同意就不会带 approved —— 放行只对那一次', async () => {
    next = { t: 'needsApproval', tool: 'file.export', risk: 'egress', why: 'x' };
    await run('edit.timeline');
    useAgent.getState().runTool('edit.timeline');           // 另起一次
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(calls.every((c) => c.approved === false)).toBe(true);
  });

  it('缺配置 → 指到设置页，不是「用不了」', async () => {
    next = { t: 'needsSetup', tool: 'image.generate', missing: '要一个图片模型和它的密钥' };
    await run('edit.timeline');
    expect(last().tool?.state).toBe('setup');
    expect(last().tool?.why).toContain('密钥');
  });

  it('还没实现 → 如实说缺什么', async () => {
    next = { t: 'notImplemented', tool: 'audio.tts', blockedBy: '配音不走异步任务协议' };
    await run('edit.timeline');
    expect(last().tool?.state).toBe('blocked');
  });

  it('工具自己的校验错误 → 原话摆出来，不当崩溃', async () => {
    next = (() => { throw new Error('还没有出好的视频片段，排不了时间线'); }) as () => never;
    await run('edit.timeline');
    expect(last().tool?.state).toBe('failed');
    expect(last().tool?.why).toContain('排不了时间线');
  });

  it('没有打开的项目时不发请求', async () => {
    useProject.setState({ hydratedFor: undefined });
    next = { t: 'ok', value: {} };
    useAgent.getState().runTool('edit.timeline');
    await vi.waitFor(() => expect(last().tool?.state).toBe('failed'));
    expect(calls.length).toBe(0);
    expect(last().tool?.why).toContain('没有打开的项目');
  });

  it('approveTool 只对「要点头」那条生效 —— 别的状态点了没反应', async () => {
    next = { t: 'ok', value: {} };
    await run('edit.timeline');
    const n = calls.length;
    useAgent.getState().approveTool(last().id);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(n);
  });
});
