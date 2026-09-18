// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SettingsRoute } from './App';

/**
 * 设置页的详情段校验。
 *
 * 这一层挡的是「URL 里乱填的名字」，但它挡错过两次真东西：
 * 1. 任务分工搬到智能体分区之后，任务 id（带点）不在 isAgentId 里，
 *    点一行地址栏变了、页面还是列表
 * 2. Skill 段拿构建期嵌进来的清单查存不存在，于是桌面端用户**自己导入**的
 *    skill 点进去就被弹回列表
 *
 * 所以这组测试从 URL 进，查渲染出来的是详情还是列表。
 */
function at(path: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/:section?/:detail?" element={<SettingsRoute />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return host;
}

/** 列表页有「添加 Skill」按钮，详情页没有 —— 拿它分辨比查页签靠得住
    （Skill 管理已经没有页签了，查页签在那一页永远成立，等于没查） */
const isSkillList = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].some((b) => b.textContent?.includes('添加 Skill'));
const isAgentList = (host: HTMLElement) => host.querySelectorAll('[role="tab"]').length > 0;
const flush = () => act(async () => { await Promise.resolve(); });

describe('设置路由：详情段', () => {
  it('智能体 id 进配置向导', () => {
    const host = at('/settings/agents/dp');
    expect(host.textContent).toContain('摄影指导');
    expect(isAgentList(host), '不该退回列表').toBe(false);
    host.remove();
  });

  it('任务 id（带点）进任务详情 —— 它也挂在智能体分区下面', () => {
    const host = at('/settings/agents/outline.draft');
    expect(host.textContent).toContain('触发条件');
    expect(isAgentList(host), '不该退回列表').toBe(false);
    host.remove();
  });

  it('乱填的段回列表，不白屏', () => {
    for (const bad of ['/settings/agents/不存在', '/settings/models/不存在']) {
      const host = at(bad);
      expect(host.textContent?.length, bad).toBeGreaterThan(0);
      host.remove();
    }
  });

  it('Skill 段不在路由层查存不存在 —— 进详情，查不到由详情页说', async () => {
    const host = at('/settings/skills/我自己导入的');
    expect(isSkillList(host), '不该被弹回列表').toBe(false);
    await flush();
    // 详情页如实说找不到，而不是一直停在「读取中…」
    expect(host.textContent).toContain('没有叫「我自己导入的」的 Skill');
    host.remove();
  });

  it('真装着的 Skill 点进去看到正文', async () => {
    const host = at('/settings/skills/draft-outline');
    await flush();
    expect(host.textContent).toContain('适用场景');
    expect(host.textContent).not.toContain('没有叫');
    host.remove();
  });
});
