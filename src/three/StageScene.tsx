import { stageLightPos, STAGE_EYE } from '@/domain/camera/geometry';
import { GroundPlane } from './GroundPlane';
import { WhiteModel } from './WhiteModel';
import { CameraGizmo, LightGizmo } from './gizmos';
import { keyLightColor } from './lightColor';
import type { PoseKey, Rig } from '@/domain/assets/model';

/**
 * 场景内容由状态派生：机位/灯光参数 → 灯位、光色、指示物。
 * showGizmos=false 时是「摄影机看到的画面」，同一场景直接当取景/参考图。
 */
export function StageScene({ rig, pose = 'stand', skin = 'blue', showGizmos = true,
  shadowMap = 1024, onPickCam, onPickLight }: {
  rig: Rig;
  pose?: PoseKey;
  skin?: 'blue' | 'grey' | 'white';
  showGizmos?: boolean;
  /** 阴影贴图边长。俯瞰台只是示意，512 够用；取景画布要出参考图，保持 1024 */
  shadowMap?: number;
  onPickCam?: () => void;
  onPickLight?: () => void;
}) {
  const keyColor = keyLightColor(rig);
  const keyIntensity = 0.3 + (rig.bright / 100) * 1.8;
  const lp = stageLightPos(rig);

  return (
    <group>
      <hemisphereLight args={['#ffffff', '#33353f', 0.1 + ((rig.ambient ?? 25) / 100) * 0.55]} />
      <directionalLight
        position={[lp.x, lp.y, lp.z]}
        target-position={[0, STAGE_EYE, 0]}
        color={keyColor}
        intensity={keyIntensity}
        castShadow
        shadow-mapSize-width={shadowMap}
        shadow-mapSize-height={shadowMap}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
        shadow-camera-far={900}
        shadow-bias={-0.0015}
      />
      <directionalLight
        position={[-lp.x, Math.max(lp.y, STAGE_EYE), -lp.z]}
        target-position={[0, STAGE_EYE, 0]}
        color={rig.rimHex || '#8FB8FF'}
        intensity={rig.rim ? 1.2 : 0}
      />
      <GroundPlane />
      <WhiteModel pose={pose} skin={skin} />
      <CameraGizmo rig={rig} visible={showGizmos} onPick={onPickCam} />
      <LightGizmo rig={rig} visible={showGizmos} color={keyColor} intensity={keyIntensity} onPick={onPickLight} />
    </group>
  );
}
