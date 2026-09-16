import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** 可按下的 chip：原型 .cc 同构（aria-pressed 驱动选中态） */
export function ToggleChip({ on = false, className, children, ...rest }: {
  on?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} aria-pressed={on} className={cn('cc', className)}>
      {children}
    </button>
  );
}
