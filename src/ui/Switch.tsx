import { cn } from '@/lib/cn';

/** 开关：原型 .sw 同构（轮廓光等） */
export function Switch({ on, onChange, label, className }: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <button role="switch" aria-checked={on} aria-label={label}
      onClick={() => onChange(!on)}
      className={cn('sw', className)}>
      <span />
    </button>
  );
}
