/**
 * 导航结构：一级（图标栏）+ 二级（子菜单）。
 * 纯数据，路由与界面都从这里取，避免两处各写一份对不上。
 */

export type SectionId = 'workbench' | 'resources' | 'settings';

export interface SubItem {
  readonly k: string;
  readonly n: string;
  readonly icon: string;
  readonly hint?: string;
}

export interface Section {
  readonly id: SectionId;
  readonly n: string;
  readonly icon: string;
  /** 二级菜单。工作台的二级随项目走，在界面里拼 */
  readonly sub?: readonly SubItem[];
  /** 还没实现：入口在，点进去说明白 */
  readonly todo?: boolean;
}

/** 工作台的二级菜单 = 创作流程。与 store/ui 的 Step 同键 */
export const WORKBENCH_SUB: readonly SubItem[] = [
  { k: 'outline', n: '剧情大纲', icon: 'map', hint: '幕与场次' },
  { k: 'script', n: '剧本', icon: 'book', hint: '正文与润色' },
  { k: 'assets', n: '资产', icon: 'users', hint: '角色 / 场景 / 道具' },
  { k: 'storyboard', n: '分镜', icon: 'layers', hint: '拆镜与出图' },
  { k: 'editing', n: '剪辑', icon: 'scissors', hint: '成片与导出' },
  { k: 'overview', n: '总览画布', icon: 'grid', hint: '全流程节点图' },
  { k: 'metrics', n: '数据', icon: 'bolt', hint: '命中率与成本' },
];

export const SETTINGS_SUB: readonly SubItem[] = [
  { k: 'models', n: '模型设置', icon: 'cube', hint: '厂商接入与模型目录' },
  { k: 'skills', n: 'Skill 管理', icon: 'wand', hint: '每件活儿要什么工具、归谁' },
  { k: 'agents', n: '智能体管理', icon: 'users', hint: '侧重方向、模型、工具' },
];

export const SECTIONS: readonly Section[] = [
  { id: 'workbench', n: '工作台', icon: 'home', sub: WORKBENCH_SUB },
  { id: 'resources', n: '资源管理', icon: 'image', todo: true },
  { id: 'settings', n: '设置', icon: 'gear', sub: SETTINGS_SUB },
];

export const sectionOf = (id: SectionId): Section => SECTIONS.find((s) => s.id === id)!;

/** 二级菜单键是否合法 —— 路由直达时用它挡住乱填的段 */
export const isValidSub = (id: SectionId, k: string): boolean =>
  !!sectionOf(id).sub?.some((s) => s.k === k);
