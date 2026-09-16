import type { ReactNode } from 'react';

/**
 * 设置页的一行：左边标签列，右边控件，说明在控件**下面**而不是旁边。
 *
 * 两个详情页原来各写各的行：有的内容从卡片左边缘开始，有的前面带个标签列，
 * 说明有时在控件右边、有时在标题旁边 —— 一眼扫下去找不到一条对齐线，
 * 这是那种「说不清哪儿不对但就是乱」的来源。统一成这一个之后，
 * 整页只有两条竖线：标签列的左边缘和控件列的左边缘。
 */
export function Field({ label, hint, wide = false, children }: {
  label?: ReactNode;
  /** 说明。放控件下面 —— 放右边会被控件宽度推得忽左忽右 */
  hint?: ReactNode;
  /** 控件本身要占满整行（提示词、chip 墙），标签列只作标题 */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'field field--wide' : 'field'}>
      {label !== undefined && <div className="field__k">{label}</div>}
      <div className="field__v">{children}</div>
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

/** 一组 Field，行间有分隔线 */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="fields">{children}</div>;
}
