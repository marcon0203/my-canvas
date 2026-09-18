// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SkillList } from './SkillSettings';

/**
 * Skill 管理只讲文件。
 *
 * 「哪件任务由谁负责」搬去了智能体管理的「任务分工」，所以这一页不该再有
 * 页签、不该再出现负责人下拉 —— 进这一页的人是来管文件的。
 */
function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<SkillList onOpen={() => {}} />); });
  return {
    host,
    click: (el: Element) => act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }),
  };
}

const text = (host: HTMLElement) => host.textContent ?? '';

/** 等 skillsList 那个 Promise 落地 —— 加载目录那张卡要有数据才渲染 */
const flush = () => act(async () => { await Promise.resolve(); });

describe('Skill 管理：只讲文件', () => {
  it('没有页签了 —— 这一页只有一件事', () => {
    const { host } = mount();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    host.remove();
  });

  it('不出现任务分工那套东西：负责人、结果写入、实现方式', () => {
    const { host } = mount();
    expect(host.querySelectorAll('.skrow__own select'), '负责人下拉不该在这儿').toHaveLength(0);
    for (const gone of ['结果写入', '实现方式', '负责人', '任务分工']) {
      expect(text(host), gone).not.toContain(gone);
    }
    host.remove();
  });

  it('该有的还在：已安装计数、加载目录、添加按钮', async () => {
    const { host } = mount();
    await flush();
    expect(text(host)).toContain('已安装');
    expect(text(host)).toContain('加载目录');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('添加 Skill')))
      .toBe(true);
    host.remove();
  });

  it('添加 Skill 仍然是弹窗', () => {
    const { host, click } = mount();
    expect(host.querySelector('.mo')).toBe(null);
    click([...host.querySelectorAll('button')].find((b) => b.textContent?.includes('添加 Skill'))!);
    const modal = host.querySelector('.mo__box')!;
    expect(modal).not.toBe(null);
    expect(modal.textContent).toContain('SKILL.md');
    click(modal.querySelector('.mo__h .tbtn')!);
    expect(host.querySelector('.mo')).toBe(null);
    host.remove();
  });
});
