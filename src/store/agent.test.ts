import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';
import { useProject } from './project';
import { useUi } from './ui';
import { useAgent } from './agent';

/**
 * 端到端跑一轮 Agent：发起 → 流式跑完 → 采纳 → 项目真的变了。
 * 这条链路是产品的主干，断了就等于 Agent 只是个聊天框。
 */

const hydrate = () => {
  const t = useProject.temporal.getState();
  t.pause();
  useProject.getState().hydrate({
    project: structuredClone(MOCK_PROJECTS['p1']!),
    config: structuredClone(MOCK_CONFIG),
  });
  t.clear();
  t.resume();
};

/** 等这轮流式跑完 */
async function settle(): Promise<void> {
  for (let i = 0; i < 400 && useAgent.getState().runningId !== null; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

const lastAi = () => [...useAgent.getState().messages].reverse().find((m) => m.who === 'ai')!;

beforeEach(() => {
  hydrate();
  useAgent.getState().reset();
  useUi.setState({ step: 'storyboard', nodeSel: 'b3' });
});

describe('store/agent', () => {
  it('跑完一轮会留下完整正文、走完所有步骤、挂一份待采纳产物', async () => {
    useAgent.getState().send('按大纲拆镜');
    await settle();
    const m = lastAi();
    expect(m.streaming).toBe(false);
    expect(m.text.length).toBeGreaterThan(20);
    expect(m.stepDone).toBe(m.steps!.length);
    expect(m.verdict).toBe('pending');
  });

  it('不采纳就不动项目', async () => {
    const before = useProject.getState().shots.length;
    useAgent.getState().send('按大纲拆镜');
    await settle();
    expect(useProject.getState().shots.length).toBe(before);
    useAgent.getState().discard(lastAi().id);
    expect(useProject.getState().shots.length).toBe(before);
    expect(lastAi().verdict).toBe('discarded');
  });

  it('采纳写进项目、扣积分，且是一条可撤销的记录', async () => {
    const shotsBefore = useProject.getState().shots.length;
    const creditsBefore = useProject.getState().credits;
    useAgent.getState().send('按大纲拆镜');
    await settle();
    const msg = lastAi();
    useAgent.getState().accept(msg.id);

    const after = useProject.getState();
    expect(after.shots.length).toBeGreaterThan(shotsBefore);
    expect(after.credits).toBe(creditsBefore - msg.proposal!.cost);
    expect(lastAi().verdict).toBe('accepted');

    useProject.temporal.getState().undo();
    expect(useProject.getState().shots.length).toBe(shotsBefore);
  });

  it('重复采纳同一份产物不会写两次', async () => {
    useAgent.getState().send('按大纲拆镜');
    await settle();
    const id = lastAi().id;
    useAgent.getState().accept(id);
    const n = useProject.getState().shots.length;
    useAgent.getState().accept(id);
    expect(useProject.getState().shots.length).toBe(n);
  });

  it('拆镜 → 补写提示词：前一步的产物是后一步的输入', async () => {
    useAgent.getState().send('按大纲拆镜');
    await settle();
    useAgent.getState().accept(lastAi().id);
    const fresh = useProject.getState().shots.filter((s) => !s.own);
    expect(fresh.length).toBeGreaterThan(0);

    useAgent.getState().send('补写提示词');
    await settle();
    useAgent.getState().accept(lastAi().id);
    expect(useProject.getState().shots.filter((s) => !s.own)).toHaveLength(0);
  });

  it('中断后不再继续输出', async () => {
    useAgent.getState().send('按大纲拆镜');
    await new Promise((r) => setTimeout(r, 60));
    useAgent.getState().stop();
    await new Promise((r) => setTimeout(r, 120));
    const at = lastAi().text;
    await new Promise((r) => setTimeout(r, 200));
    expect(lastAi().text).toBe(at);
    expect(useAgent.getState().runningId).toBeNull();
  });

  it('换环节开新会话，但「跳页并直接发起」的那轮要保住', async () => {
    useAgent.getState().send('算一下成本');
    await settle();
    expect(useAgent.getState().messages.length).toBe(2);

    useAgent.getState().syncStep('storyboard');   // 同一环节，不清
    expect(useAgent.getState().messages.length).toBe(2);

    useUi.setState({ step: 'assets' });
    useAgent.getState().send('从剧本提取角色', 'assets.extract'); // 先发起
    useAgent.getState().syncStep('assets');                      // 面板随后同步
    expect(useAgent.getState().messages.length).toBe(2);         // 这轮没被清掉
    useAgent.getState().stop();
  });
});
