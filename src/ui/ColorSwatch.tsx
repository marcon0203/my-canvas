import { cn } from '@/lib/cn';

/** 圆形色块，带发光；ColorSwatch + 原生取色 = GelPalette 的基础单元 */
export function ColorSwatch({ color, active = false, label, className, onClick }: {
  color: string;
  active?: boolean;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button aria-label={label} aria-pressed={active} title={label} onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1 p-1 rounded-control border transition-colors',
        active ? 'border-accent shadow-accent' : 'border-line hover:border-line-strong',
        className,
      )}>
      <i className="block size-5 rounded-full"
        style={{ background: color, boxShadow: active ? `0 0 8px ${color}` : undefined }} />
    </button>
  );
}

/** 色块 + 原生 input[type=color] */
export function ColorPicker({ color, label, onChange, className }: {
  color: string;
  label: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  return (
    <label className={cn(
      'relative flex items-center justify-center size-5 rounded-full border border-line cursor-pointer',
      'overflow-hidden', className,
    )} title={label} style={{ background: color }}>
      <input type="color" value={color} aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer" />
    </label>
  );
}
