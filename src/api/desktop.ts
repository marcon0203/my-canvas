/**
 * 桌面端桥接。
 *
 * 同一份前端既跑在浏览器（开发、演示）也跑在 Tauri WebView（正式）：
 * `isDesktop()` 为假时全部回落到浏览器实现，界面代码不需要分支。
 *
 * 密钥相关的命令**只有桌面端有真实现** —— 浏览器里没有系统钥匙串，
 * 回落实现只记「配没配」，并且在设置界面里如实说明。
 */

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

export interface RunArgs {
  cfg: unknown;
  fallbackPreamble: string;
  globals: unknown;
  providers: unknown;
  input: OutlineInput;
}

/**
 * 起草大纲：桌面端走 IPC 流式通道。
 * 浏览器里没有实现 —— 调用方应先用 `isDesktop()` 判断，走 mock 那条路。
 */
export async function outlineDraft(args: RunArgs, onEvent: (e: RunEvent) => void): Promise<void> {
  const { invoke: call, Channel } = await import('@tauri-apps/api/core');
  const ch = new Channel<RunEvent>();
  ch.onmessage = onEvent;
  await call('agent_outline_draft', { ...args, onEvent: ch });
}
