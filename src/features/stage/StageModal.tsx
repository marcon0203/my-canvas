import { useRef, useState } from 'react';
import { Icon } from '@/ui/Icon';
import { StageView, type StageDragTarget, type StageViewAngle } from '@/three/StageView';
import { ShotView } from '@/three/ShotView';
import { PosePanel } from './PosePanel';
import { lightName, azName, azFace, elName, kName } from '@/domain/camera/naming';
import { RIG_EL, type Rig } from '@/domain/assets/model';
import { Button, Slider, Switch, ToggleChip } from '@/ui';
import { GelPalette } from '@/components/GelPalette';
import { SIZE_ORDER, type AspectRatio } from '@/domain/types';
import { ASPECT, refImageSize } from '@/domain/camera/framing';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

const CAM_PRESETS: readonly [string, number, number, number][] = [
  ['正面平视', 0, 0, 3], ['过肩', 26, 6, 4], ['侧面', 90, 0, 3],
  ['压迫仰角', 18, -28, 4], ['高处俯瞰', 28, 44, 1], ['背影', 180, 2, 2],
];
const LIGHT_PRESETS: readonly [string, number, number][] = [
  ['左侧', -90, 10], ['顶部', 0, 55], ['右侧', 90, 10],
  ['前方', 0, 8], ['底部', 0, -30], ['后方', 180, 14],
];
const CINE_TITLES: Record<string, string> = { lens: '焦段', dof: '景深', light: '光线', comp: '构图', time: '时间天气', mood: '氛围' };

