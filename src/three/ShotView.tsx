import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PerspectiveCamera, WebGLRenderTarget } from 'three';
import { StageScene } from './StageScene';
import { useSceneColors } from './useSceneColors';
import { shotCamera } from '@/domain/camera/geometry';
import { DEG2RAD } from '@/domain/camera/geometry';
import type { PoseKey, Rig } from '@/domain/assets/model';

/**
 * 摄影机取景画布：指示物全藏，所见即参考图。
 * exportRef 挂一个导出函数：按参考图接口约束渲 720×1280 的 dataURL（不花钱，随时重来）。
 */
export function ShotView({ rig, pose, skin = 'grey', exportRef }: {
  rig: Rig;
  pose?: PoseKey;
  skin?: 'blue' | 'grey' | 'white';
  exportRef?: React.MutableRefObject<(() => string | null) | undefined>;
}) {
  return (
    <Canvas shadows frameloop="demand" dpr={[1, 1.5]} gl={{ preserveDrawingBuffer: true }}
      camera={{ fov: 40, near: 1, far: 5000, position: [0, 38, 200] }}
      style={{ width: '100%', height: '100%' }}>
      <SceneBackground />
      <ShotCamera rig={rig} />
      <StageScene rig={rig} pose={pose} skin={skin} showGizmos={false} />
      {exportRef && <OffscreenExporter rig={rig} exportRef={exportRef} />}
    </Canvas>
  );
}

function SceneBackground() {
  const { scene } = useThree();
  const colors = useSceneColors('stage');
  scene.background = colors.bg;
  return null;
}

/** 把 domain 的取景算法套到 three 相机（含荷兰角滚转） */
function ShotCamera({ rig }: { rig: Rig }) {
  const { camera, size } = useThree();
  const cam = camera as PerspectiveCamera;
  useEffect(() => {
    const spec = shotCamera(rig);
    cam.fov = spec.fov;
    cam.aspect = size.width / Math.max(size.height, 1);
    cam.position.set(spec.position.x, spec.position.y, spec.position.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(spec.target.x, spec.target.y, spec.target.z);
    if (spec.roll) cam.rotateZ(spec.roll * DEG2RAD);
    cam.updateProjectionMatrix();
  }, [cam, rig, size.width, size.height]);
  return null;
}

/** 离屏渲染：720×1280（满足参考图 ≥300px、宽高比 0.4–2.5 硬约束） */
function OffscreenExporter({ rig, exportRef }: {
  rig: Rig;
  exportRef: React.MutableRefObject<(() => string | null) | undefined>;
}) {
  const { gl, scene, camera } = useThree();
  const cam = camera as PerspectiveCamera;
  useEffect(() => {
    exportRef.current = () => {
      const W = 720, H = 1280;
      const oldW = gl.domElement.width;
      const oldH = gl.domElement.height;
      try {
        gl.setSize(W, H, false);
        cam.aspect = W / H;
        const spec = shotCamera(rig);
        cam.fov = spec.fov;
        cam.position.set(spec.position.x, spec.position.y, spec.position.z);
        cam.lookAt(spec.target.x, spec.target.y, spec.target.z);
        if (spec.roll) cam.rotateZ(spec.roll * DEG2RAD);
        cam.updateProjectionMatrix();
        const rt = new WebGLRenderTarget(W, H);
        gl.setRenderTarget(rt);
        gl.render(scene, cam);
        gl.setRenderTarget(null);
        const pixels = new Uint8Array(W * H * 4);
        gl.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
        rt.dispose();
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const img = ctx.createImageData(W, H);
        // WebGL 像素原点在下，翻转后写入
        for (let y = 0; y < H; y++) {
          const src = (H - 1 - y) * W * 4;
          img.data.set(pixels.subarray(src, src + W * 4), y * W * 4);
        }
        ctx.putImageData(img, 0, 0);
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      } finally {
        gl.setSize(oldW, oldH, false);
      }
    };
    return () => { exportRef.current = undefined; };
  }, [gl, scene, cam, rig, exportRef]);
  return null;
}
