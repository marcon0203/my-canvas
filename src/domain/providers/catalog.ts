import catalog from '@res/models/providers.json';
import type { Modality, ModelRef, ModelSpec, ProviderId, ProviderSpec } from './model';

/**
 * **支持哪些厂商**的清单 —— 不是模型清单。
 *
 * 内容不在这个文件里，在 `resources/models/providers.json`：Rust 侧
 * `conf/providers.rs` 编译期读的是同一份。以前两边各抄一份，注释写着
 * 「改一边要改另一边」—— 那种约定迟早失守，而端点对不上时报的错指不到原因。
 *
 * **一个模型都不预设**：模型 id 在国内变得太快，预设一份只会过期，
 * 而过期的默认值比没有默认值更糟 —— 用户会以为它能用，直到真跑起来才报错。
 * 所以模型全部由用户在「新增供应商」之后自己加，`findModel` 只查用户加的那些。
 *
 * 文本接口这几家都是 OpenAI 兼容，共用一个适配器；
 * 图片/视频是各家自有的异步任务接口，见 Rust 侧 generate::adapters。
 */

/** 代码里认得的厂商 id。清单里出现别的 id 说明两边脱节了，要当场炸 */
const KNOWN: readonly ProviderId[] = [
  'volcengine', 'deepseek', 'zhipu', 'bailian', 'hunyuan', 'moonshot', 'custom',
];

/**
 * 把 JSON 收成带 `ProviderId` 的类型。
 *
 * 不是随手 `as`：清单是外部文件，改它不会触发类型检查。加了一家却没在
 * `ProviderId` 里登记的话，界面能列出来、发请求时才发现没有适配器 ——
 * 那时候的报错指不到这儿。所以在加载时就对，对不上直接抛。
 */
const parse = (raw: typeof catalog.providers): ProviderSpec[] => raw.map((p) => {
  if (!(KNOWN as readonly string[]).includes(p.id)) {
    throw new Error(`providers.json 里的 ${p.id} 在代码里没登记：要先加进 ProviderId，再配适配器`);
  }
  return {
    id: p.id as ProviderId,
    name: p.name,
    en: p.en,
    baseUrl: p.baseUrl,
    ...('console' in p && p.console ? { console: p.console } : {}),
    ...('docs' in p && p.docs ? { docs: p.docs } : {}),
    ...('userDefined' in p && p.userDefined ? { userDefined: true as const } : {}),
  };
});

export const PROVIDERS: readonly ProviderSpec[] = parse(catalog.providers);

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/** 内置目录里的那一家。自建的查不到 —— 要连自建的一起查用 `specOf` */
export const providerOf = (id: ProviderId): ProviderSpec | undefined => BY_ID.get(id);

/** 这家是不是内置目录里的 */
export const isBuiltinProvider = (id: ProviderId): boolean => BY_ID.has(id);

/**
 * 一家供应商的展示信息，**内置和自建都能查**。
 *
 * 自建的（工作空间 `providers/` 里那个 YAML）没有目录条目，就按 YAML 里
 * 写的名字和端点凑一份出来。名字空着时用 id —— 不替用户编一个名字。
 *
 * 界面一律用这个，不要用 `providerOf(id)!`：那个非空断言是原来「丢个文件
 * 进去就是新接一家」做不了的根因。
 */
export function specOf(
  id: ProviderId,
  stored?: { readonly name?: string; readonly baseUrl?: string },
): ProviderSpec {
  const builtin = BY_ID.get(id);
  if (builtin) return builtin;
  return {
    id,
    name: stored?.name?.trim() || id,
    en: '',
    baseUrl: stored?.baseUrl ?? '',
    // 自建的一律算「要自己填端点」：没有端点它跑不起来，
    // 而 readyProviders 就是靠这个标记去要求 baseUrl 的
    userDefined: true,
  };
}

/**
 * 查一个模型。**只查用户自己加的** —— 没有内置模型可查。
 *
 * 查不到返回 undefined，调用方要如实说「这个模型不在列表里」，
 * 不要回落到某个「差不多的」：那会让人以为配好了，跑起来才发现不是那个模型。
 */
export function findModel(
  ref: ModelRef | undefined,
  models: readonly ModelSpec[] = [],
): ModelSpec | undefined {
  if (!ref) return undefined;
  return models.find((m) => m.provider === ref.provider && m.id === ref.model);
}

/** 某个模态下可选的模型。全部来自用户添加 */
export function modelsOfModality(
  modality: Modality,
  models: readonly ModelSpec[] = [],
): ModelSpec[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    if (m.modality !== modality) return false;
    const k = `${m.provider}/${m.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 不指定时用哪个模型：在**已接入厂商**里挑第一个能用的。
 *
 * 一个都没有就返回 undefined —— 界面要说「还没有可用模型」，
 * 而不是编一个出来。这是整个改动的要点：**没配过的东西不该有默认值**。
 */
export function defaultModel(
  modality: Modality,
  ready: readonly ProviderId[] = [],
  models: readonly ModelSpec[] = [],
): ModelRef | undefined {
  const list = modelsOfModality(modality, models);
  const hit = list.find((m) => ready.includes(m.provider)) ?? list[0];
  return hit ? { provider: hit.provider, model: hit.id } : undefined;
}
