import type { IconName } from '@/ui/Icon';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';

export type ThumbRatio = 'wide' | 'tall' | 'square' | 'portrait';

const RATIO: Record<ThumbRatio, string> = {
  wide: 'aspect-video',
  tall: 'aspect-[9/16]',
  square: 'aspect-square',
  portrait: 'aspect-3/4',
};

/** 图片瓦片：空态、角标、选中态 */
export function Thumbnail({ src, ratio = 'tall', selected = false, alt = '',
  badge, empty, onClick, className, imgClass }: {
  src?: string;
  ratio?: ThumbRatio;
  selected?: boolean;
  alt?: string;
  badge?: ReactNode;
  /** 未生成时的空态图标名 */
  empty?: IconName;
  onClick?: () => void;
  className?: string;
  imgClass?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick}
      className={cn(
        'relative block w-full overflow-hidden rounded-tile bg-muted',
        RATIO[ratio],
        selected && 'outline outline-2 outline-accent',
        onClick && 'cursor-pointer',
        className,
      )}>
      {src
        ? <img src={src} alt={alt} loading="lazy"
            className={cn('absolute inset-0 size-full object-cover', imgClass)} />
        : <span className="absolute inset-0 flex items-center justify-center text-ink-faint">
            <Icon name={empty ?? 'image'} size={20} />
          </span>}
      {badge && <span className="absolute top-1 right-1">{badge}</span>}
    </Tag>
  );
}
