import type { ReactNode } from 'react';
import { Icon } from '@/ui/Icon';
import type { SubItem } from '@/domain/nav';

/** 二级导航：随一级变化的子菜单 */
export function SubNav({ title, meta, items, active, onPick, footer }: {
  title: string;
  meta?: ReactNode;
  items: readonly SubItem[];
  active: string;
  onPick: (k: string) => void;
  footer?: ReactNode;
}) {
  return (
    <nav className="subnav" aria-label={title}>
      <div className="subnav__h">
        <span className="subnav__t">{title}</span>
        <div className="spacer" />
        {meta}
      </div>
      <div className="subnav__list">
        {items.map((it) => (
          <button key={it.k} className="subnav__b" aria-current={it.k === active}
            onClick={() => onPick(it.k)} title={it.hint}>
            <Icon name={it.icon} />
            <span className="subnav__n">{it.n}</span>
            {it.hint && <span className="subnav__hint">{it.hint}</span>}
          </button>
        ))}
      </div>
      {footer && <div className="subnav__f">{footer}</div>}
    </nav>
  );
}
