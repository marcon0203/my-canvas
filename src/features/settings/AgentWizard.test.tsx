// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentWizard, NewAgentModal } from './AgentWizard';
import { customPersonas, personaById } from '@/domain/agent/roster';
import { useSettings } from '@/store/settings';

/**
 * 配置向导。
 *
 * 原来是一屏四张卡摊开，问题是这些东西有依赖顺序（配哪些模型取决于给了
 * 哪些工具），人得来回跳。分步之后要盯两件事：**一次只显示一步**，
 * 以及**出本机的工具没有「总是允许」这个选项**。
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

const steps = (host: HTMLElement) => [...host.querySelectorAll('.wstep__t')].map((e) => e.textContent);
const stepBtn = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('.wstep__hit')].find((b) => b.textContent?.includes(name))!;
const text = (host: HTMLElement) => host.textContent ?? '';

/**
 * 往受控输入框里打字。
 *
 * 不能直接 `el.value = x` 再派发 input：React 会看到 value 没「变过」而忽略这次
 * 事件（它记着上一次的值）。要走原生 setter，绕过 React 装在实例上的那层。
 */
function type(el: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('编辑向导：一次只走一步', () => {
  beforeEach(() => { useSettings.getState().resetAgent('dp'); });

  it('五步都列出来，默认停在第一步', () => {
    const { host } = mount(<AgentWizard id="dp" />);
    expect(steps(host)).toEqual(['基本信息', '系统提示词', '任务与工具', '模型', '执行权限']);
    expect(host.querySelector('.wstep--on .wstep__t')?.textContent).toBe('基本信息');
    host.remove();
  });

  it('当前这一步之外的内容不在页面上 —— 那正是不摊开的意义', () => {
    const { host, click } = mount(<AgentWizard id="dp" />);
    // 查的是控件本身，不是文案里的词：步骤条上也写着步骤名，按文案查会假通过
    const has = (sel: string) => !!host.querySelector(sel);
    expect(text(host)).toContain('描述');
    expect(has('textarea'), '第一步不该出现提示词输入框').toBe(false);
    expect(has('.toolgrp'), '第一步不该出现工具').toBe(false);

    click(stepBtn(host, '系统提示词'));
    expect(has('textarea')).toBe(true);
    expect(has('.toolgrp')).toBe(false);

    click(stepBtn(host, '任务与工具'));
    expect(text(host)).toContain('负责的任务');
    expect(has('.toolgrp')).toBe(true);
    expect(has('textarea'), '切走之后提示词输入框要消失').toBe(false);
  });

  it('内置那位的名字改不了，也没有删除按钮', () => {
    const { host } = mount(<AgentWizard id="dp" />);
    expect(host.querySelector('input')).toBe(null);
    expect(text(host)).toContain('内置智能体不可删除');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('删掉这位')))
      .toBe(false);
    host.remove();
  });
});

describe('逐个工具的审批策略', () => {
  const ID = 'custom-trust';
  beforeEach(() => {
    for (const p of customPersonas()) useSettings.getState().removeAgent(p.id);
    const id = useSettings.getState().addAgent({
      name: '交付', tagline: '', icon: 'bolt', preamble: '', owns: [],
    });
    useSettings.getState().patchAgent(id, {
      autonomy: 'auto', autoMax: 'spend',
      tools: ['project.read', 'image.generate', 'file.export'],
    });
    void ID;
  });

  const open = () => {
    const id = customPersonas()[0]!.id;
    const m = mount(<AgentWizard id={id} />);
    m.click(stepBtn(m.host, '执行权限'));
    return { ...m, id };
  };

  it('只列这位手上有的工具，不是全部 27 个', () => {
    const { host } = open();
    const rows = [...host.querySelectorAll('.apol__row')];
    expect(rows.map((r) => r.querySelector('.apol__n')?.textContent))
      .toEqual(['读项目', '出图', '导出文件']);
    host.remove();
  });

  it('出本机的那个没有下拉框，只有一句「始终需要确认」', () => {
    const { host } = open();
    const rows = [...host.querySelectorAll('.apol__row')];
    const exportRow = rows.find((r) => r.textContent?.includes('导出文件'))!;
    expect(exportRow.querySelector('select'), '出本机的工具不该给出「总是允许」这个选项').toBe(null);
    expect(exportRow.textContent).toContain('始终需要确认');

    // 同一份表格里，花钱那档是可以改的 —— 说明「没有下拉框」不是整表都没有
    const imgRow = rows.find((r) => r.textContent?.includes('出图'))!;
    expect(imgRow.querySelector('select')).not.toBe(null);
    host.remove();
  });

  it('改一个工具的策略会落到配置里', () => {
    const { host, id } = open();
    const sel = [...host.querySelectorAll('.apol__row')]
      .find((r) => r.textContent?.includes('出图'))!
      .querySelector('select')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(sel, 'allow');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useSettings.getState().agents[id]!.toolPolicy?.['image.generate']).toBe('allow');
    host.remove();
  });

  it('先出方案时不显示这张表 —— 没有自主执行就没有「要不要问」这回事', () => {
    const id = customPersonas()[0]!.id;
    useSettings.getState().patchAgent(id, { autonomy: 'propose' });
    const { host, click } = mount(<AgentWizard id={id} />);
    click(stepBtn(host, '执行权限'));
    expect(host.querySelectorAll('.apol__row')).toHaveLength(0);
    expect(text(host)).toContain('执行方式');
    host.remove();
  });
});

describe('新建向导', () => {
  beforeEach(() => {
    for (const p of customPersonas()) useSettings.getState().removeAgent(p.id);
  });

  // 弹窗是直接渲染在 host 里的（没有 portal），所以在 host 里找就够了
  const btn = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll('.mo button')]
      .find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

  it('没填名字之前走不到下一步，也存不下来', () => {
    const { host } = mount(
      <NewAgentModal open onClose={() => {}} onCreated={() => {}} />,
    );
    expect(btn(host, '下一步').disabled).toBe(true);
    expect(btn(host, '保存').disabled).toBe(true);
    // 后面几步也点不动
    expect((stepBtn(host, '任务与工具') as HTMLButtonElement).disabled).toBe(true);
    host.remove();
  });

  it('填了名字就能存 —— 不必走完五步，剩下的以后配', () => {
    let created = '';
    const { host } = mount(
      <NewAgentModal open onClose={() => {}} onCreated={(id) => { created = id; }} />,
    );
    type(host.querySelector('.mo input') as HTMLInputElement, '广告片编剧');
    expect(btn(host, '保存').disabled).toBe(false);

    act(() => { btn(host, '保存').click(); });
    expect(created).toBeTruthy();
    expect(personaById(created).name).toBe('广告片编剧');
    // 没填的字段不替人编内容
    expect(personaById(created).tagline).toBe('');
    expect(personaById(created).preamble).toBe('');
    host.remove();
  });
});
