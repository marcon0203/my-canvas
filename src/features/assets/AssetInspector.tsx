import { Icon } from '@/ui/Icon';
import { imgUrlFor } from '@/lib/media';
import { viewRig, type Asset, type AssetView, type CineKey, type Rig } from '@/domain/assets/model';
import { viewPrompt } from '@/domain/prompt/compile';
import { azFrag, azName, azFace, elFrag, elName, kFrag, kName, lightFrag, lightName } from '@/domain/camera/naming';
import { CINE, SAY, camOrder, cineFrag, gearFrag, INTENT } from '@/domain/prompt/vocabulary';
import { FramePreview } from '@/components/FramePreview';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { IntentCards } from './IntentCards';

/** 资产检查器：原型 apv__head/vbar/apv__card/aux/ainfo 同构；简单·专业双模式 */
export function AssetInspector({ asset, view, onAddView }: { asset: Asset; view: AssetView; onAddView: () => void }) {
  const shots = useProject((s) => s.shots);
  const styles = useProject((s) => s.styles);
  const lockAsset = useProject((s) => s.lockAsset);
  const unlockAsset = useProject((s) => s.unlockAsset);
  const setViewStyle = useProject((s) => s.setViewStyle);
  const genAssetView = useProject((s) => s.genAssetView);
  const applyRigToPeers = useProject((s) => s.applyRigToPeers);
  const patchViewRig = useProject((s) => s.patchViewRig);
  const applyIntent = useProject((s) => s.applyIntentToAssetView);
  const openModal = useUi((s) => s.openModal);
  const proMode = useUi((s) => s.proMode);
  const setUi = useUi((s) => s.set);
  const toast = useUi((s) => s.toast);

  const rig = viewRig(view);
  const users = shots.filter((s) => s.refs.includes(asset.aid)).length;
  const patch = (p: Partial<Rig>) => patchViewRig(asset.id, view.name, p);
  const gen = asset.views.filter((x) => x.gen).length;
  const lockedA = asset.status === 'locked';

  return (
    <div className="apv">
      {/* 头：名称 + 定稿状态 + 升版/锁定 */}
      <div className="apv__head">
        <span className="apv__name">{asset.name}</span>
        <span className={`pill ${lockedA ? 'pill--ok' : 'pill--warn'}`}>{lockedA ? `已定稿 · v${asset.ver || 1}` : '未定稿'}</span>
        <span className="mono dim">{asset.aid}</span>
        <div className="spacer" />
        {lockedA ? (
          <button className="tbtn" title="升版后引用旧版的镜头会标记待确认"
            onClick={() => {
              unlockAsset(asset.id);
              const n = shots.filter((s) => s.refs.includes(asset.aid)).length;
              toast(`已升版为 v${asset.ver}。${n} 个镜头引用旧版，已标记待确认 — 不会自动重跑`);
            }}>
            <Icon name="refresh" />升版
          </button>
        ) : (
          <button className="ds-btn ds-btn--primary" style={{ height: 30, fontSize: 12 }}
            onClick={() => {
              lockAsset(asset.id);
              toast(`${asset.name} 已定稿锁定为 ${asset.aid}@v${Math.max(asset.ver, 1)}，镜头现在可以绑定引用了`);
            }}>
            <Icon name="check" />定稿锁定
          </button>
        )}
      </div>

      {/* 形状照切换条：这一页真正的导航 */}
      <div className="vbar">
        <div className="vbar__h">
          <span className="sec" style={{ margin: 0 }}>形状照</span>
          <span className="t-cap dim">{gen}/{asset.views.length} 已生成</span>
          <div className="spacer" />
          <button className="tbtn" title="机位、灯光、器材套到本资产其它形状照，景别各留各的"
            onClick={() => { applyRigToPeers(asset.id, view.name); toast('已把机位朝向、灯光和器材套到其它形状照 — 景别各留各的'); }}>
            <Icon name="layers" />套用到其它形状照
          </button>
        </div>
        <div className="apv__strip">
          {asset.views.map((v2) => (
            <button key={v2.name} className={v2 === view ? 'vt vt--on' : 'vt'}
              aria-pressed={v2 === view}
              title={`${v2.name} · ${v2.style}${v2.gen ? '' : ' · 未生成'}`}
              onClick={() => useUi.getState().selectAsset(asset.id, v2.name)}>
              <span className="vt__pic">
                {v2.gen
                  ? <img className="ph" src={imgUrlFor(asset.id + String(asset.ver) + v2.name + v2.style + v2.redo, 'portrait')} alt="" />
                  : <Icon name="image" />}
              </span>
              <span className="vt__k">{v2.name}</span>
              {v2.gen ? null : <span className="vt__dot" />}
            </button>
          ))}
          <button className="vt vt--add" title="新增形状照" onClick={onAddView}>
            <Icon name="plus" /><span className="vt__k">新增</span>
          </button>
        </div>
      </div>

      <div className="apv__card">
        <div className="apv__pic">
          <div className="apv__picbox">
            {view.gen
              ? <img className="ph" src={imgUrlFor(asset.id + String(asset.ver) + view.name + view.style + view.redo, 'portrait')} alt="" />
              : <div className="card__none"><Icon name="image" />未生成</div>}
          </div>
          <div className="t-cap dim" style={{ textAlign: 'center', marginTop: 8 }}>{view.name} · {view.style}</div>
        </div>

        <div className="apv__side">
          <div className="sec" style={{ marginBottom: 8 }}>画风 · 只作用于这张</div>
          <div className="styles" style={{ marginBottom: 16 }}>
            {styles.map((x) => (
              <button key={x} className="sty" aria-pressed={x === view.style}
                onClick={() => {
                  setViewStyle(asset.id, view.name, x);
                  toast(`「${asset.name} · ${view.name}」的风格已切换为「${x}」`);
                }}>{x}</button>
            ))}
            <button className="sty" onClick={() => toast('风格库共 56 种，这里只摆最常用的 8 种，其余在风格面板里翻')}>更多 ↗</button>
          </div>

          <div className="sec" style={{ marginBottom: 6 }}>生成提示词</div>
          <div className="apv__prompt apv__prompt--big">{viewPrompt(view)}</div>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button className="ds-btn ds-btn--primary" style={{ height: 34, fontSize: 13 }}
              onClick={() => {
                genAssetView(asset.id, view.name);
                toast(`${asset.name} · ${view.name} 已重新生成（第 ${view.redo + 1} 次）`);
              }}>
              <Icon name="image" />{view.gen ? '重新生成这张' : '生成这张'}
            </button>
            <span className="t-cap dim"><Icon name="bolt" />预计 2</span>
          </div>

          {/* 镜头语言：辅助项，简单/专业双模式 */}
          <div className="aux">
            <div className="aux__h">
              <span className="sec" style={{ margin: 0 }}>镜头语言 · 辅助拼提示词</span>
              <div className="spacer" />
              <div className="seg" role="tablist" aria-label="镜头语言模式">
                <button role="tab" aria-selected={!proMode} onClick={() => { useUi.getState().set('proMode', false); useUi.getState().set('dimPick', false); }}>简单</button>
                <button role="tab" aria-selected={proMode} onClick={() => { useUi.getState().set('proMode', true); useUi.getState().set('dimPick', false); }}>专业</button>
              </div>
            </div>
            <button className="entry" onClick={() => openModal('stage')}>
              <span className="entry__t" style={{ width: 56 }}>机位光线</span>
              <span className="entry__v">{rig.size} · {azName(rig.az)} · {elName(rig.el)} → {azFace(rig.az)} ｜ {lightName(rig.lightAz, rig.lightEl)} · {kName(rig.kelvin)}</span>
              <span className="entry__go"><Icon name="right" /></span>
            </button>
            <button className="entry" onClick={() => openModal('gear')}>
              <span className="entry__t" style={{ width: 56 }}>镜头</span>
              <span className="entry__v">{rig.mm} · {rig.fstop} · {rig.lensKit} ｜ {rig.ratio || '9:16'}</span>
              <span className="entry__go"><Icon name="right" /></span>
            </button>
            <details className="aux__more" open={useUi.getState().auxOpen}
              onToggle={(e) => setUi('auxOpen', (e.currentTarget as HTMLDetailsElement).open)}>
              <summary><Icon name="down" className="learn__chev" />{proMode ? '全部九个维度' : '镜头意图与运镜'}</summary>
              <div style={{ paddingTop: 10 }}>
                {proMode
                  ? <ProDims rig={rig} patch={patch} />
                  : <EasyPanel rig={rig} patch={patch} onIntent={(it) => {
                    applyIntent(asset.id, view.name, it);
                    toast(`已按「${it.n}」配好整套 — 机位、灯光、器材都能再单独调`);
                  }} />}
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="ainfo">
        <div className="ainfo__row"><span className="dim">设定</span><span>{asset.desc}</span></div>
        <div className="ainfo__row"><span className="dim">引用</span><span>{users} 个镜头引用了 {asset.aid}</span></div>
        {asset.voice && <div className="ainfo__row"><span className="dim">音色</span><span>{asset.voice}</span></div>}
      </div>
    </div>
  );
}

