import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '@/ui/Icon';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

/** 顶栏：原型 renderTop 同构（.top / .top__proj / .top__nav.seg / .top__tools / .credit / .ava） */
export function TopBar() {
  const navigate = useNavigate();
  const proj = useProject((s) => s.proj);
  const credits = useProject((s) => s.credits);
  const route = useUi((s) => s.route);
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
          <div className="spacer" />
          <div className="top__tools">
            <button className="tbtn" title="撤销" style={{ opacity: canUndo ? 1 : 0.4 }}
              onClick={() => { if (canUndo) { useProject.temporal.getState().undo(); toast('已撤销'); } }}>
              <Icon name="undo" />
            </button>
            <button className="tbtn" title="重做" style={{ opacity: canRedo ? 1 : 0.4 }}
              onClick={() => { if (canRedo) { useProject.temporal.getState().redo(); toast('已重做'); } }}>
              <Icon name="redo" />
            </button>

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
