import { cn } from '@/lib/cn';

/** 页签（受控） */
export function Tabs<T extends string>({ items, value, onChange, className }: {
  items: readonly { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex items-center gap-1', className)}>
      {items.map((it) => (
        <button key={it.key} role="tab" aria-selected={it.key === value}
          onClick={() => onChange(it.key)}
          className={cn(
            'h-8 px-3.5 rounded-t-control text-[13px] font-medium border-b-2 -mb-px transition-colors',
            it.key === value
              ? 'text-ink border-accent'
              : 'text-ink-muted border-transparent hover:text-ink',
          )}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
