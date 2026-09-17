import type { Modality, ModelRef, ModelSpec, ProviderId, ProviderSpec } from './model';

/**
 * **支持哪些厂商**的清单 —— 不是模型清单。
 *
 * 这里只登记「这个应用认得哪几家、默认端点是什么、去哪儿拿 key」。
 * **一个模型都不预设**：模型 id 在国内变得太快，预设一份只会过期，
 * 而过期的默认值比没有默认值更糟 —— 用户会以为它能用，直到真跑起来才报错。
 *
 * 所以模型全部由用户在「新增供应商」之后自己加。`findModel` 只查用户加的那些。
 *
 * 文本接口这几家都是 OpenAI 兼容，共用一个适配器；
 * 图片/视频是各家自有的异步任务接口，见 Rust 侧 generate::adapters。
 */
export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: 'volcengine', name: '火山方舟', en: 'Volcengine Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    console: 'https://console.volcengine.com/ark',
    docs: 'https://www.volcengine.com/docs/82379',
  },
  {
    id: 'deepseek', name: 'DeepSeek', en: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    console: 'https://platform.deepseek.com/api_keys',
    docs: 'https://api-docs.deepseek.com',
  },
  {
    id: 'zhipu', name: '智谱 GLM', en: 'Zhipu BigModel',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    console: 'https://open.bigmodel.cn/usercenter/apikeys',
    docs: 'https://open.bigmodel.cn/dev/api',
  },
  {
    id: 'bailian', name: '阿里百炼', en: 'Alibaba Model Studio',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    console: 'https://bailian.console.aliyun.com',
    docs: 'https://help.aliyun.com/zh/model-studio',
  },
  {
    id: 'hunyuan', name: '腾讯混元', en: 'Tencent Hunyuan',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    console: 'https://console.cloud.tencent.com/hunyuan',
    docs: 'https://cloud.tencent.com/document/product/1729',
  },
  {
    id: 'moonshot', name: '月之暗面', en: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    console: 'https://platform.moonshot.cn/console/api-keys',
    docs: 'https://platform.moonshot.cn/docs',
  },
  {
    id: 'custom', name: '自定义端点', en: 'OpenAI-compatible',
    // 端点与模型全靠用户填 —— 自建网关、Ollama、公司内网代理都走这条
    baseUrl: '',
    userDefined: true,
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export const providerOf = (id: ProviderId): ProviderSpec | undefined => BY_ID.get(id);

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
