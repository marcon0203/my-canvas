/**
 * 设置 ↔ 工作空间。
 *
 * 配置落在 `<workspace>/config/*.json`，不进数据库也不只留在浏览器里 ——
 * 换台机器把工作空间拷过去，模型接入与 Agent 配置跟着走。
 *
 * **供应商配置不走这里。** 它一家一个 `<workspace>/providers/<id>.yaml`，
 * 端点、api key、模型清单都在那儿，由 store 的 `syncProviders` /
 * `provs.save` 直接读写（见 store/settings.ts）。
 *
 * 所以这里只剩两样：Agent 配置和全局默认模型。原来 providers 也在这儿，
 * 那份 `providers.json` 现在只在「从旧版本升上来」时被读一次，见 `loadSettings`。
 */

import { useSettings } from '@/store/settings';
import { provs } from './desktop';
import { groupsOf } from '@/domain/providers/yaml';
import type { ModelSpec } from '@/domain/providers/model';
import { configLoad, configSave } from './workspace';
import type { ConfigName } from './workspace';

/** 工作空间路径本身不写进配置文件 —— 先有鸡还是先有蛋 */
type Snapshot = {
  agents: unknown;
  app: { globalModels: unknown };
};

const pick = (): Snapshot => {
  const s = useSettings.getState();
  return { agents: s.agents, app: { globalModels: s.globalModels } };
};

let loading = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let last = '';

/** 从工作空间把配置读进 store。切换工作空间后也要再跑一次 */
export async function loadSettings(workspace: string): Promise<void> {
  loading = true;
  try {
    const [agents, app] = await Promise.all([
      configLoad<Record<string, unknown>>('agents', workspace, {}),
      configLoad<{ globalModels?: unknown }>('app', workspace, {}),
    ]);
    useSettings.setState((s) => ({
      agents: (agents && Object.keys(agents).length ? { ...s.agents, ...agents } : s.agents) as typeof s.agents,
      globalModels: (app?.globalModels ?? s.globalModels) as typeof s.globalModels,
    }));
    last = JSON.stringify(pick());
  } finally {
    loading = false;
  }
  // 供应商配置在那之后单独读（一家一个 YAML）。**放在 loading 之外** ——
  // 它不走这套「store 变了就写回」的机制，压在 loading 里没有意义
  await migrateProviders(workspace);
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

/* ---------------- 从旧版本搬过来 ---------------- */

/** 旧 `providers.json` 里一家的形状。只列搬得动的那几项 */
type OldProvider = {
  baseUrl?: string;
  disabled?: boolean;
  extraModels?: ModelSpec[];
};

/**
 * 把旧的 `<workspace>/config/providers.json` 搬成一家一个 YAML。
 *
 * **只建还不存在的那几个文件**，所以跑多少次都一样；搬完不删旧文件 ——
 * 删掉用户就没法回退到旧版本了，而它留着也不影响什么。
 *
 * **api key 搬不过来**：旧版本它在系统钥匙串里，读一次就弹一次系统密码
 * （那正是这次要改掉的事）。所以搬过来的那几家是「端点和模型清单都在，
 * 但没有 key」—— 重填一次 key 就行。旧文件里那个 `hasKey: true` 也不搬：
 * 界面说「已配置」而实际没有 key，比如实说没配更难查。
 */
async function migrateProviders(workspace: string): Promise<void> {
  const got = await provs.list(workspace);
  if (!got) return;                       // 浏览器：没有那些文件，也没什么要搬
  const have = new Set(got.items.map((v) => v.id));
  const old = await configLoad<Record<string, OldProvider>>('providers', workspace, {});
  for (const [id, v] of Object.entries(old ?? {})) {
    if (!v || have.has(id)) continue;
    await provs.save(id, {
      ...(v.baseUrl ? { baseUrl: v.baseUrl } : {}),
      enabled: !v.disabled,
      ...groupsOf(v.extraModels ?? []),
    }, workspace);
  }
}
