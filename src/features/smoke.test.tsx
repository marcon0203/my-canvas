// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell, ProjectEntryRedirect, ProjectRoute } from '@/App';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';
import { useProject } from '@/store/project';
import { HomePage } from '@/features/home/HomePage';
import { OutlinePage } from '@/features/outline/OutlinePage';
import { ScriptPage } from '@/features/script/ScriptPage';
import { AssetsPage } from '@/features/assets/AssetsPage';
import { StoryboardPage } from '@/features/storyboard/StoryboardPage';
import { EditingPage } from '@/features/clips/EditingPage';
import { CanvasPage } from '@/features/canvas/CanvasPage';
import { MetricsPage } from '@/features/metrics/MetricsPage';

/**
 * 渲染烟雾测试：页面逐个真实挂载，断言关键内容出现、无异常抛出。
 * 只做 DOM 层断言（纯逻辑，无像素参与），不属于视觉验证。
 */

let root: Root | null = null;
let host: HTMLElement;

// store 空启动，测试前注入 mock（与应用 BootGate 同一动作）
{
  const temporal = useProject.temporal.getState();
  temporal.pause();
  useProject.getState().hydrate({
    project: structuredClone(MOCK_PROJECTS['p1']!),
    config: structuredClone(MOCK_CONFIG),
  });
  temporal.clear();
  temporal.resume();
}

function ensureHost(): void {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
  }
  if (!root) root = createRoot(host);
}

function renderPage(el: React.ReactElement): string {
  ensureHost();
  act(() => { root!.render(<MemoryRouter>{el}</MemoryRouter>); });
  const html = host.innerHTML;
  act(() => { root!.render(null); });   // 卸载，避免跨用例副作用
  return html;
}

