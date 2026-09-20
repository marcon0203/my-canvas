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
import { PROVIDERS, defaultModel, isBuiltinProvider, providerOf, specOf } from '@/domain/providers/catalog';
import { MODALITIES } from '@/domain/providers/model';
import { groupOf, toSpec } from '@/domain/providers/yaml';
import { maskHint, provs, type ProvView } from '@/api/desktop';

/**
 * 应用设置：厂商接入 + 每个 Agent 的配置。
 *
 * **桌面端的真相在磁盘上**：一家供应商一个 `<workspace>/providers/<id>.yaml`，
 * 端点、api key、模型清单全在那一个文件里。这个 store 里那份是它的**投影** ——
 * 每次改都同时写回文件，打开设置时再从文件读一遍对上。
 *
 * **明文不在这里。** api key 只有「用户刚打的那串往下传」这一个方向；
 * Rust 送回来的那份（`ProvView`）根本没有 apikey 字段，所以这里只可能有
 * 「配没配」和脱敏尾号。
 *
 * 浏览器里没有那些文件，`provs.*` 返回 null，于是只剩 localStorage 里这一份 ——
 * 设置界面上如实说明。
 */

export interface ProviderSetting {
  /** 用户改过的端点；空则用目录里的默认值 */
  readonly baseUrl?: string;
  /** 那家的 YAML 里有没有 apikey */
  readonly hasKey: boolean;
  /** 脱敏尾号，给人确认「是不是那把 key」 */
  readonly keyHint?: string;
  /** 用户自己加的模型（目录没跟上的新模型、自定义端点的模型） */
  readonly extraModels: readonly ModelSpec[];
  /** 停用：不出现在模型选择里 */
  readonly disabled?: boolean;
  /**
   * YAML 里写的名字。
   *
   * 内置那几家的名字来自目录，这个字段是给**自建的那几家**用的 ——
   * 用户往 `providers/` 里丢一个 `myvendor.yaml`，它叫什么只有那份文件
   * 知道。空着就用 id。
   */
  readonly name?: string;
}

export interface SettingsState {
  providers: Partial<Record<ProviderId, ProviderSetting>>;
  /**
   * 读不了的那几份 YAML：`[id, 为什么]`。
   *
   * **一份写坏的文件不该让设置页打不开** —— 手写 YAML 缩进差一格是常事。
   * 所以坏的那几家单独放这儿，界面上如实说是哪个文件、哪儿坏了。
   */
  badProviders: readonly [string, string][];
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
  /** 桌面端写进那家的 YAML；浏览器只记状态。两种情况都不在 store 里存明文 */
  setKey: (id: ProviderId, key: string) => void;
  clearKey: (id: ProviderId) => void;

  /**
   * 从磁盘上那些 YAML 读一遍，覆盖 store 里这份投影。
   * 启动时和打开设置时都要跑 —— `hasKey` 喂着「哪家能用」。
   */
  syncProviders: () => Promise<void>;
  /**
   * 接入一家厂商。**「有没有这条记录」就是「接没接入」** ——
   * 不另设一个 added 布尔值，那种设计迟早出现「记录在但 added=false」的中间态。
   */
  addProvider: (id: ProviderId, baseUrl?: string) => void;
  /** 移除一家 = 删那个 YAML 文件，端点、key、模型清单一起没 */
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

// 与 Rust 侧 provfile::hint_of 同一规则，见 api/desktop.ts
const KEY_HINT = maskHint;

/** 这次要写回哪个工作空间 */
const ws = () => useSettings.getState().workspace;

/** Rust 送来的那份 → store 里的形状 */
const toSetting = (v: ProvView): ProviderSetting => ({
  ...(v.baseUrl ? { baseUrl: v.baseUrl } : {}),
  ...(v.name ? { name: v.name } : {}),
  hasKey: v.hasKey,
  ...(v.keyHint ? { keyHint: v.keyHint } : {}),
  extraModels: MODALITIES.flatMap((m) =>
    v[m].map((y) => toSpec(v.id as ProviderId, m, y)),
  ),
  ...(v.enabled ? {} : { disabled: true }),
});


export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      providers: {},
      badProviders: [],
      globalModels: {},
      workspace: '',
      customAgents: [],
      agents: defaultConfigs(),

      /**
       * 改一项 = 本地先改 + 写回那个 YAML 文件。
       *
       * **先改本地再写文件**（乐观更新）：写文件是异步的，等它回来再改界面
       * 会让输入框有一下明显的卡顿。写失败的话下次打开设置会从文件读一遍对上，
       * 界面不会一直骗人。
       *
       * patch 里只给改的那一项 —— Rust 侧是读改写，没给的字段保持磁盘原样。
       * 所以改个端点不会顺带把 key 和模型清单重写一遍。
       */
      setBaseUrl: (id, url) => {
        set((s) => ({
          providers: { ...s.providers, [id]: { ...blank(s.providers[id]), baseUrl: url.trim() || undefined } },
        }));
        // 空串在 Rust 侧的意思是「清掉，用回内置默认」
        void provs.save(id, { baseUrl: url.trim() }, ws());
      },

      // 明文只往下传，不往回拿。回来的那份（ProvView）根本没有 apikey 字段
      setKey: (id, key) => {
        set((s) => ({
          providers: { ...s.providers, [id]: { ...blank(s.providers[id]), hasKey: true, keyHint: KEY_HINT(key) } },
        }));
        void provs.save(id, { apikey: key }, ws()).then((v) => {
          if (!v) return;       // 浏览器回落：没有文件可写，本地那份就是全部
          set((s) => ({
            providers: { ...s.providers, [id]: { ...blank(s.providers[id]), hasKey: v.hasKey, keyHint: v.keyHint } },
          }));
        });
      },
      clearKey: (id) => {
        set((s) => ({
          providers: { ...s.providers, [id]: { ...blank(s.providers[id]), hasKey: false, keyHint: undefined } },
        }));
        void provs.save(id, { apikey: '' }, ws());
      },

