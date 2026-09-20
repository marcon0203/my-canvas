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

  it('浏览器里的产物一律标成示例：没有步骤卡、不扣分、正文里说清没调模型', async () => {
    const before = useProject.getState().credits;
    useAgent.getState().send('按大纲拆镜');
    await settle();
    const m = lastAi();
    expect(m.proposal!.demo).toBe(true);
    // 步骤卡是「正在干这几件事」的意思 —— 没干就不该有
    expect(m.steps).toEqual([]);
    expect(m.text).toContain('没有调模型');
    useAgent.getState().accept(m.id);
    expect(useProject.getState().credits).toBe(before);
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
    // 浏览器里这一份是模板，标了 demo 就不计费 —— 产物照样写进项目
    expect(after.credits).toBe(msg.proposal!.demo ? creditsBefore : creditsBefore - msg.proposal!.cost);
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

  /**
   * 换环节**不再清会话**，只换当班的那位。
   *
   * 原来是「换环节开新会话」，于是从大纲跳到剧本，刚才那几轮就没了 ——
   * 反馈原话是「对话历史记录也丢了」。会话按项目分，一个项目里几个环节是
   * 同一条流水线，本来就该连着看。
   */
  it('换环节只换当班的那位，消息接着往后加', async () => {
    // 用当班（摄影指导）自己能接的活儿，免得被转交搅进来 —— 转交另有用例覆盖
    useAgent.getState().send('补写提示词');
    await settle();
    expect(useAgent.getState().messages.length).toBe(2);

    useAgent.getState().syncStep('storyboard');   // 同一环节
    expect(useAgent.getState().messages.length).toBe(2);

    useUi.setState({ step: 'assets' });
    useAgent.getState().syncStep('assets');
    expect(useAgent.getState().messages.length, '换环节不该清掉刚才那轮').toBe(2);
    expect(useAgent.getState().agentId, '当班的要换成美术').toBe('art');

    useAgent.getState().send('从剧本提取角色', 'assets.extract');
    await settle();
    expect(useAgent.getState().messages.length, '接着往后加').toBe(4);
    useAgent.getState().stop();
  });
});

describe('store/agent · 转交', () => {
  it('问错人不会卡住：当班的说一句，转给对的那位，并跳到它的主场', async () => {
    useUi.setState({ step: 'outline' });          // 编剧当班
    useAgent.getState().reset();
    expect(useAgent.getState().agentId).toBe('writer');

    useAgent.getState().send('批量转视频');        // 这是摄影指导的活儿
    await settle();

    const msgs = useAgent.getState().messages;
    const handed = msgs.find((m) => m.handoff);
    expect(handed?.handoff).toMatchObject({ from: 'writer', to: 'dp', kind: 'video.batch' });
    expect(handed?.agentId).toBe('writer');       // 转交的话是编剧说的

    // 转交后：当班换人、界面跳到分镜、并且接手方真的接着跑了这一轮
    expect(useAgent.getState().agentId).toBe('dp');
    expect(useUi.getState().step).toBe('storyboard');
    const last = [...useAgent.getState().messages].reverse().find((m) => m.who === 'ai')!;
    expect(last.agentId).toBe('dp');
    // 出视频要在桌面端跑，测试环境里没有 Rust —— 接手方如实说做不了，
    // **而不是给一份假产物**。原来这儿断言的是 proposal 存在，靠的就是
    // 那份「扣 24 积分、什么都不生成」的假批量
    expect(last.text).toContain('桌面端');
  });

  it('转交不丢上下文：交接前后的消息都留在同一条会话里', async () => {
    useUi.setState({ step: 'outline' });
    useAgent.getState().reset();
    useAgent.getState().send('批量转视频');
    await settle();
    const msgs = useAgent.getState().messages;
    expect(msgs.filter((m) => m.who === 'ai').map((m) => m.agentId)).toEqual(['writer', 'dp']);
    // 同一个请求换人接，用户那句话只该冒一次泡
    expect(msgs.filter((m) => m.who === 'me')).toHaveLength(1);
  });

  it('当班的自己能接的活儿不转交', async () => {
    useUi.setState({ step: 'outline' });
    useAgent.getState().reset();
    useAgent.getState().send('延展这一场的剧情走向', 'outline.expand');
    await settle();
    expect(useAgent.getState().messages.some((m) => m.handoff)).toBe(false);
    expect(useAgent.getState().agentId).toBe('writer');
  });

  it('换环节自动换当班的 Agent', () => {
    useAgent.getState().syncStep('assets');
    expect(useAgent.getState().agentId).toBe('art');
    useAgent.getState().syncStep('editing');
    expect(useAgent.getState().agentId).toBe('editor');
  });
});
