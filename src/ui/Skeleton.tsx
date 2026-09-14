/** 生成中占位（骨架屏） */
export function Skeleton({ ratio = '9/16' }: { ratio?: string }) {
  return <div aria-hidden className="take-skeleton" style={{ aspectRatio: ratio }} />;
}
