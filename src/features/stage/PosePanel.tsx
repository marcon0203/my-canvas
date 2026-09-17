import { Chip } from '@/ui';
import { Icon } from '@/ui/Icon';
import { POSE_KEYS, POSE_LABEL, type PoseMode, type Rig } from '@/domain/assets/model';
import { POSE_FRAG } from '@/domain/prompt/vocabulary';
import { ASPECT, refImageSize } from '@/domain/camera/framing';
import type { AspectRatio } from '@/domain/types';

const WM_SKINS = [
  { k: 'blue', n: '蓝模', d: '蓝灰，和浅色背景分得开，看结构最清楚' },
  { k: 'grey', n: '灰模', d: '中性灰，当参考图最安全，不会给画面带色' },
  { k: 'white', n: '白模', d: '石膏白，传统白模' },
] as const;

const POSE_MODES: readonly [PoseMode, string, string][] = [
  ['img', '图片', '把渲染图当参考图传上去，锁构图和姿态'],
  ['text', '文字', '只把姿态和机位写成提示词，不占参考图名额'],
  ['both', '两者', '图片加文字，最强也最容易和资产参考打架'],
];

/** 白模 / 姿态：原型 posePanel 同构（.pose/.cc）；姿态九档为原型缺口的补全 */
export function PosePanel({ rig, onPatch, skin, onSkin, refCount = 0 }: {
  rig: Rig;
  onPatch: (patch: Partial<Rig>) => void;
  skin: 'blue' | 'grey' | 'white';
  onSkin: (s: 'blue' | 'grey' | 'white') => void;
  refCount?: number;
}) {
  const mode: PoseMode = rig.poseMode ?? 'img';
  const refSize = refImageSize(ASPECT[(rig.ratio || '9:16') as AspectRatio] ?? ASPECT['9:16']);
  const used = refCount + (rig.poseRef && mode !== 'text' ? 1 : 0);
  return (
    <div className="pose">
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="sec" style={{ margin: 0 }}>白模</span>
        <span className="t-cap dim">按当前取景渲染，用作姿态与构图参考</span>
        <div className="spacer" />
        <Chip>参考图 {used}/30</Chip>
      </div>

      <div className="row" style={{ gap: 5, marginBottom: 14 }}>
        <span className="t-cap dim" style={{ width: 34 }}>底色</span>
        {WM_SKINS.map((k) => (
          <button key={k.k} className="cc" aria-pressed={skin === k.k} title={k.d}
            onClick={() => onSkin(k.k)}>{k.n}</button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <span className="sec" style={{ margin: 0 }}>姿态</span>
        <div className="spacer" />
        <span className="t-cap dim">动画采样定格，骨骼微调出九档</span>
      </div>
      <div className="row" style={{ gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
        {POSE_KEYS.map((k) => (
          <button key={k} className="cc" aria-pressed={(rig.pose ?? 'stand') === k} title={POSE_FRAG[k]}
            onClick={() => onPatch({ pose: k })}>{POSE_LABEL[k]}</button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <span className="sec" style={{ margin: 0 }}>怎么交给模型</span>
        <div className="spacer" />
      </div>
      <div className="row" style={{ gap: 5, marginBottom: 10 }}>
        {POSE_MODES.map(([k, n, d]) => (
          <button key={k} className="cc" aria-pressed={mode === k} title={d}
            onClick={() => onPatch({ poseMode: k })}>{n}</button>
        ))}
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 auto' }}>
          {rig.poseRef
            ? <img src={rig.poseRef} alt="姿态参考图"
                style={{ width: 72, borderRadius: 6, display: 'block', border: '1px solid var(--color-border-default)' }} />
            : <div style={{
                width: 72, height: 128, borderRadius: 6, border: '1px dashed var(--color-border-strong)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-text-tertiary)', fontSize: 10, textAlign: 'center', lineHeight: 1.4,
              }}>还没<br />渲染</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="t-cap dim" style={{ margin: '8px 0 0', lineHeight: 1.7 }}>
            {refSize.width}×{refSize.height}（跟随画幅 {rig.ratio || '9:16'}），符合参考图尺寸约束。
            渲染不花钱，随便重来。点右上角「渲染参考图」生成。
          </p>
          {rig.poseRef && (
            <button className="tbtn" style={{ marginTop: 8 }} onClick={() => onPatch({ poseRef: undefined })}>
              <Icon name="x" />移除参考图
            </button>
          )}
          {mode !== 'text' && refCount >= 3 && (
            <p className="t-cap" style={{ color: 'var(--color-warning)', margin: '8px 0 0', lineHeight: 1.6 }}>
              这一镜已经有 {refCount} 个资产引用。灰白的姿态图和它们一起传，有把画面带灰的风险 —— 不确定时可以先用「文字」。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}