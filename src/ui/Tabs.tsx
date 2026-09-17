import { cn } from '@/lib/cn';

/**
 * 页签（受控）。
 *
 * 样式走 prototype.css 的 `.tabs*`，不用 Tailwind 工具类：`base.css` 里
 * `button { border: 0; color: inherit }` 是**没有分层**的，而 Tailwind v4 的
 * 工具类在 `@layer utilities` 里 —— 未分层的规则赢过任何分层规则，跟选择器
 * 权重无关。所以这个组件原来写的 `border-b-2 text-ink-muted` 一条都没生效，
 * 选中和没选中长得一模一样。这个组件此前没人用过，所以一直没露出来。
 */
export function Tabs<T extends string>({ items, value, onChange, className }: {
  items: readonly { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('tabs', className)}>
      {items.map((it) => (
        <button key={it.key} role="tab" aria-selected={it.key === value}
          className="tabs__t" onClick={() => onChange(it.key)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
