import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentConfig } from '@/domain/agent/config';
import { defaultConfig, defaultConfigs } from '@/domain/agent/config';
import type { AgentId } from '@/domain/agent/roster';
import { personaById } from '@/domain/agent/roster';
import type { Modality, ModelRef, ModelSpec, ProviderId } from '@/domain/providers/model';
import { defaultModel, providerOf } from '@/domain/providers/catalog';
import { maskHint, vault } from '@/api/desktop';

/**
 * 应用设置：厂商接入 + 每个 Agent 的配置。
 *
 * **密钥不在这里。** 按桌面架构（docs/desktop-architecture.md），API Key 只进系统钥匙串，
 * 由 Rust 侧读写，前端永远拿不到明文 —— 这里只留「配没配」和脱敏尾号。
 * 当前是浏览器环境，keyStatus 由 mock 的 vault 维护；接 Tauri 后换成 invoke，结构不变。
 */

export interface ProviderSetting {
  /** 用户改过的端点；空则用目录里的默认值 */
  readonly baseUrl?: string;
  /** 密钥是否已写入钥匙串 */
  readonly hasKey: boolean;
  /** 脱敏尾号，给人确认「是不是那把 key」 */
  readonly keyHint?: string;
  /** 用户自己加的模型（目录没跟上的新模型、自定义端点的模型） */
  readonly extraModels: readonly ModelSpec[];
  /** 停用：不出现在模型选择里 */
  readonly disabled?: boolean;
}

export interface SettingsState {
  providers: Partial<Record<ProviderId, ProviderSetting>>;
  /** 没给 Agent 单独配时用的默认模型 */
  globalModels: Partial<Record<Modality, ModelRef>>;
  agents: Record<AgentId, AgentConfig>;

  setBaseUrl: (id: ProviderId, url: string) => void;
  /** 桌面端写系统钥匙串；浏览器只记状态。两种情况都不在 store 里存明文 */
  setKey: (id: ProviderId, key: string) => void;
  clearKey: (id: ProviderId) => void;
  /** 启动时与钥匙串对一遍 —— 换台机器打开，状态要跟着那台机器的钥匙串走 */
  syncKeys: () => void;
  toggleProvider: (id: ProviderId, on: boolean) => void;
  addModel: (id: ProviderId, m: ModelSpec) => void;
  removeModel: (id: ProviderId, modelId: string) => void;

  setGlobalModel: (m: Modality, ref: ModelRef | undefined) => void;
  patchAgent: (id: AgentId, patch: Partial<AgentConfig>) => void;
  resetAgent: (id: AgentId) => void;
}

// 与 Rust 侧 vault::hint_of 同一规则，见 api/desktop.ts
const KEY_HINT = maskHint;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      providers: {},
      globalModels: {},
      agents: defaultConfigs(),

      setBaseUrl: (id, url) => set((s) => ({
        providers: { ...s.providers, [id]: { ...blank(s.providers[id]), baseUrl: url.trim() || undefined } },
      })),

      // 明文交给桥接去写钥匙串，store 里只留状态与尾号
      setKey: (id, key) => {
        set((s) => ({
          providers: { ...s.providers, [id]: { ...blank(s.providers[id]), hasKey: true, keyHint: KEY_HINT(key) } },
        }));
        void vault.set(id, key).then((st) => set((s) => ({
          providers: { ...s.providers, [id]: { ...blank(s.providers[id]), hasKey: st.hasKey, keyHint: st.hint } },
        })));
      },
      clearKey: (id) => {
        set((s) => ({
          providers: { ...s.providers, [id]: { ...blank(s.providers[id]), hasKey: false, keyHint: undefined } },
        }));
        void vault.clear(id);
      },

      syncKeys: () => {
        const ids = Object.keys(useSettings.getState().providers) as ProviderId[];
        if (!ids.length) return;
        void vault.status(ids).then((list) => {
          if (!list.length) return;   // 浏览器回落：没有钥匙串可对
          set((s) => {
            const next = { ...s.providers };
            for (const st of list) {
              const id = st.provider as ProviderId;
              next[id] = { ...blank(next[id]), hasKey: st.hasKey, keyHint: st.hint };
            }
            return { providers: next };
          });
        });
      },
      toggleProvider: (id, on) => set((s) => ({
        providers: { ...s.providers, [id]: { ...blank(s.providers[id]), disabled: !on } },
      })),

      addModel: (id, m) => set((s) => {
        const cur = blank(s.providers[id]);
        if (cur.extraModels.some((x) => x.id === m.id)) return s;
        return { providers: { ...s.providers, [id]: { ...cur, extraModels: [...cur.extraModels, m] } } };
      }),
      removeModel: (id, modelId) => set((s) => {
        const cur = blank(s.providers[id]);
        return {
          providers: {
            ...s.providers,
            [id]: { ...cur, extraModels: cur.extraModels.filter((x) => x.id !== modelId) },
          },
        };
      }),

      setGlobalModel: (m, ref) => set((s) => {
        const next = { ...s.globalModels };
        if (ref) next[m] = ref; else delete next[m];
        return { globalModels: next };
      }),

      patchAgent: (id, patch) => set((s) => ({
        agents: { ...s.agents, [id]: { ...(s.agents[id] ?? defaultConfig(personaById(id))), ...patch } },
      })),
      resetAgent: (id) => set((s) => ({
        agents: { ...s.agents, [id]: defaultConfig(personaById(id)) },
      })),
    }),
    {
      name: 'studio.settings',
      version: 1,
      // 旧版本可能缺 agent 字段（班底加人了）—— 补上默认值，不整份丢弃
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { ...current, ...p, agents: { ...defaultConfigs(), ...(p.agents ?? {}) } };
      },
    },
  ),
);

