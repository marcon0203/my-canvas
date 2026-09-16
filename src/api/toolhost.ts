/**
 * 浏览器侧的工具执行。
 *
 * 大多数工具在 Rust 跑，但有几件 Rust 干不了 —— 布光台是 WebGL，只有浏览器
 * 里有 GPU 上下文。这类工具 Rust 的 `dispatch` 会返回 `elsewhere`，
 * 由这里接着执行，再把结果交回去。
 *
 * **闸门仍然在 Rust 那一侧先过**：`elsewhere` 是过完闸门之后才可能出现的
 * 结果。所以这里不用也不该再判一次权限 —— 两处判同一件事，迟早有一处忘了改。
 */

import type { Shot } from '@/domain/shots/model';

export interface LocalToolResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** 浏览器能执行的工具。Rust 侧 `runsIn: 'browser'` 的那些 */
export type LocalToolId = 'stage.render';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

const handlers = new Map<LocalToolId, Handler>();

/**
 * 注册一个只有浏览器能干的工具。
 *
 * 由持有那份能力的界面自己注册（布光台在挂载时注册它的离屏渲染），
 * 而不是在这里 import 一个 3D 组件 —— 那会把整个 three.js 拖进所有页面的包里。
 */
export function registerLocalTool(id: LocalToolId, fn: Handler): () => void {
  handlers.set(id, fn);
  return () => { if (handlers.get(id) === fn) handlers.delete(id); };
}

export const hasLocalTool = (id: string): id is LocalToolId =>
  handlers.has(id as LocalToolId);

/**
 * 执行一个浏览器侧工具。
 *
 * 没注册时**如实说没注册**，不要返回一个假结果 —— 布光台没打开过就渲不了图，
 * 那是真的干不了，不是「渲出来一张空的」。
 */
export async function runLocalTool(
  id: string,
  args: Record<string, unknown>,
): Promise<LocalToolResult> {
  const fn = handlers.get(id as LocalToolId);
  if (!fn) {
    return { ok: false, error: `「${id}」要在界面里执行，但现在没有哪个页面提供它 —— 打开分镜页的布光台再试` };
  }
  try {
    return { ok: true, value: await fn(args) };
  } catch (e) {
    return { ok: false, error: String((e as { message?: string })?.message ?? e) };
  }
}

/** 给布光台用：把一个 shot 渲成参考图的签名 */
export type StageRenderFn = (shot: Shot) => Promise<string>;
