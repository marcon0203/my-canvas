import { Component, Suspense, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useThree } from '@react-three/fiber';
import { Box3, MeshPhongMaterial, Vector3, type Mesh, type Object3D, type SkinnedMesh } from 'three';
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
  /**
   * 必须用 SkeletonUtils.clone：drei 的 <Clone> 对 SkinnedMesh 会把克隆体**绑回原始骨架**，
   * 于是 applyPose 转的是克隆体的骨头、渲染看的是原骨架，九档姿态全都没反应。
   * 两块画布各需要一份独立骨架，也只有这个克隆方式给得了。
   */
  const model = useMemo(() => cloneSkinned(scene), [scene]);
  const clay = useMemo(() => new MeshPhongMaterial({ shininess: 12, specular: '#35353f' }), []);
  const root = useRef<Object3D | null>(null);
  // frameloop="demand"：effect 里改完场景图要主动请一帧，
  // 否则屏幕上留着的是「改之前」那一帧（表现为一直 T-pose）
  const invalidate = useThree((st) => st.invalidate);

  const attach = useCallback((o: Object3D | null) => {
    root.current = o;
    if (!o) return;
    fitToStage(o);
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

  useEffect(() => {
    clay.color.set(cssVar(`--color-model-${skin}`) || '#B9BAC1');
    invalidate();
  }, [clay, skin, invalidate]);

  useEffect(() => {
    if (!root.current) return;
    applyPose(root.current, animations, pose);
    invalidate();
  }, [animations, pose, invalidate]);

  return <primitive object={model} ref={attach} />;
}

/**
 * 舞台单位是「厘米级」的自造尺度（STAGE_EYE=38 是胸口高，轨道半径 42–132），
 * 而 GLB 是以米为单位建的（Xbot 高 1.81）—— 直接放进来只有中心一个小点。
 * 按包围盒归一化到 FIGURE_HEIGHT 并让脚踩在地面上：换别的 GLB 也不用改代码。
 */
const FIGURE_HEIGHT = 48;

function fitToStage(o: Object3D): void {
  o.scale.setScalar(1);
  o.position.set(0, 0, 0);
  o.updateMatrixWorld(true);
  const box = new Box3().setFromObject(o);
  const size = box.getSize(new Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) return;
  const k = FIGURE_HEIGHT / size.y;
  o.scale.setScalar(k);
  o.position.y = -box.min.y * k;     // 脚底贴地，不悬空也不陷进地里
  o.updateMatrixWorld(true);
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
