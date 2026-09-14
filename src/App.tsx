import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Navigate, useParams, useNavigate } from 'react-router';
import { Toaster } from '@/ui/Toast';
import { Skeleton } from '@/ui/Skeleton';
import { Button } from '@/ui';
import { useProjectData, useProjectList } from '@/api/queries';
import { useProject } from '@/store/project';
import { TopBar } from '@/components/TopBar';
import { AgentPanel } from '@/components/AgentPanel';
import { useUi, type Step } from '@/store/ui';
import { HomePage } from '@/features/home/HomePage';
import { OutlinePage } from '@/features/outline/OutlinePage';
import { ScriptPage } from '@/features/script/ScriptPage';
import { AssetsPage } from '@/features/assets/AssetsPage';
import { StoryboardPage } from '@/features/storyboard/StoryboardPage';
import { EditingPage } from '@/features/clips/EditingPage';
import { CanvasPage } from '@/features/canvas/CanvasPage';
import { MetricsPage } from '@/features/metrics/MetricsPage';
import { TokenGallery } from './routes/TokenGallery';

const queryClient = new QueryClient();

const STEPS: Step[] = ['outline', 'script', 'assets', 'storyboard', 'editing', 'overview', 'metrics'];

const PAGES: Record<Step, () => React.JSX.Element> = {
  outline: OutlinePage,
  script: ScriptPage,
  assets: AssetsPage,
  storyboard: StoryboardPage,
  editing: EditingPage,
  overview: CanvasPage,
  metrics: MetricsPage,
};

const router = createBrowserRouter([
  { path: '/tokens', element: <TokenGallery /> },
  { path: '/project', element: <ProjectEntryRedirect /> },
  { path: '/project/:projectId/:step?', element: <ProjectRoute /> },
  { path: '/', element: <AppShell /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

/** 应用外壳：与原型同构（.app > header.top + .work + aside.agent）。home 与项目两种形态 */
export function AppShell() {
  const route = useUi((s) => s.route);
  const projectId = useUi((s) => s.projectId);
  const step = useUi((s) => s.step);
  const hydratedFor = useProject((s) => s.hydratedFor);
  const q = useProjectData(route === 'project' ? projectId : '');

  // 项目内容注入 store：不入撤销历史（pause → hydrate → clear → resume）
  useEffect(() => {
    if (!q.data || useProject.getState().hydratedFor === q.data.project.id) return;
    const temporal = useProject.temporal.getState();
    temporal.pause();
    useProject.getState().hydrate(q.data);
    temporal.clear();
    temporal.resume();
  }, [q.data]);

  // 项目态必须等当前项目内容就位；首页不需要项目内容
  const booting = route === 'project' && (hydratedFor !== projectId || q.isFetching);
  if (booting) {
    return (
      <div className="app">
        <div className="boot" role="status" aria-label="加载中">
          <Skeleton ratio="1" />
          <span className="t-cap dim">正在加载项目…</span>
          {q.isError && (
            <Button onClick={() => q.refetch()}>加载失败，重试</Button>
          )}
        </div>
      </div>
    );
  }

  const Page = PAGES[STEPS.includes(step) ? step : 'outline']!;
  return (
    <div className="app">
      <TopBar />
      <div className={route === 'home' ? 'work work--full' : 'work'}>
        {route === 'home' ? <HomePage /> : <Page />}
        {route === 'project' && <AgentPanel />}
      </div>
      <Toaster />
    </div>
  );
}

/**
 * /project/:step 路由：URL ↔ store 双向同步，并渲染外壳。
 * 注意必须渲染 AppShell —— 只做同步返回 null 会让直达/刷新白屏（已踩过的坑）。
 */
export function ProjectRoute() {
  const { projectId, step } = useParams();
  const navigate = useNavigate();
  const route = useUi((s) => s.route);
  const setRoute = useUi((s) => s.setRoute);
  const setUi = useUi((s) => s.set);
  const uiStep = useUi((s) => s.step);
  const uiProjectId = useUi((s) => s.projectId);

  // /project/outline 这类旧形式：第一个段其实是 step，不是项目 ID → 回列表取默认项目
  const projectIdIsStep = STEPS.includes(projectId as Step);
  const validStep: Step = projectIdIsStep
    ? (projectId as Step)
    : STEPS.includes(step as Step) ? (step as Step) : 'outline';

  // URL → store
  useEffect(() => {
    setRoute('project');
    setUi('projectId', projectIdIsStep ? '' : (projectId ?? ''));
    if (validStep !== useUi.getState().step) useUi.getState().setStep(validStep);
  }, [projectId, validStep, setRoute, setUi]);

  // store → URL：顶栏切页时写回地址栏（带项目 ID）
  useEffect(() => {
    if (route === 'project' && uiProjectId && STEPS.includes(uiStep)) {
      const target = `/project/${uiProjectId}/${uiStep}`;
      if (window.location.pathname !== target) navigate(target, { replace: true });
    }
  }, [uiProjectId, uiStep, route, navigate]);

  if (route !== 'project' || !uiProjectId) {
    // 还没有项目 ID：回首页的项目列表里取默认项目
    return projectIdIsStep ? <ProjectEntryRedirect fallbackStep={validStep} /> : <Navigate to="/" replace />;
  }
  return <AppShell />;
}

/** /project（或 /project/outline 这类不带 ID 的旧形式）→ 跳到列表里的默认项目 */
export function ProjectEntryRedirect({ fallbackStep = 'outline' }: { fallbackStep?: Step }) {
  const navigate = useNavigate();
  const list = useProjectList();
  useEffect(() => {
    if (list.data?.length) navigate(`/project/${list.data[0]!.id}/${fallbackStep}`, { replace: true });
  }, [list.data, fallbackStep, navigate]);
  return (
    <div className="app">
      <div className="boot" role="status" aria-label="加载中">
        <Skeleton ratio="1" />
        <span className="t-cap dim">正在打开项目…</span>
      </div>
    </div>
  );
}
