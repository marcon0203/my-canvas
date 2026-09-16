/**
 * 工作空间数据层：配置与项目的读写。
 *
 * 桌面端走 IPC，文件真的落在 `<workspace>/` 下；浏览器里没有文件系统，
 * 用 localStorage 顶一个**同形**的实现 —— 接口一致，所以界面代码只有一份，
 * 而且开发时在浏览器里就能把「新建项目 → 跑完七个阶段」整条路走通。
 *
 * **密钥不走这里**。它只进系统钥匙串，见 api/desktop.ts 的 vault。
 */

import { isDesktop } from './desktop';
import type { Act, DocBlock } from '@/domain/story/model';

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
 * 新项目 id：可读、可当目录名、不撞车。
 * 用名字 + 时间戳而不是 uuid —— 用户打开 projects/ 时要认得出哪个目录是哪个项目。
 */
export function newProjectId(name: string, taken: readonly string[]): string {
  const cleaned = name.trim().replace(/[/\\:*?"<>|]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  // 全是非法字符时会剩一串下划线 —— 那种目录名等于没名字，不如直接叫「未命名」
  const base = /^[_\s.]*$/.test(cleaned) ? '未命名' : cleaned;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let id = `${base}-${stamp}`;
  let n = 2;
  while (taken.includes(id)) id = `${base}-${stamp}-${n++}`;
  return id;
}
