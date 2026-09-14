/**
 * 读取 CSS 变量的计算值。
 * 3D 场景、Canvas 绘制等无法直接用 CSS 的地方，统一走这里取色，
 * 保证它们和界面主题是同一套 token，切主题时一并生效。
 */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function cssVarNumber(name: string, fallback = 0): number {
  const v = parseFloat(cssVar(name));
  return Number.isFinite(v) ? v : fallback;
}
