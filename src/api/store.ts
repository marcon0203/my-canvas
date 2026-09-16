/**
 * 项目数据的读写口子：工作空间 ↔ store。
 *
 * 一条数据路径，浏览器与桌面端共用 —— 示例项目也是**真的写进工作空间**，
 * 不是特殊对待的 mock。这样「新建项目」和「打开示例项目」走的是同一段代码，
 * 不会出现只有其中一条能用的情况。
 */

import { defaultRig } from '@/domain/assets/model';
import { MOCK_CONFIG } from '@/mock/config';
import { MOCK_PROJECTS } from '@/mock/project';
import type { ProjectBootstrap } from './mock';
import {
  defaultMeta, projectList, projectLoad, projectSave,
  type ProjectBundle, type ProjectMeta,
} from './workspace';

const SEEDED = 'hitv.seeded';

/** mock 的项目形状 → 落盘形状 */
function toBundle(id: string, p: (typeof MOCK_PROJECTS)[string]): ProjectBundle {
  return {
    meta: {
      ...defaultMeta(id, p.proj),
      ratio: p.ratio, style: p.style, stylePrompt: p.stylePrompt, styles: p.styles,
      credits: p.credits, budget: p.budget,
      updatedAt: new Date(Date.now() - Math.random() * 6e8).toISOString(),
    },
    acts: p.acts, blocks: p.blocks, assets: p.assets, shots: p.shots,
  };
}

/**
 * 首次运行把示例项目写进工作空间。
 *
 * 只做一次 —— 用户删掉示例项目后不该在下次启动时又冒出来。
 */
export async function seedIfEmpty(workspace: string): Promise<void> {
  try {
    if (localStorage.getItem(SEEDED)) return;
  } catch { /* 隐私模式，当作没种过 */ }
  const existing = await projectList(workspace);
  if (existing.length === 0) {
    for (const [id, p] of Object.entries(MOCK_PROJECTS)) {
      await projectSave(toBundle(id, p), workspace);
    }
  }
  try { localStorage.setItem(SEEDED, '1'); } catch { /* 同上 */ }
}

export async function listProjects(workspace: string): Promise<ProjectMeta[]> {
  await seedIfEmpty(workspace);
  return projectList(workspace);
}

/** 落盘形状 → store 要的 bootstrap。补齐惰性字段，immer 冻结前 rig 必须在 */
export async function loadProject(id: string, workspace: string): Promise<ProjectBootstrap> {
  await seedIfEmpty(workspace);
  const b = await projectLoad(id, workspace);
  const assets = (b.assets ?? { 角色: [], 场景: [], 道具: [] }) as ProjectBootstrap['project']['assets'];
  const shots = (b.shots ?? []) as ProjectBootstrap['project']['shots'];
  for (const group of Object.values(assets)) {
    for (const a of group) for (const v of a.views) v.rig ??= defaultRig(v.name);
  }
  for (const s of shots) s.rig ??= defaultRig(s.size);

  return {
    project: {
      id: b.meta.id, proj: b.meta.proj, kind: b.meta.kind,
      ratio: b.meta.ratio, style: b.meta.style, stylePrompt: b.meta.stylePrompt,
      styles: b.meta.styles, credits: b.meta.credits, budget: b.meta.budget,
      acts: b.acts, blocks: b.blocks, assets, shots,
      alts: {}, pins: [],
    } as ProjectBootstrap['project'],
    config: MOCK_CONFIG,
  };
}

/** store 快照 → 落盘形状 */
export function toBundleFrom(id: string, s: {
  proj: string; ratio: string; style: string; stylePrompt: string; styles: string[];
  credits: number; budget: number;
  acts: ProjectBundle['acts']; blocks: ProjectBundle['blocks'];
  assets: unknown; shots: unknown;
}): ProjectBundle {
  return {
    meta: {
      ...defaultMeta(id, s.proj),
      ratio: s.ratio, style: s.style, stylePrompt: s.stylePrompt, styles: s.styles,
      credits: s.credits, budget: s.budget,
      updatedAt: new Date().toISOString(),
    },
    acts: s.acts, blocks: s.blocks, assets: s.assets, shots: s.shots,
  };
}
