import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from '@/lib/cn';

/** 弹窗：原型 .mo/.mo__box 同构（wide 变体给布光台；Esc/遮罩关闭） */
export function Modal({ open, onClose, title, subtitle, wide = false, footer, children, boxStyle }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  boxStyle?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="mo" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={cn('mo__box', wide && 'mo__box--wide')} style={boxStyle}>
        <div className="mo__h">
          <span className="mo__t">{title}</span>
          {subtitle && <span className="mo__s">{subtitle}</span>}
          <div className="spacer" />
          <button className="tbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        {children}
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 20px 20px' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
