import { useCallback, useRef, useState } from 'react';
import { StageBar } from '@/components/StageBar';
import { Chip } from '@/ui';
import { Icon , type IconName} from '@/ui/Icon';
import { imgUrlFor } from '@/lib/media';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import type { Shot } from '@/domain/shots/model';

/**
 * 总览画布：原型 viewCanvas/cvGraph 同构（.cv/.cv__pin/.cv__surface/.cv-node/.cv__tools/.cv__legend）。
 * 与流水线同源：每次从 acts / shots 现算节点，不存自己的数据。
 */
interface CvNode {
  id: string;
  k: 'idea' | 'story' | 'image' | 'video';
  x: number;
  y: number;
  w: number;
  t: string;
  s?: string;
  shot?: Shot;
}

const NH: Record<CvNode['k'], number> = { idea: 68, story: 68, image: 150, video: 150 };
const KIND: Record<CvNode['k'], [IconName, string, string]> = {
  idea: ['spark', 'Idea', 'var(--color-data-1)'],
  story: ['book', 'Story', 'var(--color-data-2)'],
  image: ['image', 'Image', 'var(--color-data-3)'],
  video: ['video', 'Video', 'var(--color-data-4)'],
};

export function CanvasPage() {
  const acts = useProject((s) => s.acts);
  const shots = useProject((s) => s.shots);
  const assets = useProject((s) => s.assets);
  const deleteShot = useProject((s) => s.deleteShot);
  const cv = useUi((s) => s.cv);
  const setUi = useUi((s) => s.set);
  const setStep = useUi((s) => s.setStep);
  const selectShot = useUi((s) => s.selectShot);
  const selectAsset = useUi((s) => s.selectAsset);
  const toast = useUi((s) => s.toast);

  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const pins = useProject((s) => s.pins);

  const { nodes, edges } = (() => {
    const nodes: CvNode[] = [];
    const edges: [string, string][] = [];
    const beats = acts.flatMap((a) => a.beats.map((b) => ({ ...b, act: a })));
    const has = (k: string) => shots.some((s) => s.sceneKey === k);
    let y = 20;

    for (const b of beats.filter((x) => has(x.k))) {
      const list = shots.filter((s) => s.sceneKey === b.k);
      const y0 = y;
      for (const s of list) {
        nodes.push({ id: `img:${s.id}`, k: 'image', x: 470, y, w: 104, t: s.id, s: s.desc, shot: s });
        if (s.vid !== 'none' || s.takes > 0) {
          nodes.push({ id: `vid:${s.id}`, k: 'video', x: 634, y, w: 104, t: s.id, s: `${s.dur}s`, shot: s });
          edges.push([`img:${s.id}`, `vid:${s.id}`]);
        }
        edges.push([`sc:${b.k}`, `img:${s.id}`]);
        y += NH.image + 14;
      }
      nodes.push({
        id: `sc:${b.k}`, k: 'story', x: 240, y: y0 + (y - y0 - 14) / 2 - 34, w: 186,
        t: `${b.k} · ${b.t}`, s: `${b.act.t} · ${list.length} 镜`,
      });
      edges.push(['idea', `sc:${b.k}`]);
    }
    for (const b of beats.filter((x) => !has(x.k))) {
      nodes.push({ id: `sc:${b.k}`, k: 'story', x: 240, y, w: 186, t: `${b.k} · ${b.t}`, s: `${b.act.t} · 尚无镜头` });
      edges.push(['idea', `sc:${b.k}`]);
      y += NH.story + 14;
    }
    nodes.push({
      id: 'idea', k: 'idea', x: 20, y: Math.max(20, y / 2 - 34), w: 186,
      t: '一个女孩发现，全世界都在遗忘她的猫', s: '一句话灵感',
    });
    return { nodes, edges };
  })();

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const P = (n: CvNode) => pos[n.id] ?? { x: n.x, y: n.y };


  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const onNodeDown = (e: React.PointerEvent, n: CvNode) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    const p = P(n);
    const px = (e.clientX - wrap.left - cv.tx) / cv.zoom;
    const py = (e.clientY - wrap.top - cv.ty) / cv.zoom;
    drag.current = { id: n.id, dx: px - p.x, dy: py - p.y };
    setUi('cv', { ...cv, sel: n.id });
  };
  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    const px = (e.clientX - wrap.left - cv.tx) / cv.zoom;
    const py = (e.clientY - wrap.top - cv.ty) / cv.zoom;
    setPos((prev) => ({ ...prev, [drag.current!.id]: { x: px - drag.current!.dx, y: py - drag.current!.dy } }));
  }, [cv.tx, cv.ty, cv.zoom]);

  const openNode = (n: CvNode) => {
    if (n.k === 'idea') { setStep('outline'); return; }
    if (n.k === 'story') { setStep('outline'); return; }
    if (n.shot) {
      selectShot(n.shot.id);
      setStep(n.k === 'video' ? 'editing' : 'storyboard');
    }
  };

  const badge = (s: Shot) =>
    s.verdict === 'ok' ? <Chip tone="ok" style={{ fontSize: 9, padding: '1px 6px' }}>可用</Chip>
    : s.verdict === 'redo' ? <Chip tone="warn" style={{ fontSize: 9, padding: '1px 6px' }}>重摇</Chip>
    : null;

  const body = (n: CvNode) => {
    if (n.k === 'image' || n.k === 'video') {
      return (
        <>
          <div className="cv-node__pic">
            {n.k === 'image'
              ? (n.shot?.key
                  ? <img className="ph" src={imgUrlFor(n.shot.id + (n.shot.refImg ? '|' + n.shot.refImg : ''), 'tall')} alt="" />
                  : <div className="card__none"><Icon name="image" />无关键帧</div>)
              : (n.shot?.vid === 'ok'
                  ? <img className="ph" src={imgUrlFor(n.shot.id, 'tall')} alt="" />
                  : <div className="card__none"><Icon name="video" />未生成</div>)}
          </div>
          <div className="cv-node__b" style={{ padding: '5px 8px', fontSize: 11 }}>
            <span className="mono">{n.t}</span>
            <div className="cv-node__s ell">{n.s}</div>
            {n.k === 'image' && !!n.shot?.refs.length && (
              <div className="cv-node__s ell" style={{ color: 'var(--color-accent)' }}>{n.shot.refs.join(' · ')}</div>
            )}
          </div>
        </>
      );
    }
    return <div className="cv-node__b">{n.t}<div className="cv-node__s">{n.s || ''}</div></div>;
  };

  return (
    <div className="stage">
      <StageBar
        title="Overview"
        pills={<Chip tone="a">与流水线同源</Chip>}
        actions={
          <button className="tbtn" onClick={() => { setPos({}); setUi('cv', { ...cv, tx: 20, ty: 10, zoom: 0.85 }); }}>
            <Icon name="grid" />适应画布
          </button>
        }
      />

      <div className="stage__body" style={{ overflow: 'hidden' }}>
        <div className="cv">
          <div className="cv__pin">
            <div className="sec" style={{ marginBottom: 10 }}>PIN</div>
            {pins.map((p) => {
              const a = [...assets.角色, ...assets.场景, ...assets.道具].find((x) => x.id === p.id);
              const ok = p.id === 'STYLE' || a?.status === 'locked';
              return (
                <div key={p.id} className="cv__pinitem" title={ok ? '拖到 Image 节点上绑定引用' : '未定稿，不能绑定'}
                  onClick={() => {
                    if (!ok) { toast('未定稿，不能绑定'); return; }
                    if (a) selectAsset(a.id);
                  }}>
                  <div className="cv__pinpic"><img className="ph" src={imgUrlFor(p.id, 'portrait')} alt="" /></div>
                  <div className="cv__pinlab ell">{p.n}{ok ? '' : ' · 未定稿'}</div>
                </div>
              );
            })}
            <p className="t-cap dim" style={{ margin: '12px 0 0', lineHeight: 1.7 }}>
              点资产选中；点 Story 节点右侧的圆点在该场末尾长出新镜头；双击节点跳到对应环节。
            </p>
          </div>

          <div className="cv__wrap" ref={wrapRef} onPointerMove={onMove}
            onPointerUp={() => { drag.current = null; }}>
            <div className="cv__surface" style={{ transform: `translate(${cv.tx}px,${cv.ty}px) scale(${cv.zoom})` }}>
              <svg className="cv__edges">
                {edges.map(([a, b], i) => {
                  const p = byId[a!]; const q = byId[b!];
                  if (!p || !q) return null;
                  const pp = P(p); const qq = P(q);
                  const x1 = pp.x + p.w, y1 = pp.y + NH[p.k] / 2;
                  const x2 = qq.x, y2 = qq.y + NH[q.k] / 2;
                  const m = (x1 + x2) / 2;
                  return (
                    <g key={i}>
                      <path d={`M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}`}
                        fill="none" stroke="var(--color-border-strong)" strokeWidth="1.5" />
                      <circle cx={x2} cy={y2} r="2.5" fill="var(--color-border-strong)" />
                    </g>
                  );
                })}
              </svg>
              {nodes.map((n) => {
                const p = P(n);
                const [icon, label] = KIND[n.k];
                return (
                  <div key={n.id} className={`cv-node cv-node--${n.k}`}
                    aria-selected={n.id === cv.sel}
                    style={{ left: p.x, top: p.y, width: n.w }}
                    onPointerDown={(e) => onNodeDown(e, n)}
                    onDoubleClick={() => openNode(n)}>
                    <div className="cv-node__k">
                      <Icon name={icon} />{label}
                      {n.shot && <span className="spacer" />}
                      {n.shot && badge(n.shot)}
                    </div>
                    {body(n)}
                    {n.k === 'story' && (
                      <span className="cv-port" title="在这一场末尾长出一个新镜头"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const sceneKey = n.t.split(' · ')[0]!;
                          const id = useProject.getState().addShot(sceneKey);
                          toast(id ? `已长出新镜头 ${id}，去分镜补全它` : '已在分镜里');
                        }} />
                    )}
                    {n.k === 'image' && n.shot && (
                      <button className="cv-del" title="删除这一镜" aria-label={`删除 ${n.shot.id}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const s = n.shot!;
                          if (s.takes > 0 && !window.confirm(`删除 ${s.id}？这一镜摇过 ${s.takes} 次，记账会一并抹掉。`)) return;
                          deleteShot(s.id);
                          toast(`已删除 ${s.id}${s.takes ? ` — 连同 ${s.takes} 次生成记录一起从记账里移除` : ''}`);
                        }}>×</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="cv__tools">
              <button title="缩小" onClick={() => setUi('cv', { ...cv, zoom: Math.max(0.5, cv.zoom - 0.15) })}>−</button>
              <button title="复位" onClick={() => setUi('cv', { ...cv, tx: 20, ty: 10, zoom: 0.85 })}><Icon name="refresh" /></button>
              <button title="放大" onClick={() => setUi('cv', { ...cv, zoom: Math.min(1.6, cv.zoom + 0.15) })}>+</button>
            </div>
            <div className="cv__legend">
              {Object.entries(KIND).map(([k, [, label, color]]) => (
                <span key={k}><i style={{ background: color }} />{label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
