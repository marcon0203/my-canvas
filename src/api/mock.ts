import { defaultRig } from '@/domain/assets/model';
import { MOCK_PROJECT_LIST, MOCK_PROJECTS, type ProjectListEntry, type ProjectMock } from '@/mock/project';
import { MOCK_CONFIG, type MockConfig } from '@/mock/config';

/**
 * Mock 传输层：项目列表 + 按 ID 取项目。
 * 带网络延迟；每次返回深拷贝，防止应用就地改写污染 mock 源。
 * 接真实后端时：换掉本文件实现，store 与组件零改动。
 */

export interface ProjectBootstrap {
  project: ProjectMock;
  config: MockConfig;
}

const clone = <T,>(v: T): T => structuredClone(v);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ProjectNotFound extends Error {
  constructor(public readonly projectId: string) {
    super(`project ${projectId} not found`);
  }
}

/** 首页「最近的项目」 */
export async function fetchProjectList(): Promise<ProjectListEntry[]> {
  await delay(150 + Math.random() * 150);
  return clone(MOCK_PROJECT_LIST);
}

/** 按 ID 拉取项目内容 + 能力配置 */
export async function fetchProject(projectId: string): Promise<ProjectBootstrap> {
  await delay(250 + Math.random() * 250);
  const source = MOCK_PROJECTS[projectId];
  if (!source) throw new ProjectNotFound(projectId);
  return normalize(clone({ project: source, config: MOCK_CONFIG }));
}

/** 补齐惰性字段：rig 在冻结进 store 前必须存在（immer 会冻结状态树） */
function normalize(b: ProjectBootstrap): ProjectBootstrap {
  for (const group of Object.values(b.project.assets)) {
    for (const a of group) {
      for (const v of a.views) v.rig ??= defaultRig(v.name);
    }
  }
  for (const s of b.project.shots) s.rig ??= defaultRig(s.size);
  return b;
}
