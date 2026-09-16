import { FIGURE_SCALE } from '@/domain/camera/geometry';
import { ASPECT, figureHeightFactor } from '@/domain/camera/framing';
import type { AspectRatio } from '@/domain/types';

/**
 * 取景示意 SVG（无 WebGL 时的回退，也当意图卡的小图）。
 * 人物几何与 camera/geometry 共用 FIGURE_SCALE 语义。
 */
export function FramePreview({ rig, width = 120 }: {
  rig: {
    size: string;
    el?: number;
    az?: number;
    angle?: string;
    dof?: string;
    cam?: string;
    ratio?: string;
  };
  width?: number;
}) {
  /**
   * 画框形状跟所选画幅走，人物占高按纵向视场换算 ——
   * 换画幅是**裁切形状变了**，不是把人推远拉近。换算只有 domain 一份实现。
   */
  const aspect = ASPECT[(rig.ratio || '9:16') as AspectRatio] ?? ASPECT['9:16'];
  const H = 160;
  const W = Math.round(H * aspect);
  const size = rig.size || '全景';
  const el = rig.el ?? (rig.angle === '俯拍' ? 38 : rig.angle === '仰拍' ? -26 : 0);
  const az = rig.az ?? (rig.angle === '过肩' ? 150 : 0);
  const dof = rig.dof || '中等';
  const cam = rig.cam || '固定';

  const fh = (FIGURE_SCALE[size] ?? 0.66) * figureHeightFactor(aspect) * H;
  const eye = clamp(0.42 - el * 0.0029, 0.26, 0.58) * H;
  const face = Math.cos(az * Math.PI / 180);
  const side = Math.sin(az * Math.PI / 180);
  const wScale = 0.42 + 0.58 * Math.abs(face);
  const pitchF = clamp(el / 55, 0, 1);
  const headR = fh * 0.075 * (1 + 0.35 * pitchF);
  const footY = eye + fh * 0.92;
  const topY = footY - fh;
  const headCY = topY + headR;
  const headRx = headR * 0.82 * (0.55 + 0.45 * Math.abs(face));
  const bodyF = 1 - 0.5 * pitchF;
  const shoulderY = topY + headR * 2.3;
  const shoulderW = fh * 0.17 * wScale * (1 + 0.2 * pitchF);
  const hipY = shoulderY + (topY + fh * 0.52 - shoulderY) * bodyF;
  const hipW = fh * 0.125 * wScale;
  const legW = Math.max(fh * 0.05 * wScale, 0.8);
  const legGap = Math.max(fh * 0.02, 0.6);
  const legH = Math.max((footY - hipY + 1) * (1 - pitchF), 0);
  const legOp = 0.88 * (1 - pitchF * 0.9);
  const ground = clamp(0.66 - el * 0.004, 0.5, 0.82) * H;
  const cx = W * (rig.angle === '过肩' ? 0.64 : 0.5);
  const blur = dof === '浅景深' ? 2.6 : dof === '中等' ? 1 : 0;

  const figure = rig.angle === '主观' ? null : rig.angle === '顶拍'
    ? (
      <g fill="var(--color-ink)" opacity=".88">
        <ellipse cx={W / 2} cy={H * 0.52} rx={headR * 2.6} ry={headR * 2.0} />
        <ellipse cx={W / 2} cy={H * 0.52} rx={headR * 0.95} ry={headR * 0.95} fill="var(--color-accent)" />
      </g>
    )
    : (
      <g fill="var(--color-ink)" opacity=".88">
        <ellipse cx={cx} cy={headCY} rx={headRx} ry={headR} />
        {face >= -0.2 && headR >= 5 && (
          <ellipse cx={cx + side * headRx * 1.05} cy={headCY} rx={headR * 0.22} ry={headR * 0.3} fill="var(--color-accent)" />
        )}
        <path d={`M${cx - shoulderW} ${shoulderY} Q${cx} ${shoulderY - headR * 0.5} ${cx + shoulderW} ${shoulderY} L${cx + hipW} ${hipY} L${cx - hipW} ${hipY} Z`} />
        {legH > 0.5 && (
          <g opacity={legOp}>
            <rect x={cx - legGap - legW} y={hipY - 1} width={legW} height={legH} rx={legW * 0.4} />
            <rect x={cx + legGap} y={hipY - 1} width={legW} height={legH} rx={legW * 0.4} />
          </g>
        )}
      </g>
    );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width} role="img"
      aria-label={`取景示意：${rig.ratio || '9:16'}、${size}、${dof}、${cam}`}
      style={{ display: 'block', borderRadius: 8, background: 'var(--color-muted)' }}>
      <defs>
        <filter id="fpb"><feGaussianBlur stdDeviation={blur} /></filter>
        <clipPath id="fpc"><rect width={W} height={H} rx="6" /></clipPath>
      </defs>
      <g clipPath="url(#fpc)">
        <g transform={rig.angle === '荷兰角' ? `rotate(-8 ${W / 2} ${H / 2})` : undefined}>
          <rect width={W} height={H} fill="var(--color-muted)" />
          <g filter={blur ? 'url(#fpb)' : undefined} opacity=".55">
            <rect y={ground} width={W} height={H - ground} fill="var(--color-line)" />
            <rect x={W * 0.07} y={ground - 26} width={W * 0.18} height="26" rx="2" fill="var(--color-line-strong)" opacity=".7" />
            <rect x={W * 0.78} y={ground - 34} width={W * 0.16} height="34" rx="2" fill="var(--color-line-strong)" opacity=".55" />
          </g>
          {rig.angle === '过肩' && (
            <ellipse cx={W * 0.09} cy={H + 6} rx={W * 0.33} ry="46" fill="var(--color-ink)" opacity=".55"
              filter={blur ? 'url(#fpb)' : undefined} />
          )}
          {figure}
          <g stroke="var(--color-line-strong)" strokeWidth=".5" opacity=".35">
            <path d={`M${W / 3} 0 V${H} M${W * 2 / 3} 0 V${H} M0 ${H / 3} H${W} M0 ${H * 2 / 3} H${W}`} />
          </g>
        </g>
      </g>
      <rect width={W} height={H} rx="6" fill="none" stroke="var(--color-line-strong)" strokeWidth="1" />
    </svg>
  );
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
