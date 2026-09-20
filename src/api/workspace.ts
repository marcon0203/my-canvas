/**
 * 工作空间数据层：配置与项目的读写。
 *
 * 桌面端走 IPC，文件真的落在 `<workspace>/` 下；浏览器里没有文件系统，
 * 用 localStorage 顶一个**同形**的实现 —— 接口一致，所以界面代码只有一份，
 * 而且开发时在浏览器里就能把「新建项目 → 跑完七个阶段」整条路走通。
 *
 * **供应商配置不走这里**。它一家一个 `<workspace>/providers/<id>.yaml`，
 * 端点、api key、模型清单都在那儿，见 api/desktop.ts 的 `provs`。
 */

import { isDesktop } from './desktop';
import type { Act, DocBlock } from '@/domain/story/model';
import type { Subtitles, Timeline } from '@/domain/clips/model';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(cmd, args);
}

export type ConfigName = 'providers' | 'agents' | 'app';

/** 与 Rust 侧 `project::Meta` 同形 */
export interface ProjectMeta {
  id: string;
  proj: string;
  ratio: string;
  style: string;
  stylePrompt: string;
  styles: string[];
  credits: number;
  budget: number;
  updatedAt: string;
  kind: string;
}

/** 与 Rust 侧 `project::Bundle` 同形 */
export interface ProjectBundle {
  meta: ProjectMeta;
  acts: Act[];
  blocks: DocBlock[];
  assets: unknown;
  shots: unknown;
  /** 成片顺序与卡点。Rust 侧空的时候不落文件，读回来是空的 */
  timeline?: Timeline;
  subtitles?: Subtitles;
}

export const defaultMeta = (id: string, proj: string): ProjectMeta => ({
  id,
  proj,
  ratio: '9:16',
  style: '水彩绘本',
  stylePrompt: 'watercolor storybook, soft edges, film grain',
  styles: ['水彩绘本', '胶片质感', '赛璐璐'],
  credits: 120,
  budget: 120,
  updatedAt: new Date().toISOString(),
  kind: '短剧',
});

/* ---------------- 浏览器兜底：一个 localStorage 里的假工作空间 ---------------- */

const LS = {
  config: (n: ConfigName) => `hitv.config.${n}`,
  project: (id: string) => `hitv.project.${id}`,
  index: 'hitv.projects',
};

const readLS = <T,>(k: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
};

const writeLS = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 隐私模式下写不了，忽略 */ }
};

/* ---------------- 配置 ---------------- */

export async function configLoad<T>(which: ConfigName, workspace: string, fallback: T): Promise<T> {
  if (!isDesktop()) return readLS(LS.config(which), fallback);
  const v = await invoke<unknown>('config_load', { which, workspace });
  // 文件不存在时 Rust 给的是 null，这里换成调用方的默认值
  return (v === null || v === undefined) ? fallback : (v as T);
}

export async function configSave(which: ConfigName, workspace: string, value: unknown): Promise<void> {
  if (!isDesktop()) { writeLS(LS.config(which), value); return; }
  await invoke('config_save', { which, value, workspace });
}

/* ---------------- 项目 ---------------- */

export async function projectList(workspace: string): Promise<ProjectMeta[]> {
  if (!isDesktop()) {
    const ids = readLS<string[]>(LS.index, []);
    return ids
      .map((id) => readLS<ProjectBundle | null>(LS.project(id), null))
      .filter((b): b is ProjectBundle => !!b)
      .map((b) => b.meta)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return invoke<ProjectMeta[]>('project_list', { workspace });
}

export async function projectLoad(id: string, workspace: string): Promise<ProjectBundle> {
  if (!isDesktop()) {
    const b = readLS<ProjectBundle | null>(LS.project(id), null);
    if (!b) throw new Error(`找不到项目 ${id}`);
    return b;
  }
  return invoke<ProjectBundle>('project_load', { id, workspace });
}

export async function projectSave(bundle: ProjectBundle, workspace: string): Promise<void> {
  if (!isDesktop()) {
    writeLS(LS.project(bundle.meta.id), bundle);
    const ids = readLS<string[]>(LS.index, []);
    if (!ids.includes(bundle.meta.id)) writeLS(LS.index, [...ids, bundle.meta.id]);
    return;
  }
  await invoke('project_save', { bundle, workspace });
}

export async function projectDelete(id: string, workspace: string): Promise<void> {
  if (!isDesktop()) {
    localStorage.removeItem(LS.project(id));
    writeLS(LS.index, readLS<string[]>(LS.index, []).filter((x) => x !== id));
    return;
  }
  await invoke('project_delete', { id, workspace });
}

/**
 * id 里那截名字最多几个字。
 *
 * 走查里 URL 长这样：`/project/%E4%B8%80%E4%B8%AA%E4%BF%AE...-20260918/outline` ——
 * 一句十几个汉字的需求，URL 编码之后是四五十个字符，既读不出来也不好分享。
 * 八个字足够在 `projects/` 里认出是哪个项目，标题仍然是完整那句。
 */
const ID_SLUG = 8;

/**
 * 新项目 id：可读、可当目录名、不撞车。
 *
 * # id 和标题是两件事
 *
 * **id 一旦定下就不再变**：它是磁盘目录名，也是 URL 的一部分。改标题只改
 * `meta.proj`，不动 id —— 否则一改名字，已有的链接失效、目录要搬家、
 * 落在里面的媒体文件路径全错。所以任何地方都不要从 id 反推标题，
 * 也不要在改名时重算 id（`workspace.rename.test.ts` 守着这条）。
 *
 * 用名字 + 日期而不是 uuid：用户打开 `projects/` 时要认得出哪个目录是哪个项目。
 * 同一天同一句话建两次靠尾号区分。
 */
export function newProjectId(name: string, taken: readonly string[]): string {
  const cleaned = name.trim().replace(/[/\\:*?"<>|]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  // 全是非法字符时会剩一串下划线 —— 那种目录名等于没名字，不如直接叫「未命名」
  const base = (/^[_\s.]*$/.test(cleaned) ? '未命名' : cleaned).slice(0, ID_SLUG);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let id = `${base}-${stamp}`;
  let n = 2;
  while (taken.includes(id)) id = `${base}-${stamp}-${n++}`;
  return id;
}
