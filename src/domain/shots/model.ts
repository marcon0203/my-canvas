import type { Asset, Rig } from '@/domain/assets/model';
import { defaultRig } from '@/domain/assets/model';
import type { ShotSize } from '@/domain/types';
import { SIZE_ORDER } from '@/domain/types';

/** 判定：可用 / 重摇，null = 未判定。命中率靠它记账 */
export type Verdict = 'ok' | 'redo' | null;

/** 视频生成状态 */
export type VidState = 'none' | 'run' | 'ok' | 'redo';

/** 镜头：分镜表的一行。引用资产用 aid + 锁定时的版本号 */
export interface Shot {
  id: string;                 // 's1-1'
  sceneKey: string;           // 所属场次，对应大纲 beat.k，如 '场景1'
  size: ShotSize;
  desc: string;
  dur: number;                // 秒
  refs: string[];
  own: string;                // 本镜实际发生什么
  model: string;
  batch: number;
  key: boolean;               // 有关键帧
  keyIdx?: number;            // 选中的候选序号（TakeGrid）
  vid: VidState;
  /**
   * 连续失败。跑成一次就清掉。
   *
   * 记次数而不只记「失败了」：同一镜连着失败三次和失败一次，下一步要做的事
   * 不一样（前者多半是提示词或引用有问题，后者可能只是厂商抖了一下）。
   */
  fail?: { n: number; why: string };
  takes: number;              // 累计生成次数，记账口径
  verdict: Verdict;
  ejected: boolean;           // 手改提示词后脱管
  custom?: string;            // 脱管时的手写提示词
  refVer: Record<string, number>;
  /** 绑定的参考图：'' / undefined = 自动（按提示词生成），否则是资产 aid */
  refImg?: string;
  /** 节点级画幅（缺省跟项目走） */
  ratio?: string;
  rig: Rig;
  style?: string;             // 节点级画风，'全局' 表示跟随项目
  /**
   * 出好的视频在项目目录下的**相对路径**（`media/video-s1-1-1.mp4`）。
   *
   * 为什么记相对路径而不是厂商那串 URL：那串几小时到几天就失效，而且拼成片
   * 要 ffmpeg 读本地文件。为什么是相对的：项目目录整个搬到另一台机器上之后，
   * 这个值还得是对的。
   *
   * 没有这个字段 = 这一镜还没出过视频，拼片时会被点名。
   */
  file?: string;
}

/** 新镜头默认值 */
export function makeShot(id: string, sceneKey: string): Shot {
  return {
    id, sceneKey, size: '中景', desc: '新镜头，待补全', dur: 2,
    refs: [], own: '', model: 'Seedance 2.0', batch: 1,
    key: false, vid: 'none', takes: 0, verdict: null, ejected: false,
    refVer: {}, rig: defaultRig('中景'),
  };
}

/** 新镜头插在该场最后一镜之后，保证分镜表顺序自然 */
export function addShot(shots: Shot[], sceneKey: string): Shot {
  const num = sceneKey.replace(/\D/g, '') || String(shots.length + 1);
  let i = 1;
  let id = `s${num}-${i++}`;
  while (shots.some((s) => s.id === id)) id = `s${num}-${i++}`;
  const s = makeShot(id, sceneKey);
  const last = shots.map((x) => x.sceneKey).lastIndexOf(sceneKey);
  if (last === -1) shots.push(s);
  else shots.splice(last + 1, 0, s);
  return s;
}

/** 从资产引用构造 refVer 快照（定稿才能引用，见 locking.ts） */
export function refVerSnapshot(assets: readonly Asset[]): Record<string, number> {
  return Object.fromEntries(assets.map((a) => [a.aid, a.ver]));
}

export const SIZE = SIZE_ORDER;
