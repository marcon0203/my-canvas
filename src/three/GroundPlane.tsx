import { useEffect, useMemo } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';
import { useSceneColors } from './useSceneColors';

/**
 * 地面、同心圈、方位标签。
 * labels=false 用于取景画布 —— 参考图里不能烤进「正面 / 背」这种中文标注。
 */
export function GroundPlane({ labels = true }: { labels?: boolean }) {
  const c = useSceneColors('stage');
  return (
    <group>
      {/*
       * 地面不吃光：它是示意图元素，不是被照亮的实体。
       * 用受光材质的话，一上饱和色片整片地就被染成同一个颜色 ——
       * 舞台图看不清机位，参考图还会被无关色污染。
       * 色片该落在人物身上；影子由下面单独一层接。
       */}
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial color={c.floor} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.04} receiveShadow>
        <planeGeometry args={[4000, 4000]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
      {[60, 110, 170, 240].map((r) => (
        <mesh key={r} rotation-x={-Math.PI / 2} position-y={0.1}>
          <ringGeometry args={[r - 0.6, r + 0.6, 96]} />
          <meshBasicMaterial color={c.mark} transparent opacity={0.9} />
        </mesh>
      ))}
      {labels && <>
        <DirLabel text="正面" x={0} z={150} />
        <DirLabel text="背" x={0} z={-150} />
        <DirLabel text="右" x={150} z={0} />
        <DirLabel text="左" x={-150} z={0} />
      </>}
    </group>
  );
}

/**
 * 方位标签：用 2D canvas 画字再贴成 sprite。
 *
 * 不用 drei 的 <Text>：它底层 troika 会为中文去 CDN 取 unicode 字体数据
 * （cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver），离线或有防火墙时
 * 这个请求挂起，<Text> 就一直 suspend，整个舞台一个像素都画不出来。
 * 内部工具不该为了四个字依赖外网 —— 浏览器自己的字体就够。
 */
function DirLabel({ text, x, z }: { text: string; x: number; z: number }) {
  const c = useSceneColors('stage');
  const color = `#${c.label.getHexString()}`;
  const tex = useMemo(() => makeLabelTexture(text, color), [text, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  if (!tex) return null;
  // 贴图 128×64，按 16 号字的观感换算成世界尺寸
  return (
    <sprite position={[x, 10, z]} scale={[34, 17, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

const LABEL_W = 128;
const LABEL_H = 64;

function makeLabelTexture(text: string, color: string): Texture {
  const cv = document.createElement('canvas');
  cv.width = LABEL_W;
  cv.height = LABEL_H;
  const ctx = cv.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, LABEL_W, LABEL_H);
    ctx.fillStyle = color;
    ctx.font = '600 34px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, LABEL_W / 2, LABEL_H / 2);
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}
