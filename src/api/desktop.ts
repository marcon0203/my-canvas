/**
 * 桌面端桥接。
 *
 * 同一份前端既跑在浏览器（开发、演示）也跑在 Tauri WebView（正式）：
 * `isDesktop()` 为假时全部回落到浏览器实现，界面代码不需要分支。
 *
 * 密钥相关的命令**只有桌面端有真实现** —— 浏览器里没有系统钥匙串，
 * 回落实现只记「配没配」，并且在设置界面里如实说明。
 */

import { BUILTIN_SKILLS, builtinSkill } from '@/domain/skills/builtin';
import type { SkillMeta, SkillWarning } from '@/domain/skills/loader';

export interface KeyStatus {
  provider: string;
  hasKey: boolean;
  hint?: string;
}

/** Tauri 注入的全局标记；浏览器里没有 */
export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** 惰性加载：浏览器里根本不该把 tauri 的代码拉进来 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(cmd, args);
}

export const vault = {
  async set(provider: string, key: string): Promise<KeyStatus> {
    if (!isDesktop()) return { provider, hasKey: true, hint: maskHint(key) };
    return invoke<KeyStatus>('vault_set', { provider, key });
  },
  async clear(provider: string): Promise<KeyStatus> {
    if (!isDesktop()) return { provider, hasKey: false };
    return invoke<KeyStatus>('vault_clear', { provider });
  },
  async status(providers: string[]): Promise<KeyStatus[]> {
    if (!isDesktop()) return [];
    return invoke<KeyStatus[]>('vault_status', { providers });
  },
};

/**
 * 与 Rust 侧 `vault::hint_of` 同一规则：短密钥全遮，否则只露最后四位。
 * 两边必须一致，否则浏览器和桌面端显示的尾号会不一样。
 */
export function maskHint(key: string): string {
  return [...key].length <= 8 ? '••••' : `••••${key.slice(-4)}`;
}

/* ---------------- Agent 运行 ---------------- */

/** 与 Rust 侧 `studio_core::run::RunEvent` 同形 */
export type RunEvent =
  | { t: 'step'; index: number }
  | { t: 'delta'; text: string }
  | { t: 'proposal'; draft: OutlineDraft }
  | { t: 'prompts'; draft: PromptDraft }
  | { t: 'done' }
  | { t: 'failed'; code: string; message: string };

/** 与 Rust 侧 `outline::OutlineDraft` 同形；采纳时直接进项目树 */
export interface OutlineDraft {
  reply: string;
  acts: { t: string; span: string; beats: { k: string; t: string }[] }[];
}

export interface OutlineInput {
  project: string;
  idea: string;
  actCount: number;
  beatCount: number;
}

/** 与 Rust 侧 `shotprompt::PromptDraft` 同形 */
export interface PromptDraft {
  reply: string;
  prompts: { id: string; own: string }[];
}

/** 一镜的现状。**引用在前端展开成描述再送过去** —— Rust 不碰项目库 */
export interface ShotBrief {
  id: string;
  size: string;
  sizeEn: string;
  desc: string;
  refs: string[];
}

export interface PromptInput {
  project: string;
  stylePrompt: string;
  shots: ShotBrief[];
}

export interface RunArgs<I> {
  cfg: unknown;
  fallbackPreamble: string;
  globals: unknown;
  providers: unknown;
  input: I;
  /** 这一轮要展开哪个 skill 的正文。不给就只有清单，没有指令 */
  skill?: string;
  /** 工作空间根目录，Rust 侧据此找用户放的 skill */
  workspace?: string;
}

/**
 * 起草大纲：桌面端走 IPC 流式通道。
 * 浏览器里没有实现 —— 调用方应先用 `isDesktop()` 判断，走 mock 那条路。
 */
export async function outlineDraft(args: RunArgs<OutlineInput>, onEvent: (e: RunEvent) => void): Promise<void> {
  const { invoke: call, Channel } = await import('@tauri-apps/api/core');
  const ch = new Channel<RunEvent>();
  ch.onmessage = onEvent;
  await call('agent_outline_draft', { ...args, onEvent: ch });
}

/** 补写提示词：同一条 Channel 机制，换命令与输入 */
export async function shotsPrompt(
  args: RunArgs<PromptInput>,
  onEvent: (e: RunEvent) => void,
): Promise<void> {
  const { invoke: call, Channel } = await import('@tauri-apps/api/core');
  const ch = new Channel<RunEvent>();
  ch.onmessage = onEvent;
  await call('agent_shots_prompt', { ...args, onEvent: ch });
}

/* ---------------- Skill ---------------- */


export interface SkillList {
  skills: SkillMeta[];
  warnings: SkillWarning[];
}

/* ---------------- 工作空间 ---------------- */

export interface SubdirInfo {
  name: string;
  desc: string;
  /** 现在真的在用，还是只是规划里的 */
  used: boolean;
  exists: boolean;
}

export interface WorkspaceInfo {
  root: string;
  source: 'default' | 'user';
  /** 不填时会落在哪儿 */
  defaultRoot: string;
  exists: boolean;
  writable: boolean;
  subdirs: SubdirInfo[];
}

/**
 * 当前工作空间的情况。
 *
 * 浏览器里没有文件系统，只能回一份「说明性」的结果：路径按规则算给人看，
 * 但 exists / writable 一律 false，界面据此说明白「这里看不到真实情况」。
 */
export async function workspaceInfo(configured: string): Promise<WorkspaceInfo> {
  if (!isDesktop()) {
    const root = configured.trim() || '~/.hitv';
    return {
      root, source: configured.trim() ? 'user' : 'default', defaultRoot: '~/.hitv',
      exists: false, writable: false,
      subdirs: [
        { name: 'skills', desc: '用户自己放的 skill，与内置同名时盖过内置', used: true, exists: false },
        { name: 'projects', desc: '项目数据', used: false, exists: false },
      ],
    };
  }
  return invoke<WorkspaceInfo>('workspace_info', { configured });
}

/** 校验并建出目录。只建不搬 —— 旧工作空间里的东西不会被移动或删除 */
export async function workspacePrepare(path: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>('workspace_prepare', { path });
}

/**
 * 装了哪些 skill（第 1 级：只有名字与说明，不含正文）。
 *
 * 桌面端扫真实目录，能看到用户自己放进去的；浏览器里没有文件系统，
 * 只能列出构建期嵌进来的内置那几个 —— 内容是真的，但看不到用户的。
 */
export async function skillsList(workspace = ''): Promise<SkillList> {
  if (!isDesktop()) return { skills: BUILTIN_SKILLS.map((s) => s.meta), warnings: [] };
  return invoke<SkillList>('skills_list', { workspace });
}

/** 某个 skill 的正文（第 2 级：点进详情才读） */
export async function skillBody(name: string, workspace = ''): Promise<string> {
  if (!isDesktop()) return builtinSkill(name)?.body ?? '';
  return invoke<string>('skill_body', { name, workspace });
}

/** skill 里的附件（第 3 级：正文指到哪个读哪个）。浏览器里读不到 */
export async function skillResource(name: string, rel: string, workspace = ''): Promise<string> {
  if (!isDesktop()) return '';
  return invoke<string>('skill_resource', { name, rel, workspace });
}
