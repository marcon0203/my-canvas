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
  it('HomePage：主通道 + 最近项目（来自项目列表接口）', async () => {
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
    expect(html).toContain('Start a story');
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
    expect(html).toContain('自动成片');
    expect(html).toContain('导出 MP4');
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
              <Route path="/" element={<AppShell />} />
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
    expect(html).toContain('主导航');
    expect(html).toContain('剧情大纲');
  });

  it('/project/p1/metrics 直达渲染数据页', async () => {
    const html = await renderAt('/project/p1/metrics', () => host.innerHTML.includes('生产记账'));
    expect(html).toContain('生产记账');
  });

  it('/project/outline 旧形式 → 重定向到默认项目', async () => {
    const html = await renderAt('/project/outline', () => host.innerHTML.includes('Plot outline'));
    expect(html).toContain('Plot outline');
  });

  it('/project/p2 直达加载第二个项目（无 step 默认大纲页）', async () => {
    const html = await renderAt('/project/p2', () => host.innerHTML.includes('雨夜来客'));
    expect(html).toContain('雨夜来客');
    expect(html).toContain('深夜载客');
  });
});
