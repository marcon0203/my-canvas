import { useSyncExternalStore } from 'react';
import { Icon } from '@/ui/Icon';
import { Account } from './shell/Account';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

/**
 * 顶栏：**只在项目内出现**。
 *
 * 它承载的都是项目级的东西 —— 项目名、撤销/重做、分享。首页与设置页没有这些，
 * 剩下的只会是一排跳回自己的按钮，所以那些页面干脆不要顶栏。
 * 出口不在这儿：项目内二级菜单顶部有「返回工作台」。
 */
export function TopBar() {
  const proj = useProject((s) => s.proj);
  const toast = useUi((s) => s.toast);

  const canUndo = useSyncExternalStore(useProject.temporal.subscribe,
    () => useProject.temporal.getState().pastStates.length > 0);
  const canRedo = useSyncExternalStore(useProject.temporal.subscribe,
    () => useProject.temporal.getState().futureStates.length > 0);

  return (
    <header className="top">
      <div className="top__proj">{proj}</div>
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
      <div className="row" style={{ gap: 8 }}>
        <button className="tbtn" onClick={() => toast('相比基础版的差异：资产有稳定 ID 与版本、定稿锁定才能被引用、每次生成都记账')}>
          <Icon name="layers" />差异
        </button>
        <button className="tbtn" title="分享" aria-label="分享" style={{ padding: '0 8px' }}
          onClick={() => toast('分享链接已复制 — 打开的人看到的是只读视图')}>
          <Icon name="share" />
        </button>
        <Account />
      </div>
    </header>
  );
}
