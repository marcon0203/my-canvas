/**
 * 模型与厂商的类型层。纯数据，无 IO —— Rust 侧读的是同一份结构。
 */

/** 模态：一个模型只干一件事，别指望一个 id 同时出文本和视频 */
export type Modality = 'text' | 'image' | 'video';

export const MODALITY_LABEL: Record<Modality, string> = {
  text: '文本', image: '图片', video: '视频',
};

/** 协议族：决定 Rust 侧用哪个适配器 */
export type Protocol =
  /** OpenAI 兼容的 /chat/completions —— 国内六家的文本接口都是这个 */
  | 'openai-chat'
  /** 各家自有的异步任务接口：提交拿 task_id，再轮询 */
  | 'async-task';

export type ProviderId =
  | 'volcengine' | 'deepseek' | 'zhipu' | 'bailian' | 'hunyuan' | 'moonshot' | 'custom';

/** 模型能力。界面按它过滤「这个 Agent 能选哪些模型」 */
export interface ModelCaps {
  /** 流式输出 */
  readonly stream?: boolean;
  /** 工具调用（function calling） */
  readonly tools?: boolean;
  /** 读图 */
  readonly vision?: boolean;
  /** 显式推理过程 */
  readonly reasoning?: boolean;
  /** 出图/出视频时能吃参考图 */
  readonly refImage?: boolean;
}

export interface ModelSpec {
  /** 调接口时传的 id */
  readonly id: string;
  readonly name: string;
  readonly provider: ProviderId;
  readonly modality: Modality;
  readonly protocol: Protocol;
  readonly caps: ModelCaps;
  /** 上下文窗口（token），文本模型才有 */
  readonly context?: number;
  readonly note?: string;
}

export interface ProviderSpec {
  readonly id: ProviderId;
  readonly name: string;
  readonly en: string;
  /** 默认端点。企业版/自建网关在设置里改 */
  readonly baseUrl: string;
  /** 控制台地址，设置界面里给个「去拿 key」的入口 */
  readonly console?: string;
  readonly docs?: string;
  /** 这家默认带哪些模型（种子，可增删） */
  readonly models: readonly ModelSpec[];
  /** 自定义端点：baseUrl 与模型全靠用户填 */
  readonly userDefined?: boolean;
}

/** 指向一个具体模型 */
export interface ModelRef {
  readonly provider: ProviderId;
  readonly model: string;
}

export const sameModel = (a: ModelRef | undefined, b: ModelRef | undefined): boolean =>
  !!a && !!b && a.provider === b.provider && a.model === b.model;

export const modelKey = (r: ModelRef): string => `${r.provider}/${r.model}`;

export function parseModelKey(key: string): ModelRef | undefined {
  const i = key.indexOf('/');
  if (i <= 0) return undefined;
  return { provider: key.slice(0, i) as ProviderId, model: key.slice(i + 1) };
}

/** 每种类型能勾的能力项。文本与出图出视频能勾的不是一回事 */
export const CAPS_OF: Record<Modality, readonly { k: keyof ModelCaps; n: string; hint: string }[]> = {
  text: [
    { k: 'stream', n: '流式', hint: '一个字一个字往外吐，对话观感靠它' },
    { k: 'tools', n: '工具调用', hint: '不支持的话复杂任务只能靠提示词硬来' },
    { k: 'vision', n: '读图', hint: '能看懂图片输入' },
    { k: 'reasoning', n: '推理', hint: '有显式思考过程，慢但稳' },
  ],
  image: [{ k: 'refImage', n: '参考图', hint: '能吃参考图保持角色一致' }],
  video: [{ k: 'refImage', n: '参考图', hint: '能吃首帧或参考图' }],
};

/** 换类型时的出厂勾选 */
export const defaultCaps = (m: Modality): Record<string, boolean> =>
  m === 'text' ? { stream: true, tools: true } : { refImage: true };

/**
 * 表单 → ModelSpec。**类型决定协议族**：文本走 OpenAI 兼容的 /chat/completions，
 * 出图出视频走各家自有的异步任务接口。协议不让用户选 —— 选错了只会在发请求时才炸。
 *
 * 能力按类型过滤：切过类型的表单里可能还留着上一类的勾，让它们混进去
 * 会让 Agent 配置页的检查说谎（比如以为一个文生图模型支持 function calling）。
 */
export function makeModel(input: {
  provider: ProviderId;
  id: string;
  name?: string;
  modality: Modality;
  /** 上下文窗口，单位 K；只有文本模型有 */
  contextK?: number;
  caps: Record<string, boolean>;
}): ModelSpec {
  const id = input.id.trim();
  const ctx = input.modality === 'text' ? Number(input.contextK) : NaN;
  return {
    id,
    name: input.name?.trim() || id,
    provider: input.provider,
    modality: input.modality,
    protocol: input.modality === 'text' ? 'openai-chat' : 'async-task',
    caps: Object.fromEntries(
      CAPS_OF[input.modality].filter((c) => input.caps[c.k]).map((c) => [c.k, true]),
    ),
    ...(Number.isFinite(ctx) && ctx > 0 ? { context: ctx * 1024 } : {}),
  };
}
