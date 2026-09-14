import type { PoseKey } from '@/domain/assets/model';
import { DEG2RAD } from '@/domain/camera/geometry';
import { AnimationMixer, type Object3D, type AnimationClip } from 'three';

/**
 * 姿态 = clip 采样点 + 骨骼微调（度）。
 * 修复原型「POSES 只有站立、UI 却引用九种姿态」的半成品：
 * 这里补全九档，clip 缺失时安全回退到 idle。
 */
export interface PoseDef {
  label: string;
  hint: string;
  clip: string;
  time: number;
  bones?: Record<string, [number, number, number]>;
}

export const POSES: Record<PoseKey, PoseDef> = {
  stand: { label: '站立', hint: '中性站姿', clip: 'idle', time: 0.6 },
  walk: { label: '行走', hint: '迈步中段', clip: 'walk', time: 0.4 },
  run: { label: '奔跑', hint: '腾空步', clip: 'run', time: 0.35 },
  sad: { label: '沮丧', hint: '低头含胸', clip: 'sad_pose', time: 0 },
  sneak: { label: '猫腰', hint: '潜行低姿', clip: 'sneak_pose', time: 0 },
  agree: { label: '点头', hint: '颔首同意', clip: 'agree', time: 0.5 },
  reach: {
    label: '伸手', hint: '右臂前伸', clip: 'idle', time: 0.6,
    bones: {
      'mixamorigRightArm': [0, 0, -65],
      'mixamorigRightForeArm': [-15, 0, 0],
    },
  },
  lookback: {
    label: '回望', hint: '转身回头', clip: 'idle', time: 0.6,
    bones: {
      'mixamorigSpine1': [0, 42, 0],
      'mixamorigHead': [0, -28, 0],
    },
  },
  crouch: { label: '蹲下', hint: '低蹲', clip: 'sneak_pose', time: 0.55 },
};

export const POSE_ORDER = Object.keys(POSES) as PoseKey[];

/** 把姿态应用到白模实例（与原型 applyPose 同一语义） */
export function applyPose(
  root: Object3D,
  clips: AnimationClip[],
  poseKey: PoseKey,
): void {
  const p = POSES[poseKey] ?? POSES.stand!;
  const clip = clips.find((c) => c.name === p.clip)
    ?? clips.find((c) => c.name === 'idle')
    ?? clips[0];
  if (!clip) return;

  // 记住静止姿态，骨骼微调在此基础上叠加，多次应用不漂移
  const rest = (root.userData.__restPose ??= (() => {
    const m: Record<string, [number, number, number]> = {};
    root.traverse((o) => {
      if (o.name) m[o.name] = [o.rotation.x, o.rotation.y, o.rotation.z];
    });
    return m;
  })()) as Record<string, [number, number, number]>;

  root.traverse((o) => {
    if (!o.name) return;
    const r = rest[o.name];
    if (r) o.rotation.set(r[0]!, r[1]!, r[2]!);
  });

  if (p.bones) {
    root.traverse((o) => {
      const d = o.name ? p.bones?.[o.name] : undefined;
      if (d) o.rotation.set(o.rotation.x + d[0]! * DEG2RAD, o.rotation.y + d[1]! * DEG2RAD, o.rotation.z + d[2]! * DEG2RAD);
    });
  }

  // clip 采样：paused action 定格到指定时刻
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.reset().play();
  action.paused = true;
  action.time = p.time;
  mixer.setTime(p.time);
  mixer.update(0);
  (root.userData.__mixer as AnimationMixer | undefined)?.stopAllAction();
  root.userData.__mixer = mixer;
  root.updateMatrixWorld(true);
}
