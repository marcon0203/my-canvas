import type { GenParams } from './schemas';

/**
 * 生成任务队列：提交 / 轮询 / 取消 / 去重。
 * 后端未接入时用本地定时器模拟同一套生命周期，接真实 API 时只换 transport。
 */

/**
 * `failed` 之前是缺的：这个队列只有 `done` 一个终态，所以界面上没有任何
 * 地方能显示「这一镜没跑出来」。真实的失败来自厂商（余额不足、审核拒绝、
 * 超时），Rust 侧已经分好类，前端得有地方接。
 */
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface GenTask {
  id: string;
  params: GenParams;
  status: TaskStatus;
  progress: number;
  /** done 时的候选图 seed（真实后端是 URL 数组） */
  urls: string[];
  /** failed 时的原因，原话给人看 */
  error?: string;
}

const tasks = new Map<string, GenTask>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
export const subscribeTasks = (l: () => void): (() => void) => (listeners.add(l), () => listeners.delete(l));
export const getTask = (id: string): GenTask | undefined => tasks.get(id);

let seq = 1;

/** 同参数任务去重：同一镜头在跑就不重复提交 */
export function findRunning(params: GenParams): GenTask | undefined {
  const key = JSON.stringify(params);
  return [...tasks.values()].find((t) => (t.status === 'queued' || t.status === 'running')
    && JSON.stringify(t.params) === key);
}

export function submitGen(
  params: GenParams,
  onDone?: (t: GenTask) => void,
  onFail?: (t: GenTask) => void,
): GenTask {
  const dup = findRunning(params);
  if (dup) return dup;
  const id = `t${seq++}`;
  const task: GenTask = { id, params, status: 'running', progress: 0, urls: [] };
  tasks.set(id, task);

  // 提交前的校验与 Rust 侧 gen_body 同一条规则：空提示词不拿去花钱。
  // 浏览器里这是**唯一**会失败的路径 —— 不做随机失败，演示时随机报错只会
  // 让人以为是 bug
  const why = paramError(params);
  if (why) {
    task.status = 'failed';
    task.error = why;
    emit();
    // 异步回调，让调用方先拿到 task 再收到失败（与真实提交的时序一致）
    setTimeout(() => onFail?.(task), 0);
    return task;
  }
  emit();
  const tick = (remaining: number) => {
    const step = 180 + Math.random() * 160;
    timers.set(id, setTimeout(() => {
      const t = tasks.get(id)!;
      if (t.status === 'cancelled') return;
      if (remaining <= step) {
        t.status = 'done';
        t.progress = 1;
        t.urls = Array.from({ length: t.params.batch }, (_, i) => `${t.params.prompt}#${i}`);
        emit();
        onDone?.(t);
      } else {
        t.progress = Math.min(0.95, t.progress + step / 1600);
        emit();
        tick(remaining - step);
      }
    }, step));
  };
  tick(1100 + Math.random() * 500);
  return task;
}

/** 提交前能判出来的错。判不出来的（余额、审核、超时）只有真实后端知道 */
function paramError(p: GenParams): string | undefined {
  if (!p.prompt.trim()) return '提示词是空的，没发出去 —— 先写这一镜的内容，或让摄影指导补写';
  if (p.batch < 1) return `一次要出几版？给的是 ${p.batch}`;
  return undefined;
}

/** 外部（真实后端、Rust 侧）判定失败时调这个 */
export function failGen(id: string, why: string): void {
  const t = tasks.get(id);
  if (!t || t.status === 'done' || t.status === 'cancelled') return;
  clearTimeout(timers.get(id));
  t.status = 'failed';
  t.error = why;
  emit();
}

export function cancelGen(id: string): void {
  const t = tasks.get(id);
  if (!t) return;
  clearTimeout(timers.get(id));
  t.status = 'cancelled';
  emit();
}
