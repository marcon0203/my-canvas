import type { Modality, ModelRef, ModelSpec } from '@/domain/providers/model';
import { findModel } from '@/domain/providers/catalog';
import type { AgentId, Persona } from './roster';
import { PERSONAS, personaById } from './roster';
import { EXTRA_TOOLS, canRun, defaultTools, missingTools, type ToolId } from './tools';
import type { IntentKind } from './types';
import type { Risk } from './policy';

/**
 * 每个 Agent 单独一套配置：接哪些活、用什么模型、给哪些工具。
 * roster 里的 owns 只是**出厂默认**，这里才是运行时真正生效的那份。
 */
export interface AgentConfig {
  readonly agentId: AgentId;
  /** 这个 Agent 实际接的活儿（可增可减，不必等于 persona.owns） */
  readonly skills: readonly IntentKind[];
  readonly tools: readonly ToolId[];
  /**
   * 按模态各配一个模型。缺省走全局默认 —— 不是每个 Agent 都要单独指定。
   * 剪辑不需要文生图模型，给它配了也用不上。
   */
  readonly models: Partial<Record<Modality, ModelRef>>;
  /** 0–1，越高越发散。undefined 用厂商默认 */
  readonly temperature?: number;
  /**
   * 改写后的系统提示词。undefined = 用 persona.preamble。
   * 这是调 Agent「侧重方向」的主要手段 —— 比加几个技能有效得多。
   */
  readonly preamble?: string;
  /**
   * 自主度。决定这位 Agent 在拿到活儿之后**放手到什么程度**：
   * - 'propose'：出计划、出产物，等人采纳（默认，产物可审可撤）
   * - 'auto'：自己把能干的干完，只在要花钱或改定稿资产时停下来问
   * 接 Rig 之后这一档直接映射到 agent loop：propose 走 plan-then-execute 并在
   * 执行前交回人，auto 走完整循环。
   */
  readonly autonomy: Autonomy;
  /**
   * 自主执行时最多允许到哪一档风险。超过的照样停下来等人点头。
   * 「自主」省的是点采纳的手，不是取消把关。
   */
  readonly autoMax?: Risk;
  readonly enabled: boolean;
}

export type Autonomy = 'propose' | 'auto';

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  propose: '先出方案',
  auto: '自主执行',
};

export const AUTONOMY_HINT: Record<Autonomy, string> = {
  propose: '出计划和产物，等你点采纳才写进项目',
  auto: '能干的自己干完，只在要花钱或动定稿资产时停下来问',
};

export function defaultConfig(p: Persona): AgentConfig {
  const tools = new Set<ToolId>(defaultTools(p.owns));
  for (const t of EXTRA_TOOLS[p.id] ?? []) tools.add(t);
  return {
    agentId: p.id,
    skills: [...p.owns],
    tools: [...tools],
    models: {},
    autonomy: 'propose',
    enabled: true,
  };
}

/** 这位 Agent 实际生效的系统提示词 */
export const preambleOf = (cfg: AgentConfig | undefined, p: Persona): string =>
  cfg?.preamble?.trim() || p.preamble;

export const defaultConfigs = (): Record<AgentId, AgentConfig> =>
  Object.fromEntries(PERSONAS.map((p) => [p.id, defaultConfig(p)])) as Record<AgentId, AgentConfig>;

/** 模态的规范顺序。界面各处都按它排，免得同一个 Agent 换个页面顺序就变 */
export const MODALITY_ORDER: readonly Modality[] = ['text', 'image', 'video'];

/**
 * 这个 Agent 实际会用到哪些模态 —— 界面只让它配这几个，别给剪辑配文生图。
 * **按规范顺序返回**，不按工具的遍历顺序：后者会让「文本、视频、图片」
 * 这种顺序出现在界面上，取决于用户先勾了哪个工具。
 */
export function neededModalities(cfg: AgentConfig): Modality[] {
  const out = new Set<Modality>(['text']);   // 对话本身就要文本模型
  for (const t of cfg.tools) {
    if (t === 'image.generate') out.add('image');
    if (t === 'video.generate') out.add('video');
  }
  return MODALITY_ORDER.filter((m) => out.has(m));
}

