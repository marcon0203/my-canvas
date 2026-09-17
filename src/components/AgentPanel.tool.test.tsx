// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { AgentPanel } from './AgentPanel';
import { useAgent } from '@/store/agent';
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

describe('工具卡', () => {
  it('要人点头：给按钮，并说明只放行这一次', () => {
    const html = renderWith({ ...base, state: 'approval', risk: 'egress', why: '会把东西送出这台机器' });
    expect(html).toContain('导出文件 要你点头');
    expect(html).toContain('会把东西送出这台机器');
    expect(html).toContain('同意并执行');
    expect(html).toContain('只放行这一次');
  });

  it('缺配置：指到模型设置，而不是只说用不了', () => {
    const html = renderWith({ ...base, id: 'image.generate', name: '出图', state: 'setup', why: '要一个图片模型和它的密钥' });
    expect(html).toContain('出图 还缺配置');
    expect(html).toContain('要一个图片模型和它的密钥');
    expect(html).toContain('去模型设置');
  });

  it('跑不起来：把原因摆出来，不给采纳按钮', () => {
    const html = renderWith({ ...base, id: 'edit.timeline', name: '排时间线', state: 'failed', why: '还没有出好的视频片段' });
    expect(html).toContain('排时间线 没跑起来');
    expect(html).toContain('还没有出好的视频片段');
    expect(html).not.toContain('采纳');
  });

  it('跑完了不画工具卡 —— 结果由产物卡或正文承担', () => {
    const html = renderWith({ ...base, state: 'done' });
    expect(html).not.toContain('导出文件');
  });
});
