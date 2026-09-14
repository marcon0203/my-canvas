import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

/** 下拉：原型 .runbar__sel 同构（模型、画幅、数量） */
export function Select({ options, value, onChange, ariaLabel, className }: {
  options: readonly (SelectOption | string)[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select aria-label={ariaLabel} value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('runbar__sel', className)}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}
