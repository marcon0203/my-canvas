import type { PoseKey } from '@/domain/assets/model';
import { DEG2RAD } from '@/domain/camera/geometry';
import { AnimationMixer, LoopOnce, type Object3D, type AnimationClip } from 'three';

/**
 * 姿态 = clip 采样点 + 骨骼微调（度）。
 * 修复原型「POSES 只有站立、UI 却引用九种姿态」的半成品：
 * 这里补全九档，clip 缺失时安全回退到 idle。
 */
export interface PoseDef {
  label: string;
  hint: string;
  clip: string;
  /** 采样点（秒）。'end' = clip 末帧 —— 单帧姿势 clip 的第 0 帧是中性起始帧，
   *  真正的姿势在末帧，写死秒数会随换模型失效 */
  time: number | 'end';
  bones?: Record<string, [number, number, number]>;
}

export const POSES: Record<PoseKey, PoseDef> = {
  stand: { label: '站立', hint: '中性站姿', clip: 'idle', time: 0.6 },
  walk: { label: '行走', hint: '迈步中段', clip: 'walk', time: 0.4 },
  run: { label: '奔跑', hint: '腾空步', clip: 'run', time: 0.35 },
  /* Xbot.glb 里的 sad_pose / sneak_pose 是单帧 clip，实测采样不出姿势（首帧即中性帧，
     末帧在 mixer 里取不到），所以这两档改走「idle 打底 + 骨骼微调」—— 与蹲下/伸手/回望同一套机制。 */
  sad: {
    label: '沮丧', hint: '低头含胸', clip: 'idle', time: 0.6,
    bones: {
      'mixamorigSpine': [16, 0, 0],
      'mixamorigSpine1': [8, 0, 0],
      'mixamorigHead': [26, 0, 0],
      'mixamorigLeftArm': [0, 0, 14],
      'mixamorigRightArm': [0, 0, -14],
    },
  },
  sneak: {
    label: '猫腰', hint: '潜行低姿', clip: 'idle', time: 0.6,
    bones: {
      'mixamorigSpine': [34, 0, 0],
      'mixamorigHead': [-24, 0, 0],
      'mixamorigLeftUpLeg': [-24, 0, 0],
      'mixamorigRightUpLeg': [-24, 0, 0],
      'mixamorigLeftLeg': [40, 0, 0],
      'mixamorigRightLeg': [40, 0, 0],
    },
  },
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
  // GLB 里没有蹲姿 clip：以潜行姿为底，靠骨骼微调压低重心
  crouch: {
    label: '蹲下', hint: '低蹲', clip: 'idle', time: 0.6,
    bones: {
      'mixamorigSpine': [18, 0, 0],
      'mixamorigLeftUpLeg': [-38, 0, 0],
      'mixamorigRightUpLeg': [-38, 0, 0],
      'mixamorigLeftLeg': [62, 0, 0],
      'mixamorigRightLeg': [62, 0, 0],
    },
  },
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

  /**
   * 先把上一个 mixer 彻底停掉，再动骨头。
   * 顺序反了会出一个很隐蔽的 bug：AnimationMixer 停用动作时会把绑定的原始值
   * （即 bind pose / T-pose）写回场景 —— 如果放在最后，它正好盖掉刚算好的新姿态，
   * 表现为「第一次切换有效，之后全变回 T-pose」。
   */
  const prev = root.userData.__mixer as AnimationMixer | undefined;
  if (prev) {
    prev.stopAllAction();
    prev.uncacheRoot(root);
    root.userData.__mixer = undefined;
  }

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

  // clip 采样：paused action 定格到指定时刻。
  // 采样点必须夹在 clip 时长内 —— 单帧的 *_pose 只有 0.067s，
  // 越界会按 LoopRepeat 回绕，两个档位悄悄变成同一个姿势。
  const t = p.time === 'end' ? clip.duration : Math.max(0, Math.min(p.time, clip.duration));
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.reset().play();
  // 必须 LoopOnce + clampWhenFinished：默认 LoopRepeat 下 t === duration 会回绕到第 0 帧，
  // 而单帧姿势 clip 的第 0 帧恰恰是中性起始帧 —— 表现为「沮丧/猫腰」看起来跟站立一样
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.paused = true;
  action.time = t;
  mixer.setTime(t);
  mixer.update(0);
  root.userData.__mixer = mixer;

  /**
   * 骨骼微调必须叠在 clip **之后**：每个 clip 有 201 条轨道，覆盖全身骨骼，
   * 先调再采样等于白调（「伸手」「回望」「蹲下」原本都没生效）。
   */
  if (p.bones) {
    const bones = p.bones;
    root.traverse((o) => {
      const d = o.name ? bones[o.name] : undefined;
      if (d) o.rotation.set(o.rotation.x + d[0]! * DEG2RAD, o.rotation.y + d[1]! * DEG2RAD, o.rotation.z + d[2]! * DEG2RAD);
    });
  }
  root.updateMatrixWorld(true);
}
