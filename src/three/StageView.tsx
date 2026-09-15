import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';
import { StageScene } from './StageScene';
import { useSceneColors } from './useSceneColors';
import { DEG2RAD } from '@/domain/camera/geometry';
import type { Rig } from '@/domain/assets/model';

export type StageDragTarget = 'cam' | 'light';

/** 观察视角：透视 / 俯视 / 正面（与原型 data-sview 同档） */
export type StageViewAngle = 'persp' | 'top' | 'front';
const VIEW: Record<StageViewAngle, { vx: number; vy: number }> = {
  persp: { vx: 20, vy: -26 },
  top: { vx: 76, vy: 0 },
  front: { vx: 2, vy: 0 },
};

/**
 * 舞台俯瞰画布：拖拽直接操纵机位或灯（横向 = 方位，纵向 = 俯仰）。
 * 点指示物切换拖拽对象；右上角切观察视角。
 */
export function StageView({ rig, dragTarget, onDragTarget, onDrag, view, skin = 'blue' }: {
  rig: Rig;
  dragTarget: StageDragTarget;
  onDragTarget: (t: StageDragTarget) => void;
  /** 拖拽增量回调：dAz / dEl（度） */
  onDrag: (target: StageDragTarget, dAz: number, dEl: number) => void;
  view: StageViewAngle;
  skin?: 'blue' | 'grey' | 'white';
}) {
  return (
    <div className="relative size-full" data-stage-view>
      {/* 场景是静止的，只有参数变了才需要重画 —— demand 比常驻 60fps 省一个数量级。
          R3F 在 React 重渲染时会自动 invalidate，拖拽改 rig 就会出帧。
          dpr 封到 1.5：两块画布同时开 2x 等于四倍片元，肉眼几乎看不出差别。 */}
      <Canvas shadows frameloop="demand" dpr={[1, 1.5]}
        camera={{ fov: 34, position: [0, 300, 300], near: 1, far: 4000 }}>
        <ObserverRig view={view} />
        <SceneBackground />
        <StageScene
          rig={rig}
          skin={skin}
          shadowMap={512}
          showGizmos
          onPickCam={() => onDragTarget('cam')}
          onPickLight={() => onDragTarget('light')}
        />
      </Canvas>
      <DragLayer rig={rig} dragTarget={dragTarget} onDrag={onDrag} />
      <DragHint target={dragTarget} onTarget={onDragTarget} />
    </div>
  );
}

/** 观察相机绕原点旋转 */
function ObserverRig({ view }: { view: StageViewAngle }) {
  const { camera } = useThree();
  const cam = camera as PerspectiveCamera;
  const { vx, vy } = VIEW[view];
  cam.position.set(
    420 * Math.sin(vy * DEG2RAD) * Math.cos(vx * DEG2RAD),
    34 + 420 * Math.sin(vx * DEG2RAD),
    420 * Math.cos(vy * DEG2RAD) * Math.cos(vx * DEG2RAD),
  );
  cam.lookAt(0, 30, 0);
  return null;
}

function SceneBackground() {
  const { scene } = useThree();
  const colors = useSceneColors('stage');
  scene.background = colors.bg;
  return null;
}

/**
 * DOM 拖拽层：pointer 事件换成 rig 增量，不进 WebGL 事件循环。
 *
 * 位移按帧合并 —— 高采样率鼠标一秒能发 120+ 个 pointermove，
 * 逐个触发「React 重渲染 + 出一帧」就会把主线程堵死。
 * 累积增量、每帧提交一次，手感不变但工作量降到屏幕刷新率。
 */
function DragLayer({ dragTarget, onDrag }: {
  rig: Rig;
  dragTarget: StageDragTarget;
  onDrag: (target: StageDragTarget, dAz: number, dEl: number) => void;
}) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const pending = useRef<{ az: number; el: number } | null>(null);
  const raf = useRef(0);
  const [grabbing, setGrabbing] = useState(false);

  // 拖到一半卸载（关弹窗）时别留下挂起的帧
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const flush = () => {
    raf.current = 0;
    const d = pending.current;
    pending.current = null;
    if (d) onDrag(dragTarget, d.az, d.el);
  };

  return (
    <div
      className="absolute inset-0"
      style={{ cursor: grabbing ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = { x: e.clientX, y: e.clientY };
        setGrabbing(true);
      }}
      onPointerMove={(e) => {
        if (!last.current) return;
        const dAz = (e.clientX - last.current.x) * 0.65;
        const dEl = -(e.clientY - last.current.y) * 0.45;
        last.current = { x: e.clientX, y: e.clientY };
        const acc = pending.current ?? { az: 0, el: 0 };
        acc.az += dAz;
        acc.el += dEl;
        pending.current = acc;
        if (!raf.current) raf.current = requestAnimationFrame(flush);
      }}
      onPointerUp={() => {
        last.current = null;
        setGrabbing(false);
        if (raf.current) { cancelAnimationFrame(raf.current); flush(); }
      }}
    />
  );
}

function DragHint({ target, onTarget }: {
  target: StageDragTarget;
  onTarget: (t: StageDragTarget) => void;
}) {
  return (
    <div className="absolute left-2 bottom-2 flex items-center gap-1.5 text-[11px]">
      <span className="text-ink-faint">拖谁</span>
      {(['cam', 'light'] as const).map((t) => (
        <button key={t} onClick={() => onTarget(t)} aria-pressed={target === t}
          className="px-2 h-6 rounded-full border text-[11px] transition-colors"
          style={target === t
            ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)', background: 'var(--color-accent-subtle)' }
            : { borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-muted)' }}>
          {t === 'cam' ? '摄影机' : '灯'}
        </button>
      ))}
    </div>
  );
}
