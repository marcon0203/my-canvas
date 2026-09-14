import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** 分镜表基础表格 */
export function Table({ head, children, className }: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th key={i} className="text-left text-[11px] font-medium text-ink-faint px-3 h-11 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn('border-b border-line-soft hover:bg-hover transition-colors', className)}>{children}</tr>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2.5 text-xs text-ink align-middle', className)}>{children}</td>;
}
