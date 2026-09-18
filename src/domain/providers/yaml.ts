import { CAPS_OF, MODALITIES, defaultCaps } from './model';
import type { Modality, ModelCaps, ModelSpec, ProviderId } from './model';

/**
 * `<workspace>/providers/<id>.yaml` ↔ `ModelSpec` 的换算。
 *
 * 放在 domain 里而不是 store 里：这是纯换算，没有 IO 也没有状态，
 * 而且两处要用 —— store（读写那些文件）和升级搬运（把旧的 providers.json
 * 搬成一家一个文件）。
 */

/** YAML 里模型清单的一项。与 Rust 侧 `provfile::ModelFull` 同形 */
export interface YamlModel {
  id: string;
  name?: string;
  context?: number;
  note?: string;
  caps?: string[];
}

/**
 * YAML 里的 caps → `ModelSpec.caps`。
 *
 * **`undefined` 与 `[]` 不是一件事**：`undefined` 是「文件里没写」，按 modality
 * 给一组默认值；`[]` 是「明确都不支持」。混成一件事的话，手写一份最简的文件
 * 就等于把所有能力都关掉，而 Agent 配置页会说这个模型不支持 function calling
 * —— 那是假的。
 *
 * 另外要**按 modality 过滤**：手写的文件里可能给一个文本模型写了 `refImage`，
 * 放过去同样会让配置页的检查说谎。
 */
export function capsOf(m: Modality, caps: string[] | undefined): ModelCaps {
  const allowed = new Set<string>(CAPS_OF[m].map((c) => c.k));
  const keys = caps === undefined
    ? Object.entries(defaultCaps(m)).filter(([, v]) => v).map(([k]) => k)
    : caps;
  return Object.fromEntries(keys.filter((k) => allowed.has(k)).map((k) => [k, true]));
}

/**
 * YAML 里的一项 → ModelSpec。
 *
 * **协议由 modality 决定，不存在文件里**：文本走 OpenAI 兼容的
 * /chat/completions，出图出视频走各家自有的异步任务接口。让用户在文件里写
 * 协议只会写错，而写错了要到发请求时才炸。
 */
export const toSpec = (provider: ProviderId, modality: Modality, y: YamlModel): ModelSpec => ({
  id: y.id,
  name: y.name?.trim() || y.id,
  provider,
  modality,
  protocol: modality === 'text' ? 'openai-chat' : 'async-task',
  caps: capsOf(modality, y.caps),
  ...(y.context ? { context: y.context } : {}),
  ...(y.note ? { note: y.note } : {}),
});

/**
 * ModelSpec → YAML 里的一项。
 *
 * `caps` **明确写出来**（哪怕是空列表）：这一份是界面存下去的，它知道用户
 * 勾了哪几个。不写的话下次读回来会被当成「没说」，按默认值填上几个
 * 用户刚取消掉的能力。
 *
 * 名字与 id 一样时不写 —— 那等于没写，Rust 侧会把它存成 `- <id>` 那种简写。
 */
export const toYaml = (m: ModelSpec): YamlModel => ({
  id: m.id,
  ...(m.name && m.name !== m.id ? { name: m.name } : {}),
  ...(m.context ? { context: m.context } : {}),
  ...(m.note ? { note: m.note } : {}),
  caps: Object.entries(m.caps).filter(([, v]) => v).map(([k]) => k),
});

/** 某一家某一类的模型，写成 YAML 那串 */
export const groupOf = (list: readonly ModelSpec[], m: Modality): YamlModel[] =>
  list.filter((x) => x.modality === m).map(toYaml);

/** 一家的全部模型 → 四组，按 modality 分。写整份文件时用 */
export const groupsOf = (list: readonly ModelSpec[]): Record<Modality, YamlModel[]> =>
  Object.fromEntries(MODALITIES.map((m) => [m, groupOf(list, m)])) as Record<Modality, YamlModel[]>;
