import type { ReactNode } from 'react';

/** 可按下的 chip：原型 .cc 同构（aria-pressed 驱动选中态） */
export function ToggleChip({ on = false, children, ...rest }: {
  on?: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} aria-pressed={on} className="cc">
      {children}
    </button>
  );
}
