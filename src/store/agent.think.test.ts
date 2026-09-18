// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@/api/desktop';

/**
 * 桌面端那条路（真模型 + IPC）的事件翻译。
 *
 * 这一层原来一条测试都没有，而它正是「推理过程」最容易被悄悄吞掉的地方：
 * 泵里那个 switch 没有 default，漏一个 case 事件就消失，不报错、不留痕。
 *
 * 要盯住两件事：
 * 1. think 事件真的到了消息上，不是被丢掉
 * 2. 它**不进正文** —— 那是模型的草稿，混进 text 就等于把草稿当答案
 */

/** 这一轮假模型吐什么，由用例自己摆 */
let script: RunEvent[] = [];

vi.mock('@/api/desktop', async (orig) => ({
  ...(await orig<typeof import('@/api/desktop')>()),
  isDesktop: () => true,
  outlineDraft: vi.fn(async (_args: unknown, onEvent: (e: RunEvent) => void) => {
    for (const e of script) onEvent(e);
  }),
}));

const { useAgent } = await import('./agent');
const { useProject } = await import('./project');
const { useUi } = await import('./ui');
const { MOCK_PROJECTS } = await import('@/mock/project');
const { MOCK_CONFIG } = await import('@/mock/config');

/** 等这轮跑完 */
async function settle(): Promise<void> {
  for (let i = 0; i < 400 && useAgent.getState().runningId !== null; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

const lastAi = () => [...useAgent.getState().messages].reverse().find((m) => m.who === 'ai')!;

/** 一份最小的产物，不然这轮没有 proposal，跑不到 done */
const DRAFT: RunEvent = {
  t: 'proposal',
  draft: { reply: '补在第二幕。', acts: [{ t: '第一幕', span: '0:00–1:00', beats: [{ k: '', t: '开场' }] }] },
};

beforeEach(() => {
  const t = useProject.temporal.getState();
  t.pause();
  useProject.getState().hydrate({
    project: structuredClone(MOCK_PROJECTS['p1']!),
    config: structuredClone(MOCK_CONFIG),
  });
  t.clear();
  t.resume();
  useUi.setState({ step: 'outline' });
  useAgent.getState().reset();
});

describe('桌面端事件翻译：思考过程', () => {
  it('推理过程存在消息上，但一个字都不进正文', async () => {
    script = [
      { t: 'step', index: 1 },
      { t: 'think', text: '先看前后两场' },
      { t: 'think', text: '定了什么' },
      { t: 'delta', text: '补在第二幕。' },
      DRAFT,
      { t: 'done' },
    ];
    useAgent.getState().send('从一句灵感起草大纲', 'outline.draft');
    await settle();

    const m = lastAi();
    expect(m.think, '两块推理要接着拼，不是只留最后一块').toBe('先看前后两场定了什么');
    expect(m.text, '推理过程漏进正文了').toBe('补在第二幕。');
  });

  it('模型不吐推理时这个字段就不存在，界面靠它决定摆不摆', async () => {
    script = [
      { t: 'step', index: 1 },
      { t: 'delta', text: '直接答了。' },
      DRAFT,
      { t: 'done' },
    ];
    useAgent.getState().send('从一句灵感起草大纲', 'outline.draft');
    await settle();

    expect(lastAi().think).toBeUndefined();
    expect(lastAi().text).toBe('直接答了。');
  });
});
