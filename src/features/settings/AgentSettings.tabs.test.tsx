// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { AgentList } from './AgentSettings';
import { SettingsPage } from './SettingsPage';
import { TASKS } from '@/domain/agent/tasks';
import { BUILTIN_PERSONAS, roster } from '@/domain/agent/roster';
import { useSettings } from '@/store/settings';

/**
 * 智能体管理分两页：按人看能力，按任务看分工。
 *
 * 「任务分工」原来挂在 Skill 管理下面叫「功能清单」—— 那张表四列里有三列讲的
 * 是智能体的分工，进 Skill 管理的人是来管文件的。这组测试钉住搬过来之后的位置：
 * 两个页签都在、任务表在第二页、没有负责人的提示两页都看得见、
 * 任务详情走 /settings/agents/<带点的 id>。
 */
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    click: (el: Element) => act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }),
  };
}

const tabs = (host: HTMLElement) => [...host.querySelectorAll('[role="tab"]')];
const tabNamed = (host: HTMLElement, t: string) =>
  tabs(host).find((b) => b.textContent?.includes(t))!;
const text = (host: HTMLElement) => host.textContent ?? '';

describe('智能体管理：两个页签', () => {
  it('两页都在，默认停在「智能体」，数量不是写死的', () => {
    const { host } = mount(<AgentList onOpen={() => {}} />);
    expect(tabs(host)).toHaveLength(2);
    expect(tabNamed(host, '智能体').getAttribute('aria-selected')).toBe('true');
    expect(tabNamed(host, '智能体').textContent).toContain(String(roster().length));
    expect(tabNamed(host, '任务分工').textContent).toContain(String(TASKS.length));
    host.remove();
  });

  it('卡片墙在第一页，任务表在第二页，一次只显示一个', () => {
    const { host, click } = mount(<AgentList onOpen={() => {}} />);
    expect(host.querySelectorAll('.atile').length).toBe(roster().length);
    expect(host.querySelector('.sktable'), '第一页不该有任务表').toBe(null);
    expect(text(host)).not.toContain('结果写入');

    click(tabNamed(host, '任务分工'));
    expect(host.querySelector('.sktable'), '切过去要有任务表').not.toBe(null);
    expect(text(host)).toContain('结果写入');
    expect(host.querySelectorAll('.atile').length, '切走之后卡片墙要消失').toBe(0);
    // 新建按钮只在卡片那一页 —— 任务分工页上没有可新建的东西
    expect(text(host)).not.toContain('新建智能体');
    host.remove();
  });

  it('任务表列出 12 行，每行一个负责人下拉', () => {
    const { host, click } = mount(<AgentList onOpen={() => {}} />);
    click(tabNamed(host, '任务分工'));
    expect(host.querySelectorAll('.skrow').length).toBe(TASKS.length);
    expect(host.querySelectorAll('.skrow__own select').length).toBe(TASKS.length);
    host.remove();
  });

  it('点任务行给出的是任务 id —— 详情页靠它找这件任务', () => {
    const opened: string[] = [];
    const { host, click } = mount(<AgentList onOpen={(id) => opened.push(id)} />);
    click(tabNamed(host, '任务分工'));
    click(host.querySelector('.skrow__main')!);
    expect(opened).toEqual([TASKS[0]!.id]);
    // 任务 id 带点，智能体 id 不带 —— 路由就是靠这个分辨的
    expect(opened[0]).toContain('.');
    for (const p of BUILTIN_PERSONAS) expect(p.id).not.toContain('.');
    host.remove();
  });

  it('「没有负责人」的提示两页都看得见 —— 藏在一页后面就发现不了', () => {
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
      const { host, click } = mount(<AgentList onOpen={() => {}} />);
      expect(text(host)).toContain('个任务没有负责人');
      click(tabNamed(host, '任务分工'));
      expect(text(host), '切到另一页就看不见了').toContain('个任务没有负责人');
      host.remove();
    } finally {
      act(() => { useSettings.setState({ agents: before }); });
    }
  });
});

describe('智能体管理：详情段分两种', () => {
  const render = (detail?: string) => mount(
    <MemoryRouter>
      <SettingsPage section="agents" detail={detail} onOpen={() => {}} onBack={() => {}} />
    </MemoryRouter>,
  );

  beforeEach(() => { useSettings.getState().resetAgent('dp'); });

  it('不带点的段是智能体 → 配置向导', () => {
    const { host } = render('dp');
    expect(text(host)).toContain('摄影指导');
    expect(host.querySelectorAll('.wstep').length, '智能体详情是五步向导').toBe(5);
    host.remove();
  });

  it('带点的段是任务 → 任务详情，不会被当成一个叫 outline.draft 的智能体', () => {
    const { host } = render('outline.draft');
    expect(text(host)).toContain('从一句灵感起草大纲');
    expect(text(host)).toContain('触发条件');
    expect(host.querySelectorAll('.wstep').length, '任务详情不是向导').toBe(0);
    host.remove();
  });

  it('两种都不是时回到列表，不白屏', () => {
    const { host } = render(undefined);
    expect(host.querySelectorAll('[role="tab"]').length).toBe(2);
    host.remove();
  });
});
