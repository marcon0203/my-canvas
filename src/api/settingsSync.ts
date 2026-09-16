/**
 * 设置 ↔ 工作空间。
 *
 * 配置落在 `<workspace>/config/*.json`，不进数据库也不只留在浏览器里 ——
 * 换台机器把工作空间拷过去，模型接入与 Agent 配置跟着走。
 *
 * **密钥不在其中**。providers.json 里只有端点、启用状态、自加的模型；
 * 密钥写在系统钥匙串，工作空间整个复制走也带不走。这是刻意的：
 * 用户会把这个目录放进网盘同步。
 */

import { useSettings } from '@/store/settings';
import { configLoad, configSave } from './workspace';
import type { ConfigName } from './workspace';

/** 工作空间路径本身不写进配置文件 —— 先有鸡还是先有蛋 */
type Snapshot = {
  providers: unknown;
  agents: unknown;
  app: { globalModels: unknown };
};

const pick = (): Snapshot => {
  const s = useSettings.getState();
  return { providers: s.providers, agents: s.agents, app: { globalModels: s.globalModels } };
};

let loading = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let last = '';

/** 从工作空间把配置读进 store。切换工作空间后也要再跑一次 */
export async function loadSettings(workspace: string): Promise<void> {
  loading = true;
  try {
    const [providers, agents, app] = await Promise.all([
      configLoad<Record<string, unknown>>('providers', workspace, {}),
      configLoad<Record<string, unknown>>('agents', workspace, {}),
      configLoad<{ globalModels?: unknown }>('app', workspace, {}),
    ]);
    useSettings.setState((s) => ({
      providers: (providers && Object.keys(providers).length ? providers : s.providers) as typeof s.providers,
      agents: (agents && Object.keys(agents).length ? { ...s.agents, ...agents } : s.agents) as typeof s.agents,
      globalModels: (app?.globalModels ?? s.globalModels) as typeof s.globalModels,
    }));
    last = JSON.stringify(pick());
  } finally {
    loading = false;
  }
}

/**
 * 装上监听：设置一变就写回工作空间。
 *
 * `loading` 期间不写 —— 否则刚读进来就原样写一遍，工作空间是空的时候
 * 更糟：会把 store 里的出厂默认当成用户配置写下去。
 */
export function startSettingsSync(): () => void {
  const unsub = useSettings.subscribe(() => {
    if (loading) return;
    const now = JSON.stringify(pick());
    if (now === last) return;      // 只是改了 workspace 路径之类，配置本身没动
    last = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const ws = useSettings.getState().workspace;
      const snap = pick();
      void Promise.all(([
        ['providers', snap.providers],
        ['agents', snap.agents],
        ['app', snap.app],
      ] as [ConfigName, unknown][]).map(([k, v]) => configSave(k, ws, v)));
    }, 600);
  });
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
