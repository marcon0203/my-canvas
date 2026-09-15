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

export interface TreeBranchProps extends TreeItemProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

/**
 * 可展开的树条目：自己是一行（选中态、缩略图、计数都在），下面挂子节点。
 * 资产 → 形状照用的就是它 —— 形状照属于某个资产，树里就该长在它下面。
 */
export function TreeBranch({ open, onToggle, children, ...item }: TreeBranchProps) {
  return (
    <div className="expl__branch">
      <div className="expl__row">
        <button
          className="expl__twist"
          aria-expanded={open}
          aria-label={open ? '收起' : '展开'}
          onClick={(e) => { e.stopPropagation(); onToggle(!open); }}
        >
          <Icon name="down" className="expl__chev" />
        </button>
        <span className="expl__rowmain"><TreeItem {...item} /></span>
      </div>
      {open && <div className="expl__subs">{children}</div>}
    </div>
  );
}

/** 子条目：形状照这一层。缩略图 + 名称 + 未生成标记 */
export function TreeLeaf({ thumb, title, meta, dot, selected = false, onClick }: {
  thumb?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  dot?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={selected}
      className="expl__leaf"
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    >
      {thumb !== undefined && <span className="expl__lthumb">{thumb}</span>}
      <span className="expl__t">{title}</span>
      {dot && <i className="expl__ldot" title="未生成" />}
      {meta !== undefined && <span className="expl__count">{meta}</span>}
    </div>
  );
}
