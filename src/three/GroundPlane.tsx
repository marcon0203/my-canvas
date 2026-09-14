import { useSceneColors } from './useSceneColors';
import { Text } from '@react-three/drei';

/** 地面、同心圈、方位标签 */
export function GroundPlane() {
  const c = useSceneColors('stage');
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[4000, 4000]} />
        <meshLambertMaterial color={c.floor} />
      </mesh>
      {[60, 110, 170, 240].map((r) => (
        <mesh key={r} rotation-x={-Math.PI / 2} position-y={0.1}>
          <ringGeometry args={[r - 0.6, r + 0.6, 96]} />
          <meshBasicMaterial color={c.mark} transparent opacity={0.45} />
        </mesh>
      ))}
      <DirLabel text="正面" x={0} z={150} />
      <DirLabel text="背" x={0} z={-150} />
      <DirLabel text="右" x={150} z={0} />
      <DirLabel text="左" x={-150} z={0} />
    </group>
  );
}

function DirLabel({ text, x, z }: { text: string; x: number; z: number }) {
  const c = useSceneColors('stage');
  return (
    <Text position={[x, 6, z]} fontSize={16} color={`#${c.mark.getHexString()}`} anchorX="center" anchorY="middle">
      {text}
    </Text>
  );
}
