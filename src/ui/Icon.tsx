import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** 线性图标注册表：24 viewBox、stroke 1.8、currentColor */
const PATHS: Record<string, ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  bolt: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13z" />,
  share: <><circle cx="18" cy="5.5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="18.5" r="2.6" /><path d="m8.3 10.7 7.4-3.9M8.3 13.3l7.4 3.9" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6.3" /><path d="M20 5v6h-6" /></>,
  right: <path d="m9 5 7 7-7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="2" /><path d="m4.5 19 5.5-5.5 3 3 3.5-3.5 4 4" /></>,
  video: <><rect x="2.5" y="6" width="14" height="12" rx="2.5" /><path d="m16.5 10.5 5-3v9l-5-3" /></>,
  text: <path d="M5 6h14M5 11h14M5 16h9" />,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" /><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" /></>,
  map: <><path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2z" /><path d="M9 4v14M15 6v14" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />,
  wand: <><path d="m4 20 12-12" /><path d="M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z" /></>,
  /** 等轴立方体：3D 布光台的入口标识 */
  cube: <><path d="m12 2.5 8.5 4.8v9.4L12 21.5 3.5 16.7V7.3z" /><path d="m3.5 7.3 8.5 4.8 8.5-4.8" /><path d="M12 12.1v9.4" /></>,
  aperture: <><circle cx="12" cy="12" r="9" /><path d="m12 3 4.2 7.3M21 12h-8.4M16.2 19.5 12 12.2M3 12h8.4M7.8 4.5 12 11.8M7.8 19.5 12 12.2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m4.5 12.5 7.5 4.2 7.5-4.2" /><path d="m4.5 16.5 7.5 4.2 7.5-4.2" /></>,
  scissors: <><circle cx="6" cy="6.5" r="2.5" /><circle cx="6" cy="17.5" r="2.5" /><path d="M8.2 8.2 20 19M8.2 15.8 20 5" /></>,
  dl: <><path d="M12 3v12" /><path d="m7 10.5 5 5 5-5" /><path d="M4 20h16" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></>,
  hist: <><path d="M4 12a8 8 0 1 1 2.3 5.6" /><path d="M4 13V8M4 13h5" /><path d="M12 8v4.5l3 2" /></>,
  import: <><path d="M12 15V3" /><path d="m7 10.5 5 5 5-5" /><path d="M4 20h16" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.4c2.1.9 3.5 3 3.5 5.6" /></>,
  play: <path d="M7 4.5v15l13-7.5z" />,
  trash: <><path d="M4 6h16M9 6V4h6v2M6.5 6 8 21h8l1.5-15" /><path d="M10 10.5v6M14 10.5v6" /></>,
  undo: <><path d="M4 9h9a6 6 0 0 1 0 12H8" /><path d="M8 5 4 9l4 4" /></>,
  redo: <><path d="M20 9h-9a6 6 0 0 0 0 12h5" /><path d="m16 5 4 4-4 4" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={cn('shrink-0', className)}>
      {PATHS[name] ?? PATHS.image}
    </svg>
  );
}
