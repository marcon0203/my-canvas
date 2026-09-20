import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';
import { useProject } from './project';
import { useUi } from './ui';
import { useAgent } from './agent';
import { plan } from '@/domain/agent/plans';
import { defaultConfigs } from '@/domain/agent/config';
import type { AgentContext } from '@/domain/agent/context';
import type { Proposal } from '@/domain/agent/types';

/**
 * 走查里那个必踩的竞态。
 *
 * 原来「批量转视频」采纳后执行的是 `batchVidStart()` 就立刻返回，
 * 1500ms 后一个 setTimeout 才把镜头置成出片；而采纳同时会推进队列，
 * 下一步「自动成片」取的是已出片的镜头 —— 必然为空。
 * 实测：第 6 步刚采纳「批量转视频 · 18 镜」，第 7 步就回
 * 「还没有可用的视频片段。先批量转视频，再逐镜判定。」
 *
 * 现在生成跑在产物**之前**，采纳拿到的是一份已落盘的文件清单，
 * 写库是同步的。这两条测试守住这件事。
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

const ctxOf = (): AgentContext => {
  const p = useProject.getState();
  return {
    proj: p.proj, projectId: 'p1', style: p.style, stylePrompt: p.stylePrompt, styles: p.styles,
    ratio: p.ratio, credits: p.credits, budget: p.budget,
    acts: p.acts, blocks: p.blocks, assets: p.assets, shots: p.shots,
    sel: { step: 'storyboard', beatId: '', assetId: '', shotId: '', blockId: null },
    input: '', agentId: 'dp', agents: defaultConfigs(), globalModels: {},
  };
};

beforeEach(() => {
  hydrate();
  useAgent.getState().reset();
  useUi.setState({ step: 'storyboard' });
});

describe('采纳不再抢跑', () => {
  it('采纳出片清单之后，紧接着算自动成片就能看到这些片段 —— 不用等任何定时器', () => {
    // 先把所有镜头退回「没出片」，还原走查时那一刻的状态
    useProject.setState((s) => ({
      shots: s.shots.map((sh) => ({ ...sh, vid: 'none' as const, verdict: null, file: undefined })),
    }));
    expect(plan('edit.autocut', ctxOf()).blocked).toBeTruthy();

    const ids = useProject.getState().shots.slice(0, 3).map((s) => s.id);
    const proposal: Proposal = {
      title: '批量转视频 · 3 镜',
      rows: [],
      patch: { t: 'shotFiles', edits: ids.map((id) => ({ id, file: `media/video-${id}-1.mp4` })) },
      cost: 12,
      goto: 'storyboard',
    };

    // 手动摆一条待采纳的消息，然后采纳 —— 不经过流式，正是为了证明
    // 「采纳完立刻看」这一瞬间数据就在了
    useAgent.setState({
      messages: [{ id: 1, who: 'ai', text: '', proposal, verdict: 'pending' }],
    });
    useAgent.getState().accept(1);

    // 没有 await、没有 advanceTimers
    const after = ctxOf();
    expect(after.shots.filter((s) => s.file).length).toBe(3);
    const cut = plan('edit.autocut', after);
    expect(cut.blocked).toBeFalsy();
    expect(cut.proposal!.patch.t).toBe('timeline');
    const patch = cut.proposal!.patch;
    if (patch.t !== 'timeline') throw new Error('自动成片的产物应当是一条时间线');
    expect(patch.timeline.clips).toHaveLength(3);
  });

  it('失败的镜头也写回项目：takes 加了，失败原因留着，状态回到待转', () => {
    useProject.setState((s) => ({
      shots: s.shots.map((sh) => ({ ...sh, vid: 'none' as const, verdict: null, takes: 0, file: undefined })),
    }));
    const [ok, bad] = useProject.getState().shots.map((s) => s.id);
    const proposal: Proposal = {
      title: '批量转视频 · 成 1 镜 / 失败 1 镜',
      rows: [],
      patch: {
        t: 'shotFiles',
        edits: [{ id: ok!, file: 'media/video-a-1.mp4' }],
        fails: [{ id: bad!, why: '厂商回了 429' }],
      },
      // 只对真拿到文件的那一镜计费
      cost: 4,
      goto: 'storyboard',
    };
    const before = useProject.getState().credits;
    useAgent.setState({ messages: [{ id: 2, who: 'ai', text: '', proposal, verdict: 'pending' }] });
    useAgent.getState().accept(2);

    const shots = useProject.getState().shots;
    const good = shots.find((s) => s.id === ok)!;
    const flop = shots.find((s) => s.id === bad)!;
    expect(good.file).toBe('media/video-a-1.mp4');
    expect(good.vid).toBe('ok');
    expect(good.verdict).toBeNull();          // 出片 ≠ 可用，判定归人
    expect(good.takes).toBe(1);
    expect(flop.file).toBeUndefined();
    expect(flop.vid).toBe('none');            // 回到待转，重试认得它
    expect(flop.takes).toBe(1);               // 发出去过，钱花了
    expect(flop.fail).toEqual({ n: 1, why: '厂商回了 429' });
    expect(useProject.getState().credits).toBe(before - 4);
  });

  it('示例产物不扣分', () => {
    const before = useProject.getState().credits;
    const proposal: Proposal = {
      title: '示例大纲', rows: [], patch: { t: 'acts', acts: [] }, cost: 2, demo: true,
    };
    useAgent.setState({ messages: [{ id: 3, who: 'ai', text: '', proposal, verdict: 'pending' }] });
    useAgent.getState().accept(3);
    expect(useProject.getState().credits).toBe(before);
  });
});
