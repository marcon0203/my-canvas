import type { Asset, AssetGroup } from '@/domain/assets/model';
import type { Shot } from '@/domain/shots/model';
import type { Act, DocBlock } from '@/domain/story/model';
import type { AgentId } from './roster';
import type { AgentConfig } from './config';
import type { Modality, ModelRef } from '@/domain/providers/model';

/**
 * Agent 看到的项目快照 —— 只读。
 * 计划函数全部是 (ctx) => Plan 的纯函数，所以可以脱离 React 测。
 */
export interface AgentContext {
  readonly proj: string;
  readonly style: string;
  readonly stylePrompt: string;
  readonly styles: readonly string[];
  readonly ratio: string;
  readonly credits: number;
  readonly budget: number;
  readonly acts: readonly Act[];
  readonly blocks: readonly DocBlock[];
  readonly assets: Readonly<Record<AssetGroup, readonly Asset[]>>;
  readonly shots: readonly Shot[];
  /** 界面当前选中的东西：Agent 的「这一场」「当前块」指的就是它们 */
  readonly sel: {
    readonly step: string;
    readonly beatId: string;
    readonly assetId: string;
    readonly shotId: string;
    readonly blockId: string | null;
  };
  /** 用户这一轮说了什么（技能卡触发时为空） */
  readonly input: string;
  /** 当班的是哪位 Agent */
  readonly agentId: AgentId;
  /** 全班底的配置：决定谁接哪些活、用什么模型 */
  readonly agents: Record<AgentId, AgentConfig>;
  /** 各模态的全局默认模型（Agent 没单独配时用它） */
  readonly globalModels: Partial<Record<Modality, ModelRef>>;
}

export const ctxAssets = (c: AgentContext): Asset[] =>
  [...c.assets.角色, ...c.assets.场景, ...c.assets.道具];