      /**
       * 从磁盘上那些 YAML 文件读一遍，覆盖 store 里这份投影。
       *
       * **这是一次目录扫描 + 几次文件读，不弹任何东西。** 上一版密钥在系统
       * 钥匙串里，而界面要显示尾号，于是这一步是「一家一次读明文」——
       * macOS 上每读一次弹一次登录密码，配了几家弹几次。
       *
       * 启动时和打开设置时都要跑：`hasKey` 喂着「哪家能用」，它不对的话，
       * 明明配好了的模型会被当成没配。
       */
      syncProviders: async () => {
        const got = await provs.list(ws());
        if (!got) return;       // 浏览器回落：没有那些文件，localStorage 那份就是全部
        set(() => {
          const next: Partial<Record<ProviderId, ProviderSetting>> = {};
          // **内置目录里没有的 id 也收**：往工作空间的 providers/ 里丢一份
          // YAML 就是新接一家，这本来就是「一家一个 YAML」的意思。
          // 原来这儿跳过未知 id（因为界面用的是 providerOf(id)! 这个非空
          // 断言），结果用户丢进去的文件不生效、也没有任何反馈。
          // 现在界面走 specOf，自建的按 YAML 里的名字和端点显示。
          for (const v of got.items) next[v.id] = toSetting(v);
          return { providers: next, badProviders: got.bad };
        });
      },

      addProvider: (id, baseUrl) => {
        if (useSettings.getState().providers[id]) return;   // 接入过了，别把用户填的覆盖掉
        set((s) => ({
          providers: {
            ...s.providers,
            [id]: { hasKey: false, extraModels: [], ...(baseUrl ? { baseUrl } : {}) },
          },
        }));
        // 建出那个文件。名字写进去，以后「丢个文件进去就是新接一家」用得上
        void provs.save(id, {
          ...(baseUrl ? { baseUrl } : {}),
          name: providerOf(id)?.name,
          enabled: true,
        }, ws());
      },

      removeProvider: (id) => {
        set((s) => {
          const next = { ...s.providers };
          delete next[id];
          return { providers: next };
        });
        // 删一家 = 删那个文件，key 和模型清单跟着一起没了
        void provs.remove(id, ws());
      },

      toggleProvider: (id, on) => {
        set((s) => ({
          providers: { ...s.providers, [id]: { ...blank(s.providers[id]), disabled: !on } },
        }));
        void provs.save(id, { enabled: on }, ws());
      },

      addModel: (id, m) => {
        const cur = blank(useSettings.getState().providers[id]);
        if (cur.extraModels.some((x) => x.id === m.id)) return;
        const list = [...cur.extraModels, m];
        set((s) => ({ providers: { ...s.providers, [id]: { ...blank(s.providers[id]), extraModels: list } } }));
        // 按类型整组替换：只送这一类，别的类不动
        void provs.save(id, { [m.modality]: groupOf(list, m.modality) }, ws());
      },
      removeModel: (id, modelId) => {
        const cur = blank(useSettings.getState().providers[id]);
        const gone = cur.extraModels.find((x) => x.id === modelId);
        const list = cur.extraModels.filter((x) => x.id !== modelId);
        set((s) => ({ providers: { ...s.providers, [id]: { ...blank(s.providers[id]), extraModels: list } } }));
        if (gone) void provs.save(id, { [gone.modality]: groupOf(list, gone.modality) }, ws());
      },

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
       * `badProviders` 不存 —— 它是「这一次读磁盘时哪几份文件坏了」，
       * 存下来的话用户把文件改好了，那条报错还会跟着他到下次启动。
       *
       * `providers` 在桌面端也是投影（启动时 `syncProviders` 会覆盖），
       * 但浏览器里它就是全部，所以得存。
       */
      partialize: (s) => {
        const { badProviders: _bad, ...rest } = s;
        return rest as SettingsState;
      },
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
  s.providers[id]?.baseUrl || specOf(id, s.providers[id]).baseUrl || '';

/**
 * 已接入的厂商，顺序按目录。
 *
 * **「有没有这条记录」就是「接没接入」** —— 不另设一个 added 布尔值，
 * 那种设计迟早出现「记录在但 added=false」这种说不清的中间态。
 */
export function addedProviders(s: SettingsState): ProviderId[] {
  const builtin = PROVIDERS.map((p) => p.id).filter((id) => !!s.providers[id]);
  // 自建的排在内置之后，各自按 id 排 —— 目录的顺序是有讲究的（常用的在前），
  // 自建的没有这个信息，按名字排至少是稳定的
  const custom = Object.keys(s.providers)
    .filter((id) => !isBuiltinProvider(id))
    .sort();
  return [...builtin, ...custom];
}

/** 可用的厂商：接入了、配了 key、没停用。自定义端点还得填了 baseUrl */
export function readyProviders(s: SettingsState): ProviderId[] {
  return (Object.keys(s.providers) as ProviderId[]).filter((id) => {
    const p = s.providers[id]!;
    if (!p.hasKey || p.disabled) return false;
    // 自建的必须自己填端点，没有端点根本发不出请求
    return specOf(id, p).userDefined ? !!p.baseUrl : true;
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