const wrap180 = (a: number) => ((a + 180) % 360 + 360) % 360 - 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 布光台：原型 modalStage 同构（.stagegrid/.sbox/.params/.pgrp/.mr/.gels/.pose） */
export function StageModal({ open, onClose, rig, onPatch, title = '机位与光线' }: {
  open: boolean;
  onClose: () => void;
  rig: Rig;
  onPatch: (patch: Partial<Rig>) => void;
  title?: string;
}) {
  const [dragTarget, setDragTarget] = useState<StageDragTarget>('cam');
  const [view, setView] = useState<StageViewAngle>('persp');
  const [skin, setSkin] = useState<'blue' | 'grey' | 'white'>('blue');
  const exportRef = useRef<(() => string | null) | undefined>(undefined);
  const toast = useUi((s) => s.toast);
  const ratios = useProject((s) => s.ratios);
  if (!open) return null;

  const ratio = rig.ratio || '9:16';
  const aspect = ASPECT[ratio as AspectRatio] ?? ASPECT['9:16'];

  const drag = (target: StageDragTarget, dAz: number, dEl: number) => {
    if (target === 'cam') onPatch({ az: wrap180(rig.az + dAz), el: clamp(rig.el + dEl, RIG_EL.min, RIG_EL.max) });
    else onPatch({ lightAz: wrap180(rig.lightAz + dAz), lightEl: clamp(rig.lightEl + dEl, -35, 65) });
  };

  return (
    <div className="mo" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mo__box mo__box--wide">
        <div className="mo__h">
          <span className="mo__t">{title}</span>
          <span className="mo__s">点摄影机或灯拖它；转机位就能看到顺光变逆光</span>
          <div className="spacer" />
          <Button style={{ padding: '0 8px' }} aria-label="关闭" onClick={onClose}><Icon name="x" /></Button>
        </div>

        <div className="stagegrid">
          <div className="sbox">
            <div className="sbox__h">
              <span>舞台</span>
              <div className="spacer" />
              <div className="s3d__vt" style={{ position: 'static' }}>
                {(['persp', 'top', 'front'] as const).map((k, i) => (
                  <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>
                    {['透视', '俯视', '正面'][i]}
                  </button>
                ))}
              </div>
            </div>
            <div className="sbox__c">
              <StageView rig={rig} dragTarget={dragTarget} onDragTarget={setDragTarget} onDrag={drag} view={view} skin={skin} />
            </div>
            <div className="sbox__f">
              <span className="t-cap dim">拖谁</span>
              <ToggleChip on={dragTarget === 'cam'} onClick={() => setDragTarget('cam')}>摄影机</ToggleChip>
              <ToggleChip on={dragTarget === 'light'} onClick={() => setDragTarget('light')}>灯</ToggleChip>
              <span className="spacer" />
              <span className="t-cap dim">{azName(rig.az)} · {elName(rig.el)} → {azFace(rig.az)} ｜ {lightName(rig.lightAz, rig.lightEl)}</span>
            </div>
          </div>

          <div className="sbox">
            <div className="sbox__h">
              <span>取景</span>
              <div className="spacer" />
              <span className="t-cap dim">{rig.size} · {rig.mm} · {rig.fstop}</span>
            </div>
            <div className="sbox__c sbox__c--dark">
              {/* 画布本身就是画幅的形状：相机 aspect 取自画布尺寸，换画幅=换裁切 */}
              {/* 监视器是方的：竖幅贴高、横幅贴宽，剩下的是黑边。
                  不靠 max-height —— 它在 aspect-ratio 容器里解析不稳，竖幅会溢出被裁。 */}
              <div className="sbox__frame"
                style={{
                  aspectRatio: ratio.replace(':', '/'),
                  ...(aspect >= 1 ? { width: '100%' } : { height: '100%' }),
                }}>
                <ShotView rig={rig} pose={rig.pose} skin={skin} exportRef={exportRef} />
              </div>
            </div>
            <div className="sbox__f" style={{ flexWrap: 'wrap' }}>
              <span className="t-cap dim">画幅</span>
              {ratios.map((r) => (
                <ToggleChip key={r} on={ratio === r}
                  onClick={() => onPatch({ ratio: r })}>{r}</ToggleChip>
              ))}
              <span className="spacer" />
              <Button
                onClick={() => {
                  const url = exportRef.current?.();
                  if (!url) { toast('渲染失败 —— 浏览器没拿到 WebGL'); return; }
                  onPatch({ poseRef: url });
                  const { width, height } = refImageSize(aspect);
                  toast(`已渲染 ${width}×${height}（${ratio}）姿态参考图 —— 不花钱，随时重来`);
                }}>
                <Icon name="image" />渲染参考图
              </Button>
            </div>
          </div>
        </div>

        <div className="params">
          <section className="pgrp" data-grp="cam" data-on="true">
            <div className="pgrp__h">机位<span>{rig.size} · {azName(rig.az)} · {elName(rig.el)} → {azFace(rig.az)}</span></div>
            <Slider label="方位" min={-180} max={180} value={Math.round(rig.az)} unit="°"
              onChange={(v) => onPatch({ az: v })} />
            <Slider label="俯仰" min={RIG_EL.min} max={RIG_EL.max} value={Math.round(rig.el)} unit="°"
              onChange={(v) => onPatch({ el: v })} />
            <Slider label="距离" min={0} max={6} value={rig.dist}
              onChange={(v) => onPatch({ dist: v as Rig['dist'], size: SIZE_ORDER[v as Rig['dist']] })} />
            <div className="mo__hint">距离档即景别：{SIZE_ORDER.join(' → ')}</div>
            <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
              {CAM_PRESETS.map(([n, az, el, dist]) => (
                <Button key={n}
                  onClick={() => onPatch({ az, el, dist: dist as Rig['dist'], size: SIZE_ORDER[dist as Rig['dist']] })}>
                  {n}
                </Button>
              ))}
            </div>
          </section>

          <section className="pgrp" data-grp="light" data-on="true">
            <div className="pgrp__h">灯光<span>{lightName(rig.lightAz, rig.lightEl)} · {kName(rig.kelvin)}{rig.rim ? ' · 轮廓光' : ''}</span></div>
            <Slider label="亮度" min={10} max={100} value={rig.bright} unit="%"
              onChange={(v) => onPatch({ bright: v })} />
            <Slider label="色温" min={2000} max={8000} step={100} value={rig.kelvin} unit="K" gradient
              onChange={(v) => onPatch({ kelvin: v })} />
            <Slider label="环境" min={0} max={100} value={rig.ambient ?? 25} unit="%"
              onChange={(v) => onPatch({ ambient: v })} />
            <div className="sec" style={{ margin: '12px 0 6px' }}>色片</div>
            <GelPalette rig={rig} onChange={onPatch} />
            <div className="sec" style={{ margin: '12px 0 6px' }}>常用光位</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
              {LIGHT_PRESETS.map(([n, a, e]) => (
                <Button key={n}
                  aria-pressed={Math.abs(rig.lightAz - a) < 12 && Math.abs(rig.lightEl - e) < 12}
                  onClick={() => onPatch({ lightAz: a, lightEl: e })}>{n}</Button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="t-cap">轮廓光</span>
              <div className="spacer" />
              <label className="gel gel--pick gel--sm" style={{ ['--gc' as string]: rig.rimHex || '#8FB8FF' }}>
                <i />
                <input type="color" value={rig.rimHex || '#8FB8FF'}
                  onChange={(e) => onPatch({ rimHex: e.target.value })} />
              </label>
              <Switch label="轮廓光" on={rig.rim} onChange={(v) => onPatch({ rim: v })} />
            </div>
          </section>

          <section className="pgrp">
            <PosePanel rig={rig} onPatch={onPatch} skin={skin} onSkin={setSkin} />
          </section>
        </div>

        {/* 添加维度：把未展开的维度一键加进专业模式（原型缺失的入口，这里补上） */}
        {(() => {
          const rest = (['lens', 'dof', 'light', 'comp', 'time', 'mood'] as const).filter((k) => !rig.dims.includes(k));
          if (!rest.length) return null;
          return (
            <div className="row wrap" style={{ marginTop: 12, gap: 6 }}>
              <span className="t-cap dim">添加维度</span>
              {rest.map((k) => (
                <ToggleChip key={k} title={CINE_TITLES[k] ?? '加入专业模式的维度列表'}
                  onClick={() => onPatch({ dims: [...rig.dims, k] } as Partial<Rig>)}>
                  {CINE_TITLES[k]}
                </ToggleChip>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}