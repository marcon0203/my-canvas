import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ChipTone = 'neutral' | 'a' | 'ok' | 'warn';

const TONE: Record<ChipTone, string> = {
  neutral: 'pill',
  a: 'pill pill--a',
  ok: 'pill pill--ok',
  warn: 'pill pill--warn',
};

/** 静态标签：原型 .pill 同构 */
export function Chip({ tone = 'neutral', className, style, children }: {
  tone?: ChipTone;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  return <span className={cn(TONE[tone], className)} style={style}>{children}</span>;
}
