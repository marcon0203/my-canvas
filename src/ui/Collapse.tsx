import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';

/** 折叠区：非受控自持；需要持久化展开态的用 open/onToggle 受控 */
export function Collapse({ summary, children, defaultOpen = false, open, onToggle,
  className, summaryClass }: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (v: boolean) => void;
  className?: string;
  summaryClass?: string;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const isopen = open ?? inner;
  return (
    <details open={isopen} className={cn('group', className)}
      onToggle={(e) => {
        const v = (e.currentTarget as HTMLDetailsElement).open;
        setInner(v);
        onToggle?.(v);
      }}>
      <summary className={cn('flex items-center gap-1.5 cursor-pointer select-none list-none', summaryClass)}>
        <Icon name="down" size={14}
          className="transition-transform group-open:rotate-180 text-ink-faint" />
        {summary}
      </summary>
      {children}
    </details>
  );
}
