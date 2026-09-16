import type { DistStep, ShotSize } from '@/domain/types';
import { sizeOf } from '@/domain/camera/framing';

/** 可选的姿态档：来自白模动画采样 + 骨骼微调 */
export type PoseKey =
  | 'stand' | 'walk' | 'run' | 'sad' | 'sneak' | 'agree' | 'reach' | 'lookback' | 'crouch';

export const POSE_KEYS: readonly PoseKey[] = [
  'stand', 'walk', 'run', 'sad', 'sneak', 'agree', 'reach', 'lookback', 'crouch',
];

export const POSE_LABEL: Record<PoseKey, string> = {
  stand: '站立', walk: '行走', run: '奔跑', sad: '沮丧', sneak: '猫腰',
  agree: '点头', reach: '伸手', lookback: '回望', crouch: '蹲下',
};

/** 姿态参考图交给模型的方式 */
export type PoseMode = 'img' | 'text' | 'both';

/** 色片档 */
export type GelKey =
  | 'none' | 'amber' | 'sunset' | 'magenta' | 'cyan' | 'blue' | 'violet' | 'mint' | 'red' | 'custom';

/** 专业模式里可添加的镜头语言维度 */
export type CineKey = 'size' | 'angle' | 'cam' | 'lens' | 'dof' | 'light' | 'comp' | 'time' | 'mood';

export const CINE_KEYS: readonly CineKey[] =
  ['size', 'angle', 'cam', 'lens', 'dof', 'light', 'comp', 'time', 'mood'];

/**
 * 镜头语言：生成「一张形状照 / 一个镜头」的全部摄影参数。
 * 挂在形状照上（v.rig），分镜引用资产时各镜自带取景。
 * 字段名与 three/ 的相机计算、prompt/ 的片段合成共用同一份语义。
 */
export interface Rig {
  dist: DistStep;            // 距离档即景别
  /**
   * 档内微调，[-0.5, 0.5]。景别仍由 dist 定，这里只在相邻两档之间连续插值拍摄距离 ——
   * 一个「中景」在现场本来就有一段可用距离，不是一个点。
   */
  distFine?: number;
  az: number;                // 方位角：0 正面，±90 侧，180 背后
  el: number;                // 俯仰：负=仰拍，正=俯拍
  angle: '' | '荷兰角' | '过肩' | '主观' | '顶拍';
  cam: string;               // 运镜
  size: ShotSize;
  pose: PoseKey;
  poseMode: PoseMode;
  lightAz: number;
  lightEl: number;
  bright: number;            // 10–100
  kelvin: number;            // 2000–8000
  ambient: number;           // 0–100
  rim: boolean;
  rimHex: string;
  gel: GelKey;
  gelHex?: string;
  body: string;              // 机身
  lensKit: string;           // 镜头组
  mm: string;                // 焦段，如 '50mm'
  fstop: string;             // 光圈，如 'f/4'
  light: string[];           // 多选光线
  comp: string[];            // 构图
  time: string[];            // 时间天气
  mood: string[];            // 氛围
  dims: CineKey[];           // 专业模式下展开的维度
  lens?: string;             // 专业维度（进 chips 不进提示词，提示词走 mm/fstop）
  dof?: string;
  /** 取景框横竖 —— 形状照缺省 9:16，分镜可单独改 */
  ratio?: string;
  /** 已渲染的姿态参考图（dataURL），img/both 模式占参考图名额 */
  poseRef?: string;
}

export const RIG_EL = { min: -35, max: 55 } as const;

/** 形状照：一个资产的多视角节点。节点级风格 —— 每张可以不一样 */
export interface AssetView {
  name: string;              // 正面 / 侧面 / 表情 / 全景 …
  style: string;             // 画风
  gen: boolean;              // 是否已生成
  redo: number;              // 重摇次数
  prompt: string;            // 这张形状照的描述
  rig?: Rig;                 // 惰性创建，见 viewRig
  /**
   * 手改后的完整提示词。与 Shot.custom 同一语义：
   * 有值 = 脱管（不再跟画风/镜头语言联动），清空 = 交回自动合成。
   */
  custom?: string;
}

export type AssetStatus = 'draft' | 'locked';

/** 资产分组：树的三个顶层节点 */
export type AssetGroup = '角色' | '场景' | '道具';

export const ASSET_GROUPS: readonly AssetGroup[] = ['角色', '场景', '道具'];

/** 分组 → 稳定 ID 前缀（CHAR-001 / SCENE-001 / PROP-001） */
export const AID_PREFIX: Record<AssetGroup, string> = {
  角色: 'CHAR', 场景: 'SCENE', 道具: 'PROP',
};

/** 资产：有稳定 ID 与版本号，定稿锁定后才能被分镜引用 */
export interface Asset {
  id: string;                // 界面内的短 id，如 'c1'
  aid: string;               // 可引用的稳定 ID，如 'CHAR-001'
  name: string;
  desc: string;
  voice?: string;
  ver: number;
  status: AssetStatus;
  views: AssetView[];
}

/** 定稿：锁定当前版本，并把这版推给所有引用它的镜头 */
export function lockAsset(a: Asset): void {
  a.status = 'locked';
  if (a.ver < 1) a.ver = 1;
}

/** 升版：版本 +1、回到草稿。引用旧版的镜头由调用方标记 drift，不自动重跑 */
export function unlockAsset(a: Asset): number {
  a.ver += 1;
  a.status = 'draft';
  return a.ver;
}

/** 形状照节点 v.rig 的默认值：从名称里的白话词反推一版 */
export function defaultRig(name: string): Rig {
  const dist: DistStep = /细节|表情|特写/.test(name) ? 5 : /全景|远景/.test(name) ? 2 : /氛围/.test(name) ? 4 : 3;
  const az = /背面|背影/.test(name) ? 180 : /侧面/.test(name) ? 90 : 0;
  const el = /俯/.test(name) ? 38 : /仰/.test(name) ? -26 : 0;
  const pose: PoseKey = /行走|走/.test(name) ? 'walk' : /蹲/.test(name) ? 'crouch'
    : /背面|背影/.test(name) ? 'lookback' : 'stand';
  return {
    dist, az, el, angle: '', cam: '固定', size: sizeOf(dist), pose, poseMode: 'img',
    lightAz: -60, lightEl: 18, bright: 60, kelvin: 5600, ambient: 25, rim: false,
    rimHex: '#8FB8FF', gel: 'none',
    body: 'ARRI Alexa 35', lensKit: 'ARRI Signature Prime', mm: '50mm', fstop: 'f/4',
    light: [], comp: [], time: [], mood: [], dims: ['size', 'angle', 'cam'], ratio: '9:16',
  };
}

/** 惰性挂 rig：旧数据没有 rig 字段也能读。冻结对象（immer 产物）不回写，避免崩溃 */
export const viewRig = (v: AssetView): Rig => {
  if (v.rig) return v.rig;
  const r = defaultRig(v.name);
  if (Object.isExtensible(v)) v.rig = r;
  return r;
};
