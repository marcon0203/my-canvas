/**
 * 自动落盘：项目 store 一变就写回工作空间。
 *
 * 为什么不做「保存」按钮：这个应用里改动来自 Agent 采纳产物、拖机位、判定镜头，
 * 密集且零碎，让人记得按保存是把系统的问题推给用户。
 *
 * 两个必须注意的点：
 * - **注入期间不能写回**。hydrate 是「读进来」，那一刻 store 刚变，
 *   若触发写盘就会把刚读到的内容原样写一遍 —— 空项目更糟，会把盘上的数据清掉。
 * - 攒一下再写。一次拖拽能产生几十次 set，每次都写盘既慢又伤盘。
 */

import { useProject } from '@/store/project';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { projectSave } from './workspace';
import { toBundleFrom } from './store';

const DEBOUNCE_MS = 800;

let timer: ReturnType<typeof setTimeout> | null = null;
let stop: (() => void) | null = null;

/** 当前该写哪个项目 —— 以 store 里「已注入的项目 ID」为准，不是 URL */
const targetId = () => useProject.getState().hydratedFor;

async function flush(): Promise<void> {
  const id = targetId();
  if (!id) return;
  const s = useProject.getState();
  const workspace = useSettings.getState().workspace;
  try {
    await projectSave(toBundleFrom(id, {
      proj: s.proj, ratio: s.ratio, style: s.style, stylePrompt: s.stylePrompt,
      styles: s.styles, credits: s.credits, budget: s.budget, usage: s.usage,
      acts: s.acts, blocks: s.blocks, assets: s.assets, shots: s.shots,
      timeline: s.timeline, subtitles: s.subtitles,
    }), workspace);
  } catch (e) {
    // 写不进去要让人知道 —— 静默失败等于数据在你不知情时丢了
    useUi.getState().toast(`保存失败：${String((e as { message?: string })?.message ?? e)}`);
  }
}

/** 装上监听。重复调用只会有一份 */
export function startAutosave(): () => void {
  stop?.();
  let lastId = targetId();
  const unsub = useProject.subscribe((s) => {
    // 切项目那一下是注入，不是用户改动
    if (s.hydratedFor !== lastId) { lastId = s.hydratedFor; return; }
    if (!s.hydratedFor) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
  });
  stop = () => {
    unsub();
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return stop;
}

/** 关窗/切项目前把攒着的那次写掉 */
export async function flushNow(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  await flush();
}
