// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { pipelineFor, nextAfter } from '@/domain/agent/pipeline';
import { useAgent } from './agent';

/**
 * 流水线的可见性。
 *
 * 队列一直在 store 里，但界面上一个字都没说 —— 用户看到的是一次孤立的结果，
 * 不知道自己在一条七步的路上，也不知道点采纳之后会接着跑。反馈原话是
 * 「这个流程说实话不会用，生成大纲自己就停了」。
 *
 * 所以要盯的是「界面说得出第几步 / 共几步」这件事本身：
 * `planTotal` 不能用 `queue.length` 反推，队列弹空之后就说不出来了。
 */
describe('流水线：第几步 / 共几步', () => {
  beforeEach(() => { useAgent.getState().reset(); });

  it('开跑时记下总步数，队列是「剩下的」', () => {
    const total = pipelineFor('短剧').length;
    useAgent.setState({ queue: pipelineFor('短剧').slice(1), planTotal: total, kind: '短剧' });

    const s = useAgent.getState();
    expect(s.planTotal).toBe(total);
    expect(s.queue).toHaveLength(total - 1);
    // 界面按这两个数算「第 N / M 步」
    expect(s.planTotal - s.queue.length).toBe(1);
  });

  it('跑到最后一步时队列空了，但总步数还在 —— 否则说不出「第 7/7 步」', () => {
    useAgent.setState({ queue: [], planTotal: 7 });
    expect(useAgent.getState().planTotal).toBe(7);
  });

  it('停止只清剩下的步骤，不动已经采纳的产物', () => {
    useAgent.setState({
      queue: pipelineFor('短剧').slice(1),
      planTotal: 7,
      messages: [{ id: 1, who: 'ai', text: 'x', verdict: 'accepted' }],
    });
    useAgent.getState().stopPlan();

    expect(useAgent.getState().queue).toEqual([]);
    expect(useAgent.getState().messages).toHaveLength(1);
    expect(useAgent.getState().messages[0]!.verdict).toBe('accepted');
  });

  it('MV 跳过写正文，总步数跟着少一步 —— 不是写死 7', () => {
    expect(pipelineFor('MV').length).toBe(pipelineFor('短剧').length - 1);
    expect(pipelineFor('MV').some((s) => s.kind === 'script.draft')).toBe(false);
  });
});

describe('单点一个技能之后接着做什么', () => {
  it('主干上的任务给出下一步', () => {
    expect(nextAfter('短剧', 'outline.draft')?.kind).toBe('script.draft');
    expect(nextAfter('短剧', 'shots.generate')?.kind).toBe('shots.prompt');
  });

  it('MV 里大纲的下一步跳过正文，直接是提取资产', () => {
    expect(nextAfter('MV', 'outline.draft')?.kind).toBe('assets.extract');
  });

  it('主干最后一步没有下一步', () => {
    const line = pipelineFor('短剧');
    expect(nextAfter('短剧', line[line.length - 1]!.kind)).toBeUndefined();
  });

  it('旁支任务不假装有下一步', () => {
    // 润色、延展走向、换画风、成本报告都是随时可做的，不在主干顺序里
    for (const k of ['script.polish', 'outline.expand', 'style.transfer', 'cost.report']) {
      expect(nextAfter('短剧', k), k).toBeUndefined();
    }
  });
});