/** 简单模式：意图卡 → 图示 → 机位·光线·镜头弹窗 → 运镜（原型 easyPanel 同构） */
function EasyPanel({ rig, patch, onIntent }: {
  rig: Rig;
  patch: (p: Partial<Rig>) => void;
  onIntent: (it: (typeof INTENT)[number]) => void;
}) {
  const learnOpen = useUi((s) => s.learnOpen);
  const proTerms = [rig.size, azName(rig.az), elName(rig.el), rig.mm, rig.fstop].join(' · ');
  return (
    <>
      <div className="sbsec">这张形状照，你想让它是什么感觉</div>
      <div className="intents">
        <IntentCards onApply={onIntent} />
        <button className="intent intent--add" title="把当前这套镜头语言存成一张卡"
          onClick={() => useUi.getState().toast('已存成一张机位卡 — 团队里谁都能直接套')}>
          <Icon name="plus" /><span className="intent__n" style={{ marginTop: 4 }}>存成我的机位卡</span>
        </button>
      </div>

      <div className="tune">
        <div className="tune__pic"><FramePreview rig={rig} width={110} /></div>
        <div className="entries">
          <div className="entry" style={{ cursor: 'default', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className="entry__t" style={{ paddingTop: 3 }}>运镜</span>
            <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
              {camOrder.map((n) => (
                <button key={n} className="cc" title={SAY.cam?.[n] ?? ''} aria-pressed={rig.cam === n}
                  onClick={() => patch({ cam: n })}>{n}</button>
              ))}
            </span>
          </div>
        </div>
      </div>

      <details className="learn" open={learnOpen}
        onToggle={(e) => useUi.getState().set('learnOpen', (e.currentTarget as HTMLDetailsElement).open)}>
        <summary><Icon name="down" className="learn__chev" />你刚才选的，用行话说是这样<span className="learn__terms">{proTerms}</span></summary>
        <div className="learn__body">
          {([
            ['景别', rig.size, cineFrag('size', rig.size)],
            ['方位', azName(rig.az), azFrag(rig.az)],
            ['俯仰', elName(rig.el), elFrag(rig.el)],
            ['焦段', rig.mm, gearFrag('mm', rig.mm)],
            ['光圈', rig.fstop, gearFrag('fstop', rig.fstop)],
            ['光型', lightName(rig.lightAz, rig.lightEl), lightFrag(rig.lightAz, rig.lightEl)],
            ['色温', kName(rig.kelvin), kFrag(rig.kelvin)],
          ] as const).map(([a, b, c]) => (
            <div key={a} className="learn__row">
              <span className="learn__k">{a}</span>
              <span className="learn__v">{b}</span>
              <span className="mono dim">{c || '—'}</span>
            </div>
          ))}
          <p className="t-cap dim" style={{ margin: '10px 0 0', lineHeight: 1.7 }}>
            滑块只是这些术语的白话版。看熟了就可以直接开专业模式，那边能调滑块表达不了的东西。
          </p>
        </div>
      </details>
    </>
  );
}


/** 专业模式：只渲染已添加的维度，其余收在「添加维度」里（原型 proPanel 同构 + 补上入口） */
function ProDims({ rig, patch }: { rig: Rig; patch: (p: Partial<Rig>) => void }) {
  const dimPick = useUi((s) => s.dimPick);
  const setUi = useUi((s) => s.set);
  const ALL: CineKey[] = ['size', 'angle', 'cam', 'lens', 'dof', 'light', 'comp', 'time', 'mood'];
  const rest = ALL.filter((k) => !rig.dims.includes(k));
  return (
    <>
      {dimPick && (
        <div className="dimpick">
          <div className="t-cap dim" style={{ marginBottom: 10 }}>挑这张形状照真正要控制的东西，其余留给模型自由发挥</div>
          {[['基础', ['size', 'angle', 'cam']], ['进阶', ['lens', 'dof', 'light', 'comp', 'time', 'mood']]].map(([g, ks]) => {
            const list = (ks as CineKey[]).filter((k) => !rig.dims.includes(k));
            if (!list.length) return null;
            return (
              <div key={g as string}>
                <div className="sec" style={{ margin: '0 0 6px' }}>{g as string}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {list.map((k) => (
                    <button key={k} className="dimpick__b"
                      onClick={() => patch({
                        dims: [...rig.dims, k],
                        ...(CINE[k].one ? {} : { [k]: [] }),
                      } as Partial<Rig>)}>
                      <span className="dimpick__n">{CINE[k].t}</span>
                      <span className="dimpick__h">{CINE[k].hint || CINE[k].o[0]?.[2] || ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {rest.length === 0 && <div className="t-cap dim">九个维度都加上了</div>}
          <div className="row"><div className="spacer" /><button className="tbtn" onClick={() => setUi('dimPick', false)}>收起</button></div>
        </div>
      )}
      <div className="tune" style={{ paddingTop: 0 }}>
        <div className="tune__pic"><FramePreview rig={rig} width={118} /></div>
        <div className="tune__ctrl" style={{ gap: 0 }}>
          {rig.dims.length > 0 ? rig.dims.map((k) => (
            <div key={k} className="cine__row cine__row--dim">
              <span className="cine__lab" title={CINE[k].hint ?? ''}>{CINE[k].t}</span>
              <div className="cine__opts">
                {CINE[k].o.map(([n, frag, why]) => {
                  const on = CINE[k].one ? rig[k] === n : Array.isArray(rig[k]) && (rig[k] as string[]).includes(n);
                  return (
                    <button key={n} className="cc" aria-pressed={on}
                      title={`${frag || '（不加任何描述）'}${why ? ' — ' + why : ''}`}
                      onClick={() => {
                        if (CINE[k].one) patch({ [k]: rig[k] === n ? '' : n } as Partial<Rig>);
                        else {
                          const arr = Array.isArray(rig[k]) ? [...(rig[k] as string[])] : [];
                          const i = arr.indexOf(n);
                          if (i >= 0) arr.splice(i, 1); else arr.push(n);
                          patch({ [k]: arr } as Partial<Rig>);
                        }
                      }}>{n}</button>
                  );
                })}
              </div>
              <button className="cine__x" title={`移除「${CINE[k].t}」，这一项就不进提示词了`}
                onClick={() => patch({ dims: rig.dims.filter((x) => x !== k), [k]: CINE[k].one ? '' : [] } as Partial<Rig>)}>
                <Icon name="x" />
              </button>
            </div>
          )) : <div className="t-cap dim" style={{ padding: '14px 0' }}>这张形状照还没指定任何镜头语言 — 生成时只有风格和形状照描述。</div>}
        </div>
      </div>
      {!dimPick && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="tbtn" onClick={() => setUi('dimPick', true)}>
            <Icon name="plus" />添加维度
          </button>
          <span className="t-cap dim" style={{ marginLeft: 8 }}>悬停任意一项能看到它对应的英文片段和用途</span>
        </div>
      )}
    </>
  );
}
