import type { ReactNode } from 'react';

/** 页头工作条：原型 .stage__bar 同构。标题 + 状态 pills + 右侧动作，七个页面共用 */
export function StageBar({ title, pills, actions }: {
  title: ReactNode;
  pills?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="stage__bar">
      <span className="stage__title">{title}</span>
      {pills}
      <div className="spacer" />
      {actions}
    </div>
  );
}
