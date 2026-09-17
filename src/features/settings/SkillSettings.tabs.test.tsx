// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SkillList } from './SkillSettings';
import { SKILLS } from '@/domain/agent/skills';
import { roster } from '@/domain/agent/roster';
import { useSettings } from '@/store/settings';

/**
 * Skill 管理列表页分两页，添加走弹窗。
 *
 * 之前是一页里五张卡竖着排：已安装、添加自己的 Skill、没识别的目录、
 * 没有负责人的功能、功能清单。找「这件事谁做」得先翻过导入表单。
 *
 * jsdom 不做布局，所以查的是结构：页签切换真的换了内容，添加按钮真的开弹窗。
 */
function render(): { host: HTMLElement; click: (el: Element) => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<SkillList onOpen={() => {}} />); });
  return {
    host,
    click: (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }),
  };
}

const tabs = (host: HTMLElement) => [...host.querySelectorAll('[role="tab"]')];
const tabNamed = (host: HTMLElement, t: string) =>
  tabs(host).find((b) => b.textContent?.includes(t))!;
const text = (host: HTMLElement) => host.textContent ?? '';

describe('Skill 管理：已安装与功能清单分页', () => {
  it('两个页签都在，默认停在「已安装」', () => {
    const { host } = render();
    expect(tabs(host).map((b) => b.textContent)).toHaveLength(2);
    expect(tabNamed(host, '已安装').getAttribute('aria-selected')).toBe('true');
    expect(tabNamed(host, '功能清单').getAttribute('aria-selected')).toBe('false');
    host.remove();
  });

  it('页签上带数量 —— 功能清单的数量不是写死的', () => {
    const { host } = render();
    expect(tabNamed(host, '功能清单').textContent).toContain(String(SKILLS.length));
    host.remove();
  });

  it('默认这一页看不到功能清单的表头，切过去才有', () => {
    const { host, click } = render();
    expect(text(host)).toContain('装了哪些');
    expect(text(host)).not.toContain('每个功能由谁负责');

    click(tabNamed(host, '功能清单'));
    expect(text(host)).toContain('每个功能由谁负责');
    expect(text(host)).not.toContain('装了哪些');
    // 切过去之后，导入相关的按钮不该还挂在那儿 —— 那一页没有文件可导
    expect(text(host)).not.toContain('添加 Skill');
    host.remove();
  });

  it('「没有负责人」的提示两页都看得见 —— 藏在一页后面就发现不了', () => {
    // 造一个真的没人负责的场景：把所有智能体身上的 outline.draft 摘掉
    const before = useSettings.getState().agents;
    act(() => {
      for (const p of roster()) {
        const cur = useSettings.getState().agents[p.id]!;
        useSettings.getState().patchAgent(p.id, {
          skills: cur.skills.filter((k) => k !== 'outline.draft'),
        });
      }
    });
    try {
      const { host, click } = render();
      expect(text(host)).toContain('个功能没有负责人');
      click(tabNamed(host, '功能清单'));
      expect(text(host), '切到另一页就看不见了').toContain('个功能没有负责人');
      host.remove();
    } finally {
      act(() => { useSettings.setState({ agents: before }); });
    }
  });

  it('添加 Skill 是弹窗，不是页面上的一张卡', () => {
    const { host, click } = render();
    expect(document.querySelector('.mo')).toBe(null);

    click([...host.querySelectorAll('button')].find((b) => b.textContent?.includes('添加 Skill'))!);
    const modal = document.querySelector('.mo__box')!;
    expect(modal).not.toBe(null);
    expect(modal.textContent).toContain('SKILL.md');
    expect(modal.textContent).toContain('要导入的目录');

    // 关掉之后不留在 DOM 里
    click(modal.querySelector('.mo__h .tbtn')!);
    expect(document.querySelector('.mo')).toBe(null);
    host.remove();
  });
});
