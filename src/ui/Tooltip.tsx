import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** 悬停说明。镜头语言每项都要 */
export function Tooltip({ tip, children, className }: {
  tip: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}>
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span role="tooltip" id={id}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50
                     max-w-56 px-2.5 py-1.5 rounded-control text-[11px] leading-snug text-center
                     bg-ink text-ink-inverse shadow-raised pointer-events-none">
          {tip}
        </span>
      )}
    </span>
  );
}
