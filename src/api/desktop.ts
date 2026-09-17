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
import type { ProposalPatch } from '@/domain/agent/types';
import type { Risk } from '@/domain/agent/policy';
import type { ToolId, ToolStatus } from '@/domain/agent/tools';

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

/** 用户自己的 Skill 该放在哪个目录。界面上要把它摆出来 */
export async function skillsDir(workspace = ''): Promise<string> {
  if (!isDesktop()) return `${workspace.trim() || '~/.hitv'}/skills`;
  return invoke<string>('skills_dir', { workspace });
}

/**
 * 导入一个目录当 Skill。校验与复制都在 Rust 侧。
 *
 * 浏览器里没有文件系统，所以这条只能在桌面端跑 —— 如实报错，不假装成功。
 */
export async function skillImport(path: string, workspace = ''): Promise<SkillMeta> {
  if (!isDesktop()) throw new Error('浏览器里没有文件系统，导入 Skill 要在桌面端');
  return invoke<SkillMeta>('skill_import', { path, workspace });
}

/** 在文件管理器里打开 skills 目录 */
export async function skillsReveal(workspace = ''): Promise<string> {
  if (!isDesktop()) throw new Error('浏览器里打不开本机目录，要在桌面端');
  return invoke<string>('skills_reveal', { workspace });
}

/** skill 里的附件（第 3 级：正文指到哪个读哪个）。浏览器里读不到 */
export async function skillResource(name: string, rel: string, workspace = ''): Promise<string> {
  if (!isDesktop()) return '';
  return invoke<string>('skill_resource', { name, rel, workspace });
}

/* ---------------- 工具调用 ---------------- */

/** 一次工具调用的结果。与 Rust 侧 `tools::Outcome` 同形（`t` 是判别字段） */
export type Outcome =
  | { t: 'ok'; value: unknown }
  /** 写类工具的产物：一份补丁，交给人采纳后再由 store 应用 */
  | { t: 'patch'; tool: string; patch: ProposalPatch }
  /** 超出自主上限，等人点头。点了之后拿 `approved: true` 再调一次 */
  | { t: 'needsApproval'; tool: string; risk: Risk; why: string }
  | { t: 'notImplemented'; tool: string; blockedBy: string }
  /**
   * 实现有，缺配置。与 notImplemented 分开是因为**要做的事完全不同**：
   * 这条是「去设置里配一下」，那条是「等人把它写出来」。
   */
  | { t: 'needsSetup'; tool: string; missing: string }
  /** 不在 Rust 侧跑（布光台），由前端执行 */
  | { t: 'elsewhere'; tool: string; runsIn: 'rust' | 'browser' };

export interface ToolCallArgs {
  projectId: string;
  tool: ToolId;
  args: Record<string, unknown>;
  /** 这个 Agent 的自主上限 */
  autoMax?: Risk;
  /**
   * **只有人真的点了「同意」才给 true**，而且只对这一次调用。
   *
   * 闸门的语义是「能不能不问就干」，egress 那档永远要问；
   * 没有这个开关的话，人点了同意也执行不了（那条洞在 core 的 `tools::By` 上写着）。
   * 它不存进任何配置，也不由模型的输出决定。
   */
  approved?: boolean;
  /** 生成类工具要用：找模型与端点 */
  cfg?: unknown;
  globals?: unknown;
  providers?: unknown;
  /** 工作空间根目录。路径的持久化在前端，每次调用传下去（Rust 侧无状态） */
  workspace?: string;
}

/**
 * 调一次工具。**闸门在 Rust 侧的 dispatch 里**，这层只转发 ——
 * 在前端补一套判断迟早和 Rust 那套对不上，而对不上的那一侧总是更宽松的那个。
 *
 * 浏览器里没有 Rust：如实返回「在别处跑」，不要在这儿伪造一个成功结果。
 */
export async function toolCall(a: ToolCallArgs): Promise<Outcome> {
  if (!isDesktop()) {
    return { t: 'notImplemented', tool: a.tool, blockedBy: '浏览器里没有 Rust 侧，工具要在桌面端才跑得起来' };
  }
  return invoke<Outcome>('tool_call', {
    projectId: a.projectId,
    tool: a.tool,
    args: a.args,
    autoMax: a.autoMax,
    approved: a.approved ?? false,
    cfg: a.cfg,
    globals: a.globals,
    providers: a.providers,
    workspace: a.workspace ?? '',
  });
}

/** 工具清单。桌面端以 Rust 的注册表为准 —— 那边才是真正会执行的那份 */
export async function toolsList(): Promise<RustToolSpec[]> {
  if (!isDesktop()) return [];
  return invoke<RustToolSpec[]>('tools_list', {});
}

/** Rust 侧 `ToolSpec` 的形状（比前端那份多 schema 与 runsIn） */
export interface RustToolSpec {
  id: ToolId;
  name: string;
  group: string;
  description: string;
  risk: Risk;
  runsIn: 'rust' | 'browser';
  status: ToolStatus;
  blockedBy?: string;
  schema: unknown;
}
