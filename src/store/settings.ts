import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentConfig, AgentConfigs } from '@/domain/agent/config';
import { defaultConfig, defaultConfigs } from '@/domain/agent/config';
import { missingTools, type ToolId } from '@/domain/agent/tools';
import type { AgentId, Persona } from '@/domain/agent/roster';
import {
  BUILTIN_PERSONAS, copyOfPersona, makeCustomPersona, nextAgentId, personaById,
  setCustomPersonas, type NewAgent,
} from '@/domain/agent/roster';
import type { Modality, ModelRef, ModelSpec, ProviderId } from '@/domain/providers/model';
import { PROVIDERS, defaultModel, providerOf } from '@/domain/providers/catalog';
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
  /**
   * 工作空间根目录。空串 = 用默认的 `~/.hitv`。
   *
   * **路径本身不能存在工作空间里** —— 那是先有鸡还是先有蛋，所以它跟着
   * 其他设置一起持久化在前端，每次调用桌面端命令时传下去。
   */
  workspace: string;
  agents: AgentConfigs;
  /**
   * 用户自己建的 Agent。内置五位不在这里 —— 它们是常量，删不掉也不用存。
   *
   * 存的是整份 Persona（名字、图标、提示词、出厂认领的活儿），不是一个引用：
   * 这位 Agent 的「出厂默认」就是用户当时填的那份，「恢复默认」要能回到它。
   */
  customAgents: readonly Persona[];

  setBaseUrl: (id: ProviderId, url: string) => void;
  /** 桌面端写系统钥匙串；浏览器只记状态。两种情况都不在 store 里存明文 */
  setKey: (id: ProviderId, key: string) => void;
  clearKey: (id: ProviderId) => void;
  /** 启动时与钥匙串对一遍 —— 换台机器打开，状态要跟着那台机器的钥匙串走 */
  syncKeys: () => void;
  /**
   * 接入一家厂商。**「有没有这条记录」就是「接没接入」** ——
   * 不另设一个 added 布尔值，那种设计迟早出现「记录在但 added=false」的中间态。
   */
  addProvider: (id: ProviderId, baseUrl?: string) => void;
  /** 移除一家。连它下面的模型一起删；密钥单独清（在钥匙串里，不在这儿） */
  removeProvider: (id: ProviderId) => void;
  toggleProvider: (id: ProviderId, on: boolean) => void;
  addModel: (id: ProviderId, m: ModelSpec) => void;
  removeModel: (id: ProviderId, modelId: string) => void;

  setGlobalModel: (m: Modality, ref: ModelRef | undefined) => void;
  setWorkspace: (path: string) => void;
  patchAgent: (id: AgentId, patch: Partial<AgentConfig>) => void;
  resetAgent: (id: AgentId) => void;
  /** 新建一位。返回新的 id，界面拿它跳到详情 */
  addAgent: (a: NewAgent) => AgentId;
  /** 从某位复制一份（提示词、活儿、工具照搬）。返回新的 id */
  copyAgent: (from: AgentId, name?: string) => AgentId;
  /** 改自定义 Agent 的身份信息（名字、描述、图标）。内置的改不了 */
  patchPersona: (id: AgentId, patch: Partial<Pick<Persona, 'name' | 'tagline' | 'icon'>>) => void;
  /** 删一位自定义的。连它的配置一起删；它认领的活儿会变成没人接 */
  removeAgent: (id: AgentId) => void;
}

