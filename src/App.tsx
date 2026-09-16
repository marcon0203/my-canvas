import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Navigate, useParams, useNavigate } from 'react-router';
import { Toaster } from '@/ui/Toast';
import { Skeleton } from '@/ui/Skeleton';
import { Button, EmptyState } from '@/ui';
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
import { SettingsPage, type SettingsSection } from '@/features/settings/SettingsPage';
import { Rail } from '@/components/shell/Rail';
import { SubNav } from '@/components/shell/SubNav';
import { isAgentId } from '@/domain/agent/roster';
import { providerOf } from '@/domain/providers/catalog';
import { isSkillId } from '@/domain/agent/skills';
import { builtinSkill } from '@/domain/skills/builtin';
import type { ProviderId } from '@/domain/providers/model';
import { SETTINGS_SUB, STEPS, WORKBENCH_SUB, defaultSub, isValidSub, type SectionId } from '@/domain/nav';
import { TokenGallery } from './routes/TokenGallery';

const queryClient = new QueryClient();


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
  // 设置是**应用级**的，不属于任何项目：模型与 Agent 配置跨项目共用，
  // 放进 /project/:id/... 会让人以为是「这个项目的模型」
  { path: '/settings/:section?/:detail?', element: <SettingsRoute /> },
  { path: '/resources', element: <ResourcesRoute /> },
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

/**
 * 应用骨架：左侧一级图标栏 + 二级菜单 + 内容区（Apifox 那种）。
 * 一级决定在哪个大区，二级决定大区内部去哪；两者都进 URL，可刷新可分享。
 *
 * 两处刻意的缺省：
 * - `section` 不给就**不画一级栏**。项目内是这样 —— 那时二级菜单（创作阶段）
 *   才是主导航，一级栏只会分散注意力；出口是二级菜单顶部的「返回工作台」。
 * - `top` 不给就**不画顶栏**。顶栏装的全是项目级的东西，首页和设置页没有，
 *   留着只会是一排跳回自己的按钮。
 */
function Shell({ section, sub, onSub, top = false, children, aside }: {
  section?: SectionId;
  sub?: {
    title: string;
    meta?: React.ReactNode;
    back?: { label: string; onClick: () => void };
    items: readonly { k: string; n: string; icon: string; hint?: string }[];
    active: string;
    footer?: React.ReactNode;
  };
  onSub?: (k: string) => void;
  top?: boolean;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const go = (id: SectionId) => {
    if (id === 'workbench') { navigate('/'); return; }
    if (id === 'resources') { navigate('/resources'); return; }
    navigate(`/settings/${defaultSub('settings')}`);
  };
  return (
    <div className="app">
      {top && <TopBar />}
      <div className="body">
        {section && <Rail active={section} onPick={go} />}
        {sub && <SubNav {...sub} onPick={(k) => onSub?.(k)} />}
        <main className="body__main">{children}</main>
        {aside}
      </div>
      <Toaster />
    </div>
  );
}

/** 设置页：应用级，不挂在任何项目下。二级菜单是三个分区 */
export function SettingsRoute() {
  const { section, detail } = useParams();
  const navigate = useNavigate();
  const setRoute = useUi((s) => s.setRoute);
  useEffect(() => { setRoute('settings'); }, [setRoute]);

  const active = (isValidSub('settings', section ?? '') ? section! : defaultSub('settings')) as SettingsSection;
  // 详情段只有模型与智能体两个分区有；乱填的名字当没填，回列表而不是白屏
  const valid = active === 'agents' ? isAgentId(detail)
    : active === 'models' ? !!providerOf(detail as ProviderId)
    : active === 'skills' ? (isSkillId(detail) || !!builtinSkill(detail ?? ''))
    : false;
  const item = valid ? detail : undefined;

  return (
    <Shell section="settings"
      sub={{ title: '设置', items: SETTINGS_SUB, active }}
      onSub={(k) => navigate(`/settings/${k}`)}>
      <SettingsPage section={active} detail={item}
        onOpen={(id) => navigate(`/settings/${active}/${id}`)}
        onBack={() => navigate(`/settings/${active}`)} />
    </Shell>
  );
}

/** 资源管理：入口先放着，点进来说明白还没实现 —— 比灰掉一个按钮诚实 */
export function ResourcesRoute() {
  const setRoute = useUi((s) => s.setRoute);
  useEffect(() => { setRoute('resources'); }, [setRoute]);
  return (
    <Shell section="resources">
      <div className="stage"><div className="stage__body"><div className="pad">
        <EmptyState icon="image"
          text="资源管理还没实现。这里将来放跨项目共用的素材：参考图、音乐、字体、LUT，以及它们被哪些项目引用。现在先占个入口。" />
      </div></div></div>
    </Shell>
  );
}

/** 应用外壳：与原型同构（.app > header.top + .work + aside.agent）。home 与项目两种形态 */
export function AppShell() {
  const navigate = useNavigate();
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
  if (route === 'home') {
    return <Shell section="workbench"><HomePage /></Shell>;
  }
  return (
    <Shell top
      sub={{
        title: '创作流程',
        back: { label: '返回工作台', onClick: () => { useUi.getState().setRoute('home'); navigate('/'); } },
        items: WORKBENCH_SUB,
        active: step,
      }}
      onSub={(k) => useUi.getState().setStep(k as Step)}
      aside={<AgentPanel />}>
      <Page />
    </Shell>
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
