// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';
import { useProject } from './project';
import { useUi } from './ui';
import { useAgent } from './agent';

/**
 * 会话历史。
 *
 * 反馈原话：「对话历史记录也丢了」。三处都要成立：
 * 换环节不清、换项目各自一份、点「新会话」是收进历史而不是删掉。
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

async function settle(): Promise<void> {
  for (let i = 0; i < 400 && useAgent.getState().runningId !== null; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  localStorage.clear();
  hydrate();
  useUi.setState({ step: 'storyboard', nodeSel: 'b3' });
  useAgent.setState({ projectId: '' });
  useAgent.getState().reset();
});

describe('会话按项目分', () => {
  it('换项目：各自一条会话，互不串台', async () => {
    useAgent.getState().bindProject('p1');
    useAgent.getState().send('补写提示词');
    await settle();
    const n1 = useAgent.getState().messages.length;
    expect(n1).toBeGreaterThan(0);

    useAgent.getState().bindProject('p2');
    expect(useAgent.getState().messages, 'p2 是干净的').toEqual([]);

    useAgent.getState().bindProject('p1');
    expect(useAgent.getState().messages.length, '回到 p1 要还在').toBe(n1);
  });

  it('刷新页面也还在 —— 存的是本地，不是内存', async () => {
    useAgent.getState().bindProject('p1');
    useAgent.getState().send('补写提示词');
    await settle();
    const before = useAgent.getState().messages.length;

    // 模拟重开：store 归零，再 bind 回去
    useAgent.setState({ messages: [], projectId: '' });
    useAgent.getState().bindProject('p1');
    expect(useAgent.getState().messages.length).toBe(before);
  });

  it('没进项目时不存 —— 首页没有项目可归属', async () => {
    useAgent.setState({ projectId: '' });
    useAgent.getState().send('补写提示词');
    await settle();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('studio.chat'))).toEqual([]);
  });
});

describe('新会话 = 收进历史，不是删掉', () => {
  it('点一次就多一条存档，当前会话清空', async () => {
    useAgent.getState().bindProject('p1');
    useAgent.getState().send('补写提示词');
    await settle();

    useAgent.getState().reset();
    expect(useAgent.getState().messages).toEqual([]);
    expect(useAgent.getState().archived).toHaveLength(1);
    expect(useAgent.getState().archived[0]!.messages.length).toBeGreaterThan(0);
  });

  it('空会话点「新会话」不留空记录', () => {
    useAgent.getState().bindProject('p1');
    useAgent.getState().reset();
    useAgent.getState().reset();
    expect(useAgent.getState().archived).toEqual([]);
  });

  it('恢复一份存档：它变成当前会话，当前那条进历史', async () => {
    useAgent.getState().bindProject('p1');
    useAgent.getState().send('补写提示词');
    await settle();
    const first = useAgent.getState().messages.length;
    useAgent.getState().reset();          // 第一条进历史

    useAgent.getState().send('按大纲拆镜');
    await settle();
    const second = useAgent.getState().messages.length;

    const id = useAgent.getState().archived[0]!.id;
    useAgent.getState().restore(id);

    expect(useAgent.getState().messages.length, '恢复的是第一条').toBe(first);
    // 刚才那条没丢，它进了历史
    expect(useAgent.getState().archived.some((s) => s.messages.length === second)).toBe(true);
    // 恢复出来的那条不该同时还留在历史里
    expect(useAgent.getState().archived.some((s) => s.id === id)).toBe(false);
  });

  it('能删掉某一条存档', async () => {
    useAgent.getState().bindProject('p1');
    useAgent.getState().send('补写提示词');
    await settle();
    useAgent.getState().reset();
    const id = useAgent.getState().archived[0]!.id;
    useAgent.getState().dropArchived(id);
    expect(useAgent.getState().archived).toEqual([]);
  });
});
