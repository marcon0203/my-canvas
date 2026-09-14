import type { ReactNode } from 'react';

/** 卡片容器：原型 .blk 同构（可选 .blk__bar 标题栏） */
export function Panel({ bar, bodyStyle, children }: {
  bar?: ReactNode;
  bodyStyle?: React.CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="blk">
      {bar && <div className="blk__bar">{bar}</div>}
      <div className="blk__body" style={bodyStyle}>{children}</div>
    </div>
  );
}
