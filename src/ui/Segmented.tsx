import { cn } from '@/lib/cn';

export interface SegItem {
  key: string;
  label: string;
  title?: string;
}

/** 分段控件：原型 .seg 同构（顶栏流程、简单/专业、剧本分区都是它） */
export function Segmented<T extends string>({ items, value, onChange, className, ariaLabel }: {
  items: readonly SegItem[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('seg', className)}>
      {items.map((it) => (
        <button key={it.key} role="tab" aria-selected={it.key === value} title={it.title}
          onClick={() => onChange(it.key as T)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
