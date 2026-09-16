import type { Modality, ModelRef, ModelSpec, ProviderId, ProviderSpec } from './model';

/**
 * 内置厂商目录。
 *
 * ⚠️ 这是**种子，不是权威清单**。模型 id 和端点在国内变得很快，
 * 所以 baseUrl 与模型清单在设置里都可改、可增删。
 * 代码里任何地方都不要假设某个 id 一定存在 —— 一律经 findModel 查。
 *
 * 文本接口六家都是 OpenAI 兼容（protocol: 'openai-chat'），共用一个适配器；
 * 图片/视频各家是自有的异步任务接口（'async-task'），按家适配。
 */

const text = (
  id: string, name: string, provider: ProviderId,
  caps: ModelSpec['caps'], context?: number, note?: string,
): ModelSpec => ({ id, name, provider, modality: 'text', protocol: 'openai-chat', caps, context, note });

const visual = (
  id: string, name: string, provider: ProviderId, modality: Modality,
  caps: ModelSpec['caps'] = { refImage: true }, note?: string,
): ModelSpec => ({ id, name, provider, modality, protocol: 'async-task', caps, note });

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: 'volcengine', name: '火山方舟', en: 'Volcengine Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    console: 'https://console.volcengine.com/ark',
    docs: 'https://docs.volcengine.com/docs/82379/1928261',
    models: [
      text('doubao-pro-32k', '豆包 Pro 32K', 'volcengine', { stream: true, tools: true }, 32_768),
      text('doubao-vision-pro', '豆包 Vision Pro', 'volcengine', { stream: true, tools: true, vision: true }, 32_768),
      visual('doubao-seedream', 'Seedream 文生图', 'volcengine', 'image'),
      visual('doubao-seedance', 'Seedance 视频', 'volcengine', 'video', { refImage: true },
        '分镜页默认用的就是它'),
    ],
  },
  {
    id: 'deepseek', name: 'DeepSeek', en: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    console: 'https://platform.deepseek.com',
    models: [
      text('deepseek-chat', 'DeepSeek Chat', 'deepseek', { stream: true, tools: true }, 65_536),
      text('deepseek-reasoner', 'DeepSeek Reasoner', 'deepseek', { stream: true, reasoning: true }, 65_536,
        '推理型：拆结构、算成本这类活儿更稳，但慢'),
    ],
  },
  {
    id: 'zhipu', name: '智谱 GLM', en: 'Zhipu BigModel',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    console: 'https://bigmodel.cn',
    models: [
      text('glm-4-plus', 'GLM-4 Plus', 'zhipu', { stream: true, tools: true }, 128_000),
      text('glm-4v-plus', 'GLM-4V Plus', 'zhipu', { stream: true, vision: true }, 8_192),
      visual('cogview-3-plus', 'CogView 文生图', 'zhipu', 'image', {}),
      visual('cogvideox', 'CogVideoX 视频', 'zhipu', 'video'),
    ],
  },
  {
    id: 'bailian', name: '阿里百炼', en: 'Alibaba Model Studio',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    console: 'https://bailian.console.aliyun.com',
    docs: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
    models: [
      text('qwen-max', '通义千问 Max', 'bailian', { stream: true, tools: true }, 32_768),
      text('qwen-vl-max', '通义千问 VL Max', 'bailian', { stream: true, vision: true }, 32_768),
      visual('wanx-v1', '万相 文生图', 'bailian', 'image'),
      visual('wanx-video', '万相 视频', 'bailian', 'video'),
    ],
  },
  {
    id: 'hunyuan', name: '腾讯混元', en: 'Tencent Hunyuan',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    console: 'https://console.cloud.tencent.com/hunyuan',
    docs: 'https://cloud.tencent.com/document/product/1729/111007',
    models: [
      text('hunyuan-turbo', '混元 Turbo', 'hunyuan', { stream: true, tools: true }, 32_768),
      visual('hunyuan-image', '混元 文生图', 'hunyuan', 'image'),
    ],
  },
  {
    id: 'moonshot', name: '月之暗面', en: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    console: 'https://platform.moonshot.cn',
    models: [
      text('moonshot-v1-128k', 'Kimi 128K', 'moonshot', { stream: true, tools: true }, 131_072,
        '长上下文：整本剧本喂进去做全局改写'),
    ],
  },
  {
    id: 'custom', name: '自定义端点', en: 'OpenAI-compatible',
    baseUrl: '',
    userDefined: true,
    models: [],
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export const providerOf = (id: ProviderId): ProviderSpec | undefined => BY_ID.get(id);

/** 内置目录里的全部模型 */
export const BUILTIN_MODELS: readonly ModelSpec[] = PROVIDERS.flatMap((p) => p.models);

/**
 * 查一个模型。extra 是用户在设置里自己加的（自定义端点、内置目录没跟上的新模型），
 * 优先级高于内置 —— 同 id 以用户填的为准。
 */
export function findModel(
  ref: ModelRef | undefined,
  extra: readonly ModelSpec[] = [],
): ModelSpec | undefined {
  if (!ref) return undefined;
  const hit = (list: readonly ModelSpec[]) =>
    list.find((m) => m.provider === ref.provider && m.id === ref.model);
  return hit(extra) ?? hit(BUILTIN_MODELS);
}

/** 某个模态下可选的模型（内置 + 用户自加） */
export function modelsOfModality(
  modality: Modality,
  extra: readonly ModelSpec[] = [],
): ModelSpec[] {
  const all = [...extra, ...BUILTIN_MODELS];
  const seen = new Set<string>();
  return all.filter((m) => {
    if (m.modality !== modality) return false;
    const k = `${m.provider}/${m.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 默认挑一个：优先已配置的厂商，其次内置顺序 */
export function defaultModel(
  modality: Modality,
  configured: readonly ProviderId[] = [],
  extra: readonly ModelSpec[] = [],
): ModelRef | undefined {
  const list = modelsOfModality(modality, extra);
  const preferred = list.find((m) => configured.includes(m.provider)) ?? list[0];
  return preferred ? { provider: preferred.provider, model: preferred.id } : undefined;
}