/** 取这个 Agent 在某模态下用的模型：自己配的优先，否则用全局默认 */
export const modelFor = (
  cfg: AgentConfig | undefined,
  modality: Modality,
  fallback: Partial<Record<Modality, ModelRef>>,
): ModelRef | undefined => cfg?.models[modality] ?? fallback[modality];

/* ---------------- 校验：配出来的东西得真能跑 ---------------- */

export type IssueLevel = 'error' | 'warn';

export interface ConfigIssue {
  readonly level: IssueLevel;
  readonly text: string;
}

/**
 * 逐条查配置是否自洽。这里只报问题，不自动改 ——
 * 悄悄纠正用户的配置比报错更糟。
 */
export function checkConfig(
  cfg: AgentConfig,
  globals: Partial<Record<Modality, ModelRef>>,
  extraModels: readonly ModelSpec[] = [],
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const p = personaById(cfg.agentId);

  if (!cfg.enabled) return [{ level: 'warn', text: `${p.name}已停用，它的活儿不会有人接` }];

  // 技能缺工具
  for (const k of cfg.skills) {
    const miss = missingTools(cfg.tools, k);
    if (miss.length) {
      out.push({ level: 'error', text: `接了「${k}」却没给工具：缺 ${miss.join('、')}` });
    }
  }

  // 模态缺模型
  for (const m of neededModalities(cfg)) {
    const ref = modelFor(cfg, m, globals);
    if (!ref) {
      out.push({ level: 'error', text: `需要${m === 'text' ? '文本' : m === 'image' ? '图片' : '视频'}模型，但没配也没有全局默认` });
      continue;
    }
    const spec = findModel(ref, extraModels);
    if (!spec) {
      out.push({ level: 'error', text: `配的模型 ${ref.provider}/${ref.model} 在目录里找不到 —— 厂商删了或 id 变了` });
    } else if (spec.modality !== m) {
      out.push({ level: 'error', text: `${spec.name} 是${spec.modality}模型，配到${m}上用不了` });
    }
  }

  // 工具调用能力：接了活儿但模型不支持 function calling，只能靠提示词硬来
  const textRef = modelFor(cfg, 'text', globals);
  const textSpec = findModel(textRef, extraModels);
  if (textSpec && !textSpec.caps.tools && cfg.skills.some((k) => k !== 'chat')) {
    out.push({ level: 'warn', text: `${textSpec.name} 不支持工具调用，复杂任务的稳定性会差一些` });
  }

  return out;
}

/** 全班底的问题汇总 */
export function checkAll(
  configs: Record<AgentId, AgentConfig>,
  globals: Partial<Record<Modality, ModelRef>>,
  extraModels: readonly ModelSpec[] = [],
): Record<AgentId, ConfigIssue[]> {
  return Object.fromEntries(
    PERSONAS.map((p) => [p.id, checkConfig(configs[p.id] ?? defaultConfig(p), globals, extraModels)]),
  ) as Record<AgentId, ConfigIssue[]>;
}

/** 某个 Agent 现在还接不接得了这件活（工具被勾掉就接不了） */
export const configCanRun = (cfg: AgentConfig, kind: IntentKind): boolean =>
  cfg.enabled && cfg.skills.includes(kind) && canRun(cfg.tools, kind);

/* ---------------- 与班底分工的衔接 ---------------- */

/**
 * 按**配置后**的分工找接手人。
 * roster 的 owns 是出厂默认；用户把某件活儿挪给别的 Agent 之后，转交要跟着走。
 * 找不到（活儿被所有人取消了）返回 undefined —— 由调用方说清楚「这活没人接」。
 */
export function ownerOfConfigured(
  kind: IntentKind,
  configs: Record<AgentId, AgentConfig>,
): AgentId | undefined {
  if (kind === 'chat') return undefined;
  const hit = PERSONAS.find((p) => {
    const c = configs[p.id];
    return c && c.enabled && c.skills.includes(kind) && canRun(c.tools, kind);
  });
  return hit?.id;
}

/** 当班的接不接得了 —— 以配置为准，不看 roster */
export function canHandleConfigured(
  agentId: AgentId,
  kind: IntentKind,
  configs: Record<AgentId, AgentConfig>,
): boolean {
  const c = configs[agentId];
  if (!c) return kind === 'chat';
  return kind === 'chat' || (c.enabled && c.skills.includes(kind) && canRun(c.tools, kind));
}
