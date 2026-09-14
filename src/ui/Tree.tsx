import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** 树分组：原型 .expl__act 同构（chevron + 标题 + 可选 meta + 计数） */
export function TreeGroup({ title, meta, count, defaultOpen = true, children }: {
  title: ReactNode;
  meta?: ReactNode;
  count: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="expl__act" open={defaultOpen}>
      <summary>
        <Icon name="down" className="expl__chev" />
        <span className="expl__t">{title}</span>
        {meta && <span className="expl__span">{meta}</span>}
        <span className="expl__count">{count}</span>
      </summary>
      <div className="expl__kids">{children}</div>
    </details>
  );
}

export interface TreeItemProps {
  thumb?: ReactNode;
  /** 短标（镜头 id / 场次号），渲染为 .expl__k.mono */
  k?: ReactNode;
  title: ReactNode;
  count?: ReactNode;
  status?: { text: ReactNode; color: string };
  selected?: boolean;
  /** 资产/分镜条目变体（.expl__item--asset） */
  asset?: boolean;
  dot?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

/** 树条目：原型 .expl__item 同构，槽位全部可选 */
export function TreeItem(props: TreeItemProps) {
  const { thumb, k, title, count, status, selected = false, asset = false, dot, trailing, onClick } = props;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={selected}
      title={typeof title === 'string' ? title : undefined}
      className={asset ? 'expl__item expl__item--asset' : 'expl__item'}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    >
      {thumb !== undefined && <span className="expl__thumb">{thumb}</span>}
      {k !== undefined && <span className="expl__k mono">{k}</span>}
      <span className="expl__t">{title}</span>
      {dot}
      {count !== undefined && <span className="expl__count">{count}</span>}
      {trailing}
      {status && <span className="expl__st" style={{ color: status.color }}>{status.text}</span>}
    </div>
  );
}
