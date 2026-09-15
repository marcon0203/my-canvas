import { Component, Suspense, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Clone, useGLTF } from '@react-three/drei';
import { MeshPhongMaterial, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { cssVar } from '@/lib/cssVar';
import { applyPose } from './usePose';
import type { PoseKey } from '@/domain/assets/model';

/**
 * GLB 白模：材质覆盖成石膏色，姿态直接从动画 clip 采样。
 * 加载失败（ErrorBoundary）或未就绪（Suspense）时回退到参数化糙模。
 */
export function WhiteModel(props: { pose: PoseKey; skin: 'blue' | 'grey' | 'white' }) {
  return (
    <FallbackBoundary>
      <Suspense fallback={<FallbackFigure />}>
        <GltfBody {...props} />
      </Suspense>
    </FallbackBoundary>
  );
}

/** GLB 加载失败 → 糙模兜底，布光台不白屏 */
class FallbackBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <FallbackFigure /> : this.props.children; }
}

/**
 * 三件事各自只在该做的时候做 —— 这是布光台流畅的关键：
 *  · 材质覆盖：挂载时遍历一次（ref 回调必须是稳定引用，否则每次渲染都重挂、重新遍历整副骨骼）
 *  · 底色：只改材质的 color，不再遍历
 *  · 姿态：只在 pose 变了时重采样（applyPose 内部要遍历三遍并新建 AnimationMixer）
 * 拖机位/拖灯每帧都会触发渲染，这三件事任何一件跟着跑都会卡。
 */
function GltfBody({ pose, skin }: { pose: PoseKey; skin: 'blue' | 'grey' | 'white' }) {
  const { scene, animations } = useGLTF('/Xbot.glb');
  const clay = useMemo(() => new MeshPhongMaterial({ shininess: 12, specular: '#35353f' }), []);
  const root = useRef<Object3D | null>(null);

  const attach = useCallback((o: Object3D | null) => {
    root.current = o;
    if (!o) return;
    o.traverse((n) => {
      const mesh = n as Object3D & Partial<Mesh & SkinnedMesh>;
      if (mesh.isMesh || mesh.isSkinnedMesh) {
        mesh.material = clay;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      }
    });
  }, [clay]);

  useEffect(() => { clay.color.set(cssVar(`--color-model-${skin}`) || '#B9BAC1'); }, [clay, skin]);

  useEffect(() => {
    if (root.current) applyPose(root.current, animations, pose);
  }, [animations, pose]);

  return <Clone object={scene} ref={attach} />;
}

/** 加载失败回退：车削糙模 */
export function FallbackFigure() {
  return (
    <mesh castShadow receiveShadow position={[0, 26, 0]}>
      <capsuleGeometry args={[7, 34, 6, 16]} />
      <meshPhongMaterial color={cssVar('--color-model-base') || '#B9BAC1'} shininess={8} />
    </mesh>
  );
}

/**
 * 预加载白模（2.9MB）。模块级调用会在 jsdom 里产生未处理的 rejection，
 * 所以由界面在「用户显出意图时」调用 —— 比如指针移到布光台入口上。
 */
export const preloadWhiteModel = (): void => {
  try { useGLTF.preload('/Xbot.glb'); } catch { /* 预加载失败不影响真正打开时再取 */ }
};