/**
 * 未配置时返回**同一个**常量，不能每次新建对象 ——
 * 否则 useSettings(s => providerSetting(s, id)) 每次比较都不等，直接无限重渲染。
 */
const EMPTY_PROVIDER: ProviderSetting = Object.freeze({ hasKey: false, extraModels: Object.freeze([]) as readonly ModelSpec[] });
const blank = (s: ProviderSetting | undefined): ProviderSetting => s ?? EMPTY_PROVIDER;

/* ---------------- 选择器 ---------------- */

export const providerSetting = (s: SettingsState, id: ProviderId): ProviderSetting =>
  blank(s.providers[id]);

/** 实际用的端点：用户改过的优先 */
export const baseUrlOf = (s: SettingsState, id: ProviderId): string =>
  s.providers[id]?.baseUrl || providerOf(id)?.baseUrl || '';

/** 可用的厂商：配了 key 且没停用。自定义端点还得填了 baseUrl */
export function readyProviders(s: SettingsState): ProviderId[] {
  return (Object.keys(s.providers) as ProviderId[]).filter((id) => {
    const p = s.providers[id]!;
    if (!p.hasKey || p.disabled) return false;
    return providerOf(id)?.userDefined ? !!p.baseUrl : true;
  });
}

/** 用户自加的全部模型，拼进目录查询 */
export const extraModels = (s: SettingsState): ModelSpec[] =>
  Object.values(s.providers).flatMap((p) => (p?.extraModels ?? []) as ModelSpec[]);

/** 全局默认模型：没显式设过就按已配置的厂商挑一个 */
export function effectiveGlobals(s: SettingsState): Partial<Record<Modality, ModelRef>> {
  const ready = readyProviders(s);
  const extra = extraModels(s);
  const out: Partial<Record<Modality, ModelRef>> = {};
  for (const m of ['text', 'image', 'video'] as Modality[]) {
    out[m] = s.globalModels[m] ?? defaultModel(m, ready, extra);
  }
  return out;
}


/* ---------------- Hooks ----------------
 * 这几个派生值每次调用都会造新对象/新数组，直接丢进 useSettings(selector)
 * 会无限重渲染（项目里 allAssets 踩过同一个坑）。
 * 统一在这里按原始 slice memo 一次 —— providers / globalModels 的引用只在写入时变。
 */

export function useEffectiveGlobals(): Partial<Record<Modality, ModelRef>> {
  const providers = useSettings((s) => s.providers);
  const globalModels = useSettings((s) => s.globalModels);
  return useMemo(
    () => effectiveGlobals({ providers, globalModels } as SettingsState),
    [providers, globalModels],
  );
}

export function useExtraModels(): ModelSpec[] {
  const providers = useSettings((s) => s.providers);
  return useMemo(() => extraModels({ providers } as SettingsState), [providers]);
}

export function useReadyProviders(): ProviderId[] {
  const providers = useSettings((s) => s.providers);
  return useMemo(() => readyProviders({ providers } as SettingsState), [providers]);
}
