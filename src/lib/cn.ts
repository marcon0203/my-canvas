/** classnames 拼接（false/undefined 自动过滤） */
export const cn = (...xs: Array<string | false | null | undefined>): string =>
  xs.filter(Boolean).join(' ');
