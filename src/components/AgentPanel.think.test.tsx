// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { AgentPanel } from './AgentPanel';
import { useAgent } from '@/store/agent';
import { useUi } from '@/store/ui';
import type { AgentMessage } from '@/domain/agent/types';

/**
 * 思考模型开口之前那段推理，界面上要看得见。
 *
 * 为什么要有这一块：reply 已经是真流式了，但思考模型会先想很久 ——
 * 那段时间产物 JSON 里一个字都没有，界面还是空白，「没有流式输出」这个观感
 * 只解掉一半。但它也不能当正文，那是模型的草稿不是它的回答。
 */
function render(msg: AgentMessage): string {
  // step 要和 ui store 对齐，否则面板挂载时 syncStep 会换掉当班的那位
  useAgent.setState({ messages: [msg], runningId: null, step: useUi.getState().step });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<MemoryRouter><AgentPanel /></MemoryRouter>); });
  const html = host.innerHTML;
  act(() => { root.render(null); });
  host.remove();
  return html;
}

const ai = (over: Partial<AgentMessage>): AgentMessage =>
  ({ id: 1, who: 'ai', agentId: 'writer', text: '', ...over }) as AgentMessage;

describe('思考过程', () => {
  it('还没出正文时摊开着 —— 那段等待期不能是空白', () => {
    const html = render(ai({ think: '先看前后两场定了什么', streaming: true }));
    expect(html).toContain('先看前后两场定了什么');
    expect(html).toContain('思考过程');
    // 等待期正是它该被看见的时候，折起来等于没摆
    expect(html).toMatch(/<details[^>]*\sopen/);
  });

  it('正文一开口就折起来 —— 草稿不该把要读的那段挤下去', () => {
    const html = render(ai({ think: '先看前后两场定了什么', text: '补在第二幕。' }));
    expect(html).toContain('补在第二幕。');
    expect(html).toContain('思考过程');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('标题上如实写多少字，不用猜要不要展开', () => {
    const html = render(ai({ think: '一二三四五' }));
    expect(html).toContain('5 字');
  });

  it('没有推理过程的模型不摆这一块，也不留个空壳', () => {
    const html = render(ai({ text: '直接答了。' }));
    expect(html).not.toContain('思考过程');
    expect(html).not.toContain('athink');
  });
});
