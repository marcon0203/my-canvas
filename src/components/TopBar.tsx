import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '@/ui/Icon';
import { useProject } from '@/store/project';
import { useUi, type Step } from '@/store/ui';

const FLOW: readonly { k: Step; zh: string; en: string }[] = [
  { k: 'outline', zh: '剧情大纲', en: 'Plot outline' },
  { k: 'script', zh: '剧本', en: 'Script' },
  { k: 'assets', zh: '资产', en: 'Assets' },
  { k: 'storyboard', zh: '分镜', en: 'Storyboard' },
  { k: 'editing', zh: '剪辑', en: 'Editing' },
];

/** 顶栏：原型 renderTop 同构（.top / .top__proj / .top__nav.seg / .top__tools / .credit / .ava） */
export function TopBar() {
  const navigate = useNavigate();
  const proj = useProject((s) => s.proj);
  const credits = useProject((s) => s.credits);
  const route = useUi((s) => s.route);
  const step = useUi((s) => s.step);
  const setStep = useUi((s) => s.setStep);
  const setRoute = useUi((s) => s.setRoute);
  const toast = useUi((s) => s.toast);

  const canUndo = useSyncExternalStore(useProject.temporal.subscribe,
    () => useProject.temporal.getState().pastStates.length > 0);
  const canRedo = useSyncExternalStore(useProject.temporal.subscribe,
    () => useProject.temporal.getState().futureStates.length > 0);

  const inProj = route === 'project';
  return (
    <header className="top">
      <button className="tbtn" title="首页" style={{ padding: '0 8px' }}
        onClick={() => { setRoute('home'); navigate('/'); }}>
        <Icon name="home" />
      </button>
      {inProj ? (
        <>
          <div className="top__proj">{proj}</div>
          <nav className="top__nav seg" aria-label="创作流程">
            {FLOW.map((f) => (
              <button key={f.k} title={f.en} aria-selected={f.k === step}
                onClick={() => { setStep(f.k); }}>
                {f.zh}
              </button>
            ))}
          </nav>
          <div className="top__tools">
            <button className="tbtn" title="撤销" style={{ opacity: canUndo ? 1 : 0.4 }}
              onClick={() => { if (canUndo) { useProject.temporal.getState().undo(); toast('已撤销'); } }}>
              <Icon name="undo" />
            </button>
            <button className="tbtn" title="重做" style={{ opacity: canRedo ? 1 : 0.4 }}
              onClick={() => { if (canRedo) { useProject.temporal.getState().redo(); toast('已重做'); } }}>
              <Icon name="redo" />
            </button>
            <button className="tbtn" title="总览 · Overview" aria-current={step === 'overview'}
              onClick={() => setStep('overview')}><Icon name="grid" /></button>
            <button className="tbtn" title="数据 · Metrics" aria-current={step === 'metrics'}
              onClick={() => setStep('metrics')}><Icon name="bolt" /></button>
            <button className="tbtn" title="设置 · 模型服务商与 Agent 配置" aria-current={step === 'settings'}
              onClick={() => setStep('settings')}><Icon name="gear" /></button>
          </div>
          <div className="spacer" />
        </>
      ) : (
        <div className="spacer" />
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="tbtn" onClick={() => toast('相比基础版的差异：资产有稳定 ID 与版本、定稿锁定才能被引用、每次生成都记账')}>
          <Icon name="layers" />差异
        </button>
        <button className="tbtn" onClick={() => toast('充值页面：积分用于图像与视频生成')}>充值</button>
        <button className="credit" onClick={() => toast('充值页面：积分用于图像与视频生成')}>
          <Icon name="bolt" /><span>{credits}</span>
        </button>
        <button className="tbtn" title="分享" aria-label="分享" style={{ padding: '0 8px' }}
          onClick={() => toast('分享链接已复制 — 打开的人看到的是只读视图')}>
          <Icon name="share" />
        </button>
        <div className="ava">M</div>
      </div>
    </header>
  );
}
