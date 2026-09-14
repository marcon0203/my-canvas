export type Theme = 'light' | 'dark';

const KEY = 'studio.theme';

export function getTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) ?? 'light';
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(KEY, t);
}

/** 在 React 挂载前调用，避免主题闪烁 */
export function initTheme(): void {
  document.documentElement.dataset.theme = getTheme();
}
