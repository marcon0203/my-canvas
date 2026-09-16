import { useLayoutEffect, useRef } from 'react';
import { Group, BufferAttribute, LineSegments } from 'three';
import type { Color } from 'three';
import { stageCamPos, stageLightPos, STAGE_EYE } from '@/domain/camera/geometry';
import { useSceneColors } from './useSceneColors';
import type { Rig } from '@/domain/assets/model';

/** 摄影机指示物 + 取景锥。位置由 domain/camera 计算 */
export function CameraGizmo({ rig, visible, onPick }: {
  rig: Rig;
  visible: boolean;
  onPick?: () => void;
}) {
  const ref = useRef<Group>(null);
  const frustumRef = useRef<LineSegments>(null);
  const colors = useSceneColors('stage');

  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    const p = stageCamPos(rig);
    g.position.set(p.x, p.y, p.z);
    g.lookAt(0, STAGE_EYE, 0);
    const f = frustumRef.current;
    if (f) {
      const arr: number[] = [];
      for (const [cx, cy] of [[-16, 2], [16, 2], [16, 54], [-16, 54]] as const) {
        arr.push(p.x, p.y, p.z, cx!, cy!, 0);
      }
      f.geometry.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    }
  }, [rig]);

  return (
    <group ref={ref} visible={visible}
      onPointerDown={(e) => { e.stopPropagation(); onPick?.(); }}>
      <mesh castShadow>
        <boxGeometry args={[16, 12, 22]} />
        <meshStandardMaterial color={colors.gizmoCam} roughness={0.35} />
      </mesh>
      <mesh position-z={-15} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[5, 6.5, 12, 20]} />
        <meshStandardMaterial color={colors.gizmoCam} roughness={0.35} />
      </mesh>
      <lineSegments ref={frustumRef}>
        <bufferGeometry />
        <lineBasicMaterial color={colors.gizmoCam} transparent opacity={0.35} />
      </lineSegments>
      {/* 拾取放大区（不可见，负责把点按到指示物上） */}
      <mesh visible={false}><sphereGeometry args={[26]} /></mesh>
    </group>
  );
}

/**
 * 灯泡 + 辉光 + 朝向人体的光线。**纯指示物，不发光**。
 * 这里原本挂着一盏 intensity×8 的 pointLight：它按色片染色，几乎把整个画面都染成
 * 色片的颜色；又因为在 gizmo 组里（取景时隐藏），舞台和取景的打光还对不上 ——
 * 参考图跟你看到的不是一回事。场景的光只由 StageScene 负责。
 */
export function LightGizmo({ rig, visible, color, onPick }: {
  rig: Rig;
  visible: boolean;
  color: Color;
  onPick?: () => void;
}) {
  const ref = useRef<Group>(null);
  const rayRef = useRef<LineSegments>(null);

  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    const p = stageLightPos(rig);
    g.position.set(p.x, p.y, p.z);
    const ray = rayRef.current;
    if (ray) {
      ray.geometry.setAttribute('position',
        new BufferAttribute(new Float32Array([0, 0, 0, -p.x, STAGE_EYE - p.y, -p.z]), 3));
    }
  }, [rig]);

  return (
    <group ref={ref} visible={visible}
      onPointerDown={(e) => { e.stopPropagation(); onPick?.(); }}>
      <mesh><sphereGeometry args={[7, 20, 16]} /><meshBasicMaterial color={color} /></mesh>
      <mesh><sphereGeometry args={[16, 20, 16]} /><meshBasicMaterial color={color} transparent opacity={0.18} /></mesh>
      <lineSegments ref={rayRef}>
        <bufferGeometry />
        <lineBasicMaterial color={color} transparent opacity={0.4} />
      </lineSegments>
      <mesh visible={false}><sphereGeometry args={[30]} /></mesh>
    </group>
  );
}
