import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** 轻量浮层：点击外部关闭 */
export function Popover({ trigger, children, align = 'start', className }: {
  trigger: (open: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <span onClick={() => setOpen((v) => !v)}>{trigger(open)}</span>
      {open && (
        <span className={cn(
          'absolute top-full mt-1.5 z-50 min-w-44 p-2 rounded-card border border-line',
          'bg-surface shadow-raised',
          align === 'end' ? 'right-0' : 'left-0', className,
        )} onClick={() => {
          if (typeof children !== 'function') setOpen(false);
        }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </span>
      )}
    </span>
  );
}
