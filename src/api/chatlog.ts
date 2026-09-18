import type { AgentMessage } from '@/domain/agent/types';
import type { Stage } from '@/domain/agent/pipeline';
import type { ProjectKind } from '@/domain/agent/pipeline';
import type { AgentId } from '@/domain/agent/roster';

/**
 * 会话的存档。
 *
 * 为什么不放进工作空间的项目文件里：**会话是界面状态，不是项目内容**。
 * 它里面有步骤卡、产物卡的采纳状态、工具调用的参数 —— 把这些塞进项目文件，
 * 项目格式就跟界面内部结构绑死了，而那个格式的约定是「人能直接改的 Markdown
 * 与 JSON」。所以放浏览器本地。
 *
 * 代价说清楚：**换台机器打开同一个项目，看不到这边的会话记录。**
 * 项目内容（大纲、剧本、分镜）在工作空间里，那些是跟着走的。
 */

/** 一次会话 */
export interface ChatSession {
  readonly id: string;
  /** 存档时间 */
  readonly at: number;
  /** 给人认的标题：第一句用户说的话 */
  readonly title: string;
  readonly messages: readonly AgentMessage[];
  readonly queue: readonly Stage[];
  readonly planTotal: number;
  readonly brief: string;
  readonly kind: ProjectKind;
  readonly agentId: AgentId;
}

/** 一个项目最多留几份存档。再多就把最旧的挤掉 —— 本地存储是有配额的 */
export const MAX_ARCHIVE = 10;

/**
 * 一次会话最多留多少条消息。
 *
 * 产物卡里带着预览行，一条消息可能几 KB；不设上限的话，跑几十轮就能把
 * localStorage 的配额撑爆，而配额爆掉是**静默失败**（写不进去，下次打开全没了）。
 * 留最近的，老的丢 —— 丢的那部分不是项目内容，项目内容在工作空间里。
 */
export const MAX_MESSAGES = 200;

/**
 * 存档 id。**不能只用时间戳** —— 同一毫秒内存两次（连点两下「新会话」，
 * 或者恢复时「先存当前再取旧的」）就会撞，撞了之后恢复会取错那一条。
 * 加一个进程内自增，同一毫秒也分得开。
 */
let seq = 0;
const nextId = () => `s${Date.now()}-${(seq += 1)}`;

const LIVE = (pid: string) => `studio.chat.live.${pid}`;
const ARCHIVE = (pid: string) => `studio.chat.archive.${pid}`;

/** 存储接口。测试里传一个假的，免得依赖真 localStorage */
export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const browser = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    // 隐私模式、禁用了站点数据、或者根本没有 window
    return null;
  }
};

function read<T>(store: Store | null, key: string, fallback: T): T {
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // 存的东西坏了（手改过、版本不兼容）。当成没有，不要让整个面板崩
    return fallback;
  }
}

function write(store: Store | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // 配额满或被禁。会话记录丢了是可以接受的，把界面搞崩不行
  }
}

/** 消息裁到上限：留最近的 */
export const trim = (m: readonly AgentMessage[]): AgentMessage[] =>
  m.length <= MAX_MESSAGES ? [...m] : m.slice(m.length - MAX_MESSAGES);

/** 标题取第一句用户说的话；一句都没有就用那条需求 */
export function titleOf(s: Pick<ChatSession, 'messages' | 'brief'>): string {
  const mine = s.messages.find((m) => m.who === 'me' && m.text.trim());
  const raw = (mine?.text ?? s.brief).trim();
  if (!raw) return '没说话的一次';
  return raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
}

export const loadLive = (pid: string, store: Store | null = browser()): ChatSession | null =>
  pid ? read<ChatSession | null>(store, LIVE(pid), null) : null;

export function saveLive(
  pid: string,
  s: Omit<ChatSession, 'id' | 'at' | 'title'>,
  store: Store | null = browser(),
): void {
  if (!pid) return;
  const messages = trim(s.messages);
  // 一条消息都没有就别占地方 —— 新建项目后什么都没说的情况最常见
  if (!messages.length) {
    store?.removeItem(LIVE(pid));
    return;
  }
  const full: ChatSession = {
    ...s,
    messages,
    id: 'live',
    at: Date.now(),
    title: titleOf({ messages, brief: s.brief }),
  };
  write(store, LIVE(pid), full);
}

export const listArchive = (pid: string, store: Store | null = browser()): ChatSession[] =>
  pid ? read<ChatSession[]>(store, ARCHIVE(pid), []) : [];

/**
 * 把一次会话存档。返回存档后的列表。
 *
 * 空会话不存 —— 点一下「新会话」就多一条空记录，历史很快就没法看了。
 */
export function archive(
  pid: string,
  s: Omit<ChatSession, 'id' | 'at' | 'title'>,
  store: Store | null = browser(),
): ChatSession[] {
  const messages = trim(s.messages);
  if (!pid || !messages.length) return listArchive(pid, store);
  const one: ChatSession = {
    ...s,
    messages,
    id: nextId(),
    at: Date.now(),
    title: titleOf({ messages, brief: s.brief }),
  };
  const next = [one, ...listArchive(pid, store)].slice(0, MAX_ARCHIVE);
  write(store, ARCHIVE(pid), next);
  return next;
}

/** 取出一份存档并从列表里移掉（恢复时用：它要变成当前会话） */
export function takeArchive(
  pid: string,
  id: string,
  store: Store | null = browser(),
): { session: ChatSession | undefined; rest: ChatSession[] } {
  const all = listArchive(pid, store);
  const session = all.find((s) => s.id === id);
  const rest = all.filter((s) => s.id !== id);
  if (session) write(store, ARCHIVE(pid), rest);
  return { session, rest };
}

export function dropArchive(pid: string, id: string, store: Store | null = browser()): ChatSession[] {
  const rest = listArchive(pid, store).filter((s) => s.id !== id);
  write(store, ARCHIVE(pid), rest);
  return rest;
}