// 与 Rust 侧 vault::hint_of 同一规则，见 api/desktop.ts
const KEY_HINT = maskHint;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      providers: {},
      globalModels: {},
      workspace: '',
      customAgents: [],
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
      addProvider: (id, baseUrl) => set((s) => {
        if (s.providers[id]) return s;          // 已经接入过，别把用户填的覆盖掉
        return {
          providers: {
            ...s.providers,
            [id]: { hasKey: false, extraModels: [], ...(baseUrl ? { baseUrl } : {}) },
          },
        };
      }),

      removeProvider: (id) => set((s) => {
        const next = { ...s.providers };
        delete next[id];
        return { providers: next };
      }),

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

      setWorkspace: (workspace) => set({ workspace: workspace.trim() }),
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

      addAgent: (a) => {
        const id = nextAgentId(useSettings.getState().customAgents.map((p) => p.id));
        const p = makeCustomPersona(id, a);
        set((s) => ({
          customAgents: [...s.customAgents, p],
          agents: { ...s.agents, [id]: defaultConfig(p) },
        }));
        return id;
      },

      copyAgent: (from, name) => {
        const src = personaById(from);
        const id = nextAgentId(useSettings.getState().customAgents.map((p) => p.id));
        const p = copyOfPersona(src, id, name);
        set((s) => ({
          customAgents: [...s.customAgents, p],
          // 工具与模型也照搬：复制一份出来通常是为了「差不多这样，但改两句提示词」，
          // 让人把工具重勾一遍等于没复制
          agents: { ...s.agents, [id]: { ...(s.agents[from] ?? defaultConfig(src)), agentId: id } },
        }));
        return id;
      },

      patchPersona: (id, patch) => set((s) => ({
        customAgents: s.customAgents.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      })),

      removeAgent: (id) => set((s) => {
        // 内置五位删不掉：它们对应环节，删了那个环节就没人当班
        if (BUILTIN_PERSONAS.some((p) => p.id === id)) return s;
        const agents = { ...s.agents };
        delete agents[id];
        return { customAgents: s.customAgents.filter((p) => p.id !== id), agents };
      }),
    }),
    {
      name: 'studio.settings',
      version: 2,
      /**
       * 存过的配置要能跟上代码的变化。
       *
       * 两种情况：
       * - **班底加人了**：存的那份里缺某个 agent → 补默认值，不整份丢弃。
       * - **某件活儿需要的工具变了**：比如「按节拍自动成片」以前要 file.export，
       *   后来改成 shot.write。存的那份里还是旧工具，于是这位 agent 接不了它
       *   认领的活儿，界面上就变成「没人接」。这不是用户的选择，是配置过期了，
       *   所以把缺的工具补回去。
       *
       * 补工具只补**它自己认领的活儿**要用的那些，不会顺带给它别的能力。
       */
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        // 先把存过的自定义 Agent 登记进班底，**再**算默认配置 ——
        // defaultConfigs 是按班底铺的，顺序反了的话新建的那几位第一次打开没有配置
        setCustomPersonas(p.customAgents ?? []);
        const agents = { ...defaultConfigs(), ...(p.agents ?? {}) };
        for (const [id, cfg] of Object.entries(agents) as [AgentId, AgentConfig][]) {
          const need = new Set<ToolId>(cfg.tools);
          for (const kind of cfg.skills) for (const t of missingTools(cfg.tools, kind)) need.add(t);
          if (need.size !== cfg.tools.length) agents[id] = { ...cfg, tools: [...need] };
        }
        return { ...current, ...p, agents };
      },
    },
  ),
);

/**
 * 把自定义 Agent 推给 roster。
 *
 * 方向是单向的：**store → roster**。反过来让 roster 去 import store 会成环
 * （store 本来就 import roster），而且会把一个纯数据模块变成要有运行时状态
 * 才能用的东西 —— domain 层的测试就得先造一个 store。
 *
 * 只在那份数组换了身份时才重建索引：subscribe 每次 set 都会调，
 * 而改一个端点不该顺带重建班底索引。
 */
let lastCustom = useSettings.getState().customAgents;
setCustomPersonas(lastCustom);
useSettings.subscribe((s) => {
  if (s.customAgents === lastCustom) return;
  lastCustom = s.customAgents;
  setCustomPersonas(lastCustom);
});

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

/**
 * 已接入的厂商，顺序按目录。
 *
 * **「有没有这条记录」就是「接没接入」** —— 不另设一个 added 布尔值，
 * 那种设计迟早出现「记录在但 added=false」这种说不清的中间态。
 */
export function addedProviders(s: SettingsState): ProviderId[] {
  return PROVIDERS.map((p) => p.id).filter((id) => !!s.providers[id]);
}

/** 可用的厂商：接入了、配了 key、没停用。自定义端点还得填了 baseUrl */
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
  for (const m of ['text', 'image', 'video', 'audio'] as Modality[]) {
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

export function useAddedProviders(): ProviderId[] {
  const providers = useSettings((s) => s.providers);
  return useMemo(() => addedProviders({ providers } as SettingsState), [providers]);
}
