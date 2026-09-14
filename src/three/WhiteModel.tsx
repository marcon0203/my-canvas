import { Suspense, useEffect, useMemo } from 'react';
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
import { Component, type ReactNode } from 'react';
class FallbackBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <FallbackFigure /> : this.props.children; }
}

function GltfBody({ pose, skin }: { pose: PoseKey; skin: 'blue' | 'grey' | 'white' }) {
  const { scene, animations } = useGLTF('/Xbot.glb');
  const clay = useMemo(() => new MeshPhongMaterial({ shininess: 12, specular: '#35353f' }), []);
  const skinColor = cssVar(`--color-model-${skin}`) || '#B9BAC1';

  useEffect(() => {
    clay.color.set(skinColor);
  }, [clay, skinColor]);
  clay.color.set(skinColor);

  const bind = (root: Object3D | null) => {
    if (!root) return;
    root.traverse((o) => {
      const mesh = o as Object3D & Partial<Mesh & SkinnedMesh>;
      if (mesh.isMesh || mesh.isSkinnedMesh) {
        mesh.material = clay;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      }
    });
    applyPose(root, animations, pose);
  };

  return <Clone object={scene} ref={bind} />;
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

/* 预加载在模块级做会在 jsdom/SSR 环境产生未处理 rejection，改为布光台首次打开时加载 */
