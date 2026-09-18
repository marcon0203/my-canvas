// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { AgentPanel } from './AgentPanel';
import { useAgent } from '@/store/agent';
import { pipelineFor } from '@/domain/agent/pipeline';
import { useUi } from '@/store/ui';
import type { ToolRun } from '@/domain/agent/types';

/** 三种「没跑成」的卡都要真渲染出来，而且带着下一步 */
function renderWith(tool: ToolRun): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  // step 要和 ui store 一致：面板挂载时会 syncStep，换了环节就清会话（这是对的）
  useAgent.setState({
    messages: [{ id: 1, who: 'ai', agentId: 'editor', text: '', tool }],
    runningId: null,
    step: useUi.getState().step,
  });
  act(() => { root.render(<MemoryRouter><AgentPanel /></MemoryRouter>); });
  const html = host.innerHTML;
  act(() => { root.render(null); });
  host.remove();
  return html;
}

const base = { id: 'file.export' as const, name: '导出文件', args: {} };

/**
 * 渲染当前 store 状态下的面板。
 *
 * 各组自己 setState 之后调它 —— `step` 必须和 ui store 对齐，
 * 否则面板挂载时 syncStep 会认为换了环节，把注入的消息清掉（那是对的行为）。
 */
function render(): string {
  useAgent.setState({ step: useUi.getState().step, runningId: null });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<MemoryRouter><AgentPanel /></MemoryRouter>); });
  const html = host.innerHTML;
  act(() => { root.render(null); });
  host.remove();
  return html;
}

describe('工具卡', () => {
  it('要人确认：给按钮，并说明仅本次生效', () => {
    const html = renderWith({ ...base, state: 'approval', risk: 'egress', why: '会把东西送出这台机器' });
    expect(html).toContain('导出文件 需要你确认');
    expect(html).toContain('会把东西送出这台机器');
    expect(html).toContain('同意并执行');
    expect(html).toContain('仅本次生效');
  });

  it('缺配置：指到模型设置，而不是只说用不了', () => {
    const html = renderWith({ ...base, id: 'image.generate', name: '出图', state: 'setup', why: '要一个图片模型和它的密钥' });
    expect(html).toContain('出图 还缺配置');
    expect(html).toContain('要一个图片模型和它的密钥');
    expect(html).toContain('去模型设置');
  });

  it('跑不起来：把原因摆出来，不给采纳按钮', () => {
    const html = renderWith({ ...base, id: 'edit.timeline', name: '排时间线', state: 'failed', why: '还没有出好的视频片段' });
    expect(html).toContain('排时间线 执行失败');
    expect(html).toContain('还没有出好的视频片段');
    expect(html).not.toContain('采纳');
  });

  it('跑完了不画工具卡 —— 结果由产物卡或正文承担', () => {
    const html = renderWith({ ...base, state: 'done' });
    expect(html).not.toContain('导出文件');
  });
});

describe('计划进度条', () => {
  it('有剩余步骤时说清第几步 / 共几步、剩下哪几步', () => {
    useAgent.setState({
      queue: pipelineFor('短剧').slice(1),
      planTotal: 7,
      brief: '做一支洗发水宣传片',
      messages: [],
    });
    const html = render();
    expect(html).toContain('计划 · 第 1 / 7 步');
    expect(html).toContain('做一支洗发水宣传片');
    // 剩下的前几步摆出来，多的收成一句
    expect(html).toContain('为选中场次写正文');
    expect(html).toContain('还有 3 步');
    // 说清它不会自己往下冲
    expect(html).toContain('不会背着你往下跑');
  });

  it('没有计划时不显示 —— 单点一个技能不该冒出一条计划', () => {
    useAgent.setState({ queue: [], planTotal: 0, brief: '', messages: [] });
    expect(render()).not.toContain('计划 ·');
  });

  it('队列跑完时收起来，不留一条「第 7/7 步」的空壳', () => {
    useAgent.setState({ queue: [], planTotal: 7, brief: 'x', messages: [] });
    expect(render()).not.toContain('计划 ·');
  });
});

describe('产物卡：采纳之后会发生什么', () => {
  const proposal = {
    title: '新大纲 · 3 幕 6 场',
    rows: [{ k: '场景1', v: '建立日常' }],
    patch: { t: 'acts' as const, acts: [] },
    cost: 2,
    goto: 'outline',
  };

  it('有队列时按钮写「采纳并继续」，并说清下一步是什么', () => {
    useAgent.setState({
      queue: pipelineFor('短剧').slice(1),
      planTotal: 7,
      messages: [{ id: 9, who: 'ai', text: '', kind: 'outline.draft', proposal, verdict: 'pending' }],
    });
    const html = render();
    expect(html).toContain('采纳并继续');
    expect(html).toContain('采纳后接着做');
    expect(html).toContain('为选中场次写正文');
  });

  it('没有队列时就是「采纳」，不许诺一个不存在的下一步', () => {
    useAgent.setState({
      queue: [], planTotal: 0,
      messages: [{ id: 9, who: 'ai', text: '', kind: 'outline.draft', proposal, verdict: 'pending' }],
    });
    const html = render();
    expect(html).toContain('采纳');
    expect(html).not.toContain('采纳并继续');
    expect(html).not.toContain('采纳后接着做');
  });

  it('单点一个技能采纳完之后，给一个明确的下一步入口', () => {
    useAgent.setState({
      queue: [], planTotal: 0, kind: '短剧',
      messages: [{ id: 9, who: 'ai', text: '', kind: 'outline.draft', proposal, verdict: 'accepted' }],
    });
    const html = render();
    expect(html).toContain('接着做：为选中场次写正文');
  });

  it('旁支任务采纳完不给下一步 —— 润色之后没有「下一步」这回事', () => {
    useAgent.setState({
      queue: [], planTotal: 0, kind: '短剧',
      messages: [{ id: 9, who: 'ai', text: '', kind: 'script.polish', proposal, verdict: 'accepted' }],
    });
    expect(render()).not.toContain('接着做：');
  });
});
