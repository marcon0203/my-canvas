import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
}

/**
 * 按钮：primary → 原型 .ds-btn.ds-btn--primary，secondary → .tbtn。
 * 图标尺寸/间距由 prototype.css 控制。
 */
export function Button({
  variant = 'secondary', loading = false,
  iconBefore, iconAfter, className, children, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(variant === 'primary' ? 'ds-btn ds-btn--primary' : 'tbtn', className)}
    >
      {loading ? <Spinner /> : iconBefore}
      {children}
      {iconAfter}
    </button>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden
    className={cn('spin', className)} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
  </svg>
);
