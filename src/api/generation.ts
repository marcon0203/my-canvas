import type { GenParams } from './schemas';

/**
 * 生成任务队列：提交 / 轮询 / 取消 / 去重。
 * 后端未接入时用本地定时器模拟同一套生命周期，接真实 API 时只换 transport。
 */

export type TaskStatus = 'queued' | 'running' | 'done' | 'cancelled';

export interface GenTask {
  id: string;
  params: GenParams;
  status: TaskStatus;
  progress: number;
  /** done 时的候选图 seed（真实后端是 URL 数组） */
  urls: string[];
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

export function submitGen(params: GenParams, onDone?: (t: GenTask) => void): GenTask {
  const dup = findRunning(params);
  if (dup) return dup;
  const id = `t${seq++}`;
  const task: GenTask = { id, params, status: 'running', progress: 0, urls: [] };
  tasks.set(id, task);
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

export function cancelGen(id: string): void {
  const t = tasks.get(id);
  if (!t) return;
  clearTimeout(timers.get(id));
  t.status = 'cancelled';
  emit();
}
