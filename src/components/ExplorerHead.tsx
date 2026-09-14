import type { ReactNode } from 'react';

/** 资源管理器头行：原型 .expl__head 同构（左标题 + 右计数），Outline / Assets / Storyboard 共用 */
export function ExplorerHead({ title, meta }: {
  title: string;
  meta: ReactNode;
}) {
  return (
    <div className="expl__head">
      <span className="sec" style={{ margin: 0 }}>{title}</span>
      <div className="spacer" />
      <span className="t-cap dim">{meta}</span>
    </div>
  );
}
