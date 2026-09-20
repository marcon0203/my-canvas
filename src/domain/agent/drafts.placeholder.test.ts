import { describe, expect, it } from 'vitest';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';
import type { AgentContext } from './context';
import { defaultConfigs } from './config';
import { draftScriptBlock, extractCandidates, isPlaceholder, isRealScript } from './drafts';

/**
 * 自己产出的占位符不许喂给自己的下一步。
 *
 * 走查实录：本地剧本模板写了一行 `待定场景 · 待定时间`，下一步的资产提取
 * 按 `·` 切行、把两半都立成场景资产 —— 于是资产库里多了两个叫
 * 「待定场景」「待定时间」的场景。这是这条流水线上最没必要的一种脏数据。
 */
const ctx = (over: Partial<AgentContext> = {}): AgentContext => {
  const p = MOCK_PROJECTS['p1']!;
  return {
    proj: p.proj, projectId: 'p1', style: p.style, stylePrompt: p.stylePrompt, styles: p.styles,
    ratio: p.ratio, credits: p.credits, budget: p.budget,
    acts: p.acts, blocks: p.blocks, assets: p.assets, shots: p.shots,
    sel: { step: 'script', beatId: '', assetId: '', shotId: '', blockId: null },
    input: '', agentId: 'writer', agents: defaultConfigs(),
    globalModels: {}, ...MOCK_CONFIG && {}, ...over,
  } as AgentContext;
};

describe('占位符', () => {
  it('认得各种写法，只看名字', () => {
    for (const n of ['待定场景', '待定时间', '待补', 'TBD', 'todo', '未命名', '', '  ', '时间待定']) {
      expect(isPlaceholder(n), n).toBe(true);
    }
    for (const n of ['旧公寓客厅', '老陈', '怀表']) expect(isPlaceholder(n), n).toBe(false);
  });

  it('没有场景资产时，本地剧本模板不编一个「待定场景」出来', () => {
    const c = ctx({ assets: { 角色: [], 场景: [], 道具: [] } });
    const beat = c.acts[0]!.beats[0]!;
    const body = draftScriptBlock(c, beat, c.acts[0]).body;
    expect(body).not.toContain('待定场景');
    expect(body).not.toContain('待定时间');
  });

  it('那一行真的是脏数据的源头：喂回提取会立出两个资产', () => {
    // 复现老行为，证明这条链是通的（所以模板不能再产出它）
    const dirty = ['**场景1**', '待定场景 · 待定时间', '建立日常。'].join('\n');
    const cands = extractCandidates(ctx({
      blocks: [{ id: 'b1', type: 'text', label: '正文 · 场景1', body: dirty }] as never,
    }));
    expect(cands.map((x) => x.name), '占位词现在被挡住了').not.toContain('待定场景');
    expect(cands.map((x) => x.name)).not.toContain('待定时间');
  });

  it('真场景名照常提取 —— 别把有用的一起挡掉', () => {
    const clean = ['**场景1**', '旧公寓客厅 · 深夜', '老陈：这表停了。'].join('\n');
    const names = extractCandidates(ctx({
      blocks: [{ id: 'b1', type: 'text', label: '正文 · 场景1', body: clean }] as never,
    })).map((x) => x.name);
    expect(names).toContain('旧公寓客厅');
    expect(names).toContain('老陈');
  });

  it('只有占位符的正文不算写过 —— 资产提取的前置条件不该被它满足', () => {
    expect(isRealScript('**场景1**\n待定场景 · 待定时间')).toBe(false);
    expect(isRealScript('   \n# \n')).toBe(false);
    expect(isRealScript('**场景1**\n旧公寓客厅 · 深夜\n他推开门。')).toBe(true);
  });
});

describe('提取出来的资产不带占位描述', () => {
  it('desc 留空 —— 那句「待补描述」会被编进出图提示词', async () => {
    const { candidateToAsset } = await import('./drafts');
    const { compileShot, segmentsText } = await import('@/domain/prompt/compile');
    const a = candidateToAsset({ group: '场景', name: '旧公寓客厅', from: '场景1' } as never, []);
    expect(a.desc).toBe('');

    // 走查实录：每一镜的提示词都长成
    // 「full shot, 自剧本场景1提取, 待补描述, …」—— 拿元数据去指导画面
    const txt = segmentsText(compileShot(
      { refs: [a.aid], own: '老人低头看表' },
      { globalStylePrompt: 'watercolor', assetDescOf: (aid) => (aid === a.aid ? a.desc : undefined) },
    ));
    expect(txt).not.toContain('待补描述');
    expect(txt).not.toContain('自剧本');
    expect(txt).toBe('watercolor, 老人低头看表');
  });
});