/** 轮询直到出现目标内容（mock 接口有 150–500ms 延迟） */
async function waitFor(matcher: () => boolean): Promise<void> {
  for (let i = 0; i < 60 && !matcher(); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

describe('页面渲染烟雾测试', () => {
  it('HomePage：需求输入框 + 最近项目（来自工作空间）', async () => {
    ensureHost();
    let html = '';
    act(() => {
      root!.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><HomePage /></MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await waitFor(() => host.innerHTML.includes('The Dream of Cats'));
    html = host.innerHTML;
    act(() => { root!.render(null); });
    // 首页的入口是需求输入框，不再是那张 hero 卡
    expect(html).toContain('brief__in');
    expect(html).toContain('附件');
    expect(html).toContain('The Dream of Cats');
    expect(html).toContain('FMV Game');
  });

  it('OutlinePage：幕结构 + 场景节点 + 备选走向', () => {
    const html = renderPage(<OutlinePage />);
    expect(html).toContain('Plot outline');
    expect(html).toContain('不会离开的朋友');
    expect(html).toContain('场景3');
    expect(html).toContain('延展剧情走向');
  });

  it('ScriptPage：三个分区与一键分析', () => {
    const html = renderPage(<ScriptPage />);
    expect(html).toContain('角色小传');
    expect(html).toContain('故事梗概');
    expect(html).toContain('一键分析资产');
    expect(html).toContain('艾米 (Amy)');
  });

  it('AssetsPage：资产树 + 检查器 + 定稿闸口', () => {
    const html = renderPage(<AssetsPage />);
    expect(html).toContain('资产库');
    expect(html).toContain('已定稿');
    expect(html).toContain('CHAR-001');
    expect(html).toContain('形状照');
  });

  it('StoryboardPage：分镜树 + 提示词三段式 + RunBar', () => {
    const html = renderPage(<StoryboardPage />);
    expect(html).toContain('分镜列表');
    expect(html).toContain('s1-1');
    expect(html).toContain('命中率');
    expect(html).toContain('Seedance 2.0');
    expect(html).toContain('本镜内容');
  });

  it('EditingPage：时间线三轨 + 导出', () => {
    const html = renderPage(<EditingPage />);
    expect(html).toContain('当前片段');
    expect(html).toContain('排时间线');
    expect(html).toContain('导出分镜表');
    // 还没排过时间线：如实说，而不是画一条看起来已经排好的轨
    expect(html).toContain('还没排时间线');
    expect(html).toContain('还没有配音');
    // 生成字幕要先有时间线，按钮此时是禁用的，并说清为什么
    expect(html).toContain('先排时间线：字幕要挂在时间轴上');
    expect(html).toMatch(/disabled[\s\S]{0,400}?生成字幕/);
    // 转场/变速/配乐那三个占位按钮撤掉了：点了没反应比没有更糟
    expect(html).not.toContain('转场');
  });

  it('EditingPage：排过时间线之后画的是真数据，不是写死的占位', () => {
    const st = useProject.getState();
    st.applyAgentPatch({
      t: 'timeline',
      timeline: { clips: [{ shotId: 's1-1', at: 0, dur: 2000 }, { shotId: 's1-2', at: 2000, dur: 3500 }], beatMs: 500 },
    });
    st.applyAgentPatch({
      t: 'subtitles',
      subtitles: { lang: 'zh', cues: [{ at: 0, dur: 2000, text: '年糕，你怎么不吃东西' }] },
    });
    const html = renderPage(<EditingPage />);
    expect(html).toContain('已排 2 段');
    expect(html).toContain('5.5s');            // 2000 + 3500
    expect(html).toContain('卡点 500ms');
    expect(html).toContain('年糕，你怎么不吃东西');
    // 原来那三条写死的占位字幕不该再出现
    expect(html).not.toContain('小时候，我总觉得世界上有些东西永远不会改变');
    // 收拾干净，后面的用例还要用这份 store
    st.applyAgentPatch({ t: 'timeline', timeline: { clips: [] } });
    st.applyAgentPatch({ t: 'subtitles', subtitles: { lang: 'zh', cues: [] } });
  });

  it('CanvasPage：Idea/Story/Image/Video 节点同源渲染', () => {
    const html = renderPage(<CanvasPage />);
    expect(html).toContain('一个女孩发现，全世界都在遗忘她的猫');
    expect(html).toContain('与流水线同源');
    expect(html).toContain('CHAR-001 · SCENE-001');
  });

  it('MetricsPage：命中率环 + 双归因 + 环节进度', () => {
    const html = renderPage(<MetricsPage />);
    expect(html).toContain('生产记账');
    expect(html).toContain('按模型归因');
    expect(html).toContain('按景别归因');
    expect(html).toContain('单条可用成本');
  });
});

describe('路由直达（防白屏回归）', () => {
  /** 带路由与 QueryClient 的真实挂载：/project/:projectId/:step? 直达 */
  async function renderAt(path: string, waitUntil: () => boolean): Promise<string> {
    ensureHost();
    act(() => {
      root!.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/" element={<AppShell view="home" />} />
              <Route path="/project" element={<ProjectEntryRedirect />} />
              <Route path="/project/:projectId/:step?" element={<ProjectRoute />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await waitFor(waitUntil);
    const html = host.innerHTML;
    act(() => { root!.render(null); });
    return html;
  }

  it('/project/p1/outline 直达渲染出完整外壳', async () => {
    const html = await renderAt('/project/p1/outline', () => host.innerHTML.includes('Plot outline'));
    expect(html).toContain('Plot outline');
    expect(html).toContain('剧情结构');
    expect(html).toContain('剧情大纲');
    // 项目内一级图标栏是收起的，出口只有二级菜单顶部这一个
    expect(html).not.toContain('主导航');
    expect(html).toContain('返回工作台');
  });

  it('/project/p1/metrics 直达渲染数据页', async () => {
    const html = await renderAt('/project/p1/metrics', () => host.innerHTML.includes('生产记账'));
    expect(html).toContain('生产记账');
  });

  it('/project/outline 旧形式 → 重定向到默认项目', async () => {
    const html = await renderAt('/project/outline', () => host.innerHTML.includes('Plot outline'));
    expect(html).toContain('Plot outline');
  });

  /**
   * 「在哪个大区」只能由 URL 说。
   *
   * 这条守的是一个真出现过的 bug：从设置点一级栏的「工作台」，地址栏是 `/`
   * 而画面是项目详情。原因是 AppShell 读 ui store 里的 `route` 字段来决定画
   * 哪套外壳，而那条分支写的是「route === 'home' 才画首页，否则画项目」——
   * 从设置过来 route 是 'settings'，于是掉进了项目那一支。
   *
   * 所以这里**先进一次项目**（让 store 里留下项目 id 与步骤），再直达 `/`：
   * 不看 store 只看 URL 的话，必须是首页。
   */
  it('先进过项目，再直达 / → 还是首页（不被 store 里的残留带进项目）', async () => {
    await renderAt('/project/p1/storyboard', () => host.innerHTML.includes('分镜列表'));
    const html = await renderAt('/', () => host.innerHTML.includes('brief__in'));
    expect(html).toContain('主导航');          // 首页才有一级图标栏
    expect(html).not.toContain('返回工作台');   // 那是项目内的出口
    expect(html).toContain('brief__in');       // 首页的需求输入框
  });

  it('/project/p2 直达加载第二个项目（无 step 默认大纲页）', async () => {
    const html = await renderAt('/project/p2', () => host.innerHTML.includes('雨夜来客'));
    expect(html).toContain('雨夜来客');
    expect(html).toContain('深夜载客');
  });
});
