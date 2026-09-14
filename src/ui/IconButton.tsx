import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';

/** 方形 / 圆形图标按钮，tooltip 可选 */
export function IconButton({
  icon, label, round = false, active = false, className, size = 18, children, ...rest
}: {
  icon: string;
  label: string;
  round?: boolean;
  active?: boolean;
  size?: number;
  className?: string;
  children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center text-ink-muted transition-colors',
        'hover:bg-hover hover:text-ink',
        round ? 'size-8 rounded-full' : 'size-8 rounded-control',
        active && 'bg-accent-subtle text-accent',
        className,
      )}
    >
      <Icon name={icon} size={size} />
      {children}
    </button>
  );
}
