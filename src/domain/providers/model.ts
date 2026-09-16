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
