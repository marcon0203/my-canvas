import type { Asset, AssetGroup, Rig } from '@/domain/assets/model';
import type { Shot } from '@/domain/shots/model';
import type { Act, DocBlock } from '@/domain/story/model';
import type { AgentId } from './roster';

/**
 * Agent 的可执行意图。技能卡与自由输入都归一到这张表，
 * 下游（计划、草稿、记账）全部按 kind 分派。
 */
export type IntentKind =
  | 'outline.draft'
  | 'outline.expand'
  | 'script.draft'
  | 'script.polish'
  | 'assets.extract'
  | 'assets.views'
  | 'shots.generate'
  | 'shots.prompt'
  | 'style.transfer'
  | 'video.batch'
  | 'edit.autocut'
  | 'cost.report'
  | 'chat';

/**
 * 产物补丁：domain 只描述「要改什么」，不碰 store。
 * store 层的 applyPatch 负责解释 —— 这样草稿逻辑可以纯函数测试。
 */
export type ProposalPatch =
  | { t: 'acts'; acts: Act[] }
  | { t: 'alts'; beatId: string; alts: string[] }
  | { t: 'blocks'; blocks: DocBlock[] }
  | { t: 'blockBody'; id: string; body: string }
  | { t: 'assets'; add: { group: AssetGroup; asset: Asset }[] }
  | { t: 'assetViews'; gen: { assetId: string; viewName: string }[] }
  | { t: 'shots'; shots: Shot[] }
  | { t: 'shotPrompts'; edits: { id: string; own: string }[] }
  | { t: 'style'; style: string; stylePrompt: string }
  | { t: 'assetLock'; aid: string }
  /**
   * `asset.write` 工具的产物：只有分组/aid/名字/描述。
   * 形状照那一堆由 `assetShell` 在应用补丁时补 —— aid 在 Rust 侧编号（它看得到
   * 全项目已用的号），资产的形状归前端 domain 管，两边各做自己擅长的那半。
   */
  | { t: 'assetsDraft'; add: { group: AssetGroup; aid: string; name: string; desc: string; voice?: string }[] }
  /** `shot.rig` 的产物：**只覆盖给到的字段**，没给的保持原样 */
  | { t: 'shotRig'; edits: { id: string; rig: Partial<Rig> }[] }
  | { t: 'run'; action: 'video.batch' | 'edit.autocut' };

/** 产物预览行：采纳前给人看的 diff 摘要 */
export interface PreviewRow {
  readonly k: string;
  readonly v: string;
}

/** 一次运行的产物。patch 为空表示这轮只是回答，没有东西要写进项目 */
export interface Proposal {
  readonly title: string;
  readonly rows: readonly PreviewRow[];
  readonly patch: ProposalPatch;
  /** 采纳后扣的积分 */
  readonly cost: number;
  /** 采纳后跳转到哪个环节（可选） */
  readonly goto?: string;
}

/** 计划里的一步：界面上是一张会自己走完的工具卡 */
export interface PlanStep {
  readonly icon: string;
  readonly label: string;
  /** 这步结束时补一句说明，没有则不显示 */
  readonly note?: string;
}

/** Agent 对一次输入的完整应答 */
export interface Plan {
  readonly kind: IntentKind;
  readonly steps: readonly PlanStep[];
  /** 流式吐出的正文 */
  readonly reply: string;
  /** 没有产物时为 undefined */
  readonly proposal?: Proposal;
  /** 做不了时的原因（缺前置条件），有值则不执行步骤 */
  readonly blocked?: string;
}

/** 转交：当班 Agent 接不了，交给对的那位 */
export interface Handoff {
  readonly from: AgentId;
  readonly to: AgentId;
  readonly kind: IntentKind;
}

/** 一条消息。run 消息承载步骤卡与产物卡 */
export interface AgentMessage {
  /** 自主模式下被权限边界挡住时，这里放为什么停 */
  hold?: string;
  readonly id: number;
  readonly who: 'me' | 'ai';
  /** 哪位 Agent 说的 —— 一条会话里可能有多位，转交后由新人接着说 */
  readonly agentId?: AgentId;
  readonly text: string;
  /** 这轮是一次转交，不是一次执行 */
  readonly handoff?: Handoff;
  /** ai 消息：这轮跑了哪些步骤，以及跑到第几步 */
  readonly steps?: readonly PlanStep[];
  readonly stepDone?: number;
  readonly proposal?: Proposal;
  /** 产物卡状态 */
  readonly verdict?: 'pending' | 'accepted' | 'discarded';
  /** 正在流式输出 */
  readonly streaming?: boolean;
}
