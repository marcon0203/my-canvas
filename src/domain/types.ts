/**
 * 带单位的品牌类型：防止角度、毫米、档位互相串用。
 * 原型阶段的几个 bug（方位角符号丢失、景别档被当成任意数字）都属于这一类。
 */
declare const deg: unique symbol;
declare const mm: unique symbol;

export type Degrees = number & { readonly [deg]: true };
export type Millimetres = number & { readonly [mm]: true };

export const degrees = (n: number): Degrees => n as Degrees;
export const millimetres = (n: number): Millimetres => n as Millimetres;

/** 景别档，0=大远景 … 6=特写。只能是这七个值 */
export type DistStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const SIZE_ORDER = ['大远景', '远景', '全景', '中景', '中近景', '近景', '特写'] as const;
export type ShotSize = (typeof SIZE_ORDER)[number];

/** 画幅 */
export type AspectRatio = '9:16' | '3:4' | '4:5' | '1:1' | '4:3' | '16:9' | '2.39:1';
