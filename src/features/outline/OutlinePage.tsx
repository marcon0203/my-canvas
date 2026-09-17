import { Icon } from '@/ui/Icon';
import { Button, Chip, TreeGroup, TreeItem } from '@/ui';
import { ExplorerHead } from '@/components/ExplorerHead';
import { StageBar } from '@/components/StageBar';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

/** 剧情大纲：原型 viewOutline 同构（.expl 左树右检查器 / .pv-shot / .blk） */
export function OutlinePage() {
  const acts = useProject((s) => s.acts);
  const alts = useProject((s) => s.alts);
  const shots = useProject((s) => s.shots);
  const expandAlts = useProject((s) => s.expandAlts);
  const spend = useProject((s) => s.spend);
  const nodeSel = useUi((s) => s.nodeSel);
  const selectNode = useUi((s) => s.selectNode);
  const setStep = useUi((s) => s.setStep);
  const selectShot = useUi((s) => s.selectShot);
  const toast = useUi((s) => s.toast);

  const beat = acts.flatMap((a) => a.beats).find((b) => b.id === nodeSel);
  const actOf = beat && acts.find((a) => a.beats.some((b) => b.id === beat.id));
  const shotsOf = (k: string) => shots.filter((s) => s.sceneKey === k);
  const allBeats = acts.flatMap((a) => a.beats);

  const vpill = (verdict: string | null) =>
    verdict === 'ok' ? <Chip tone="ok">可用</Chip>
    : verdict === 'redo' ? <Chip tone="warn">重摇</Chip>
    : <Chip>未判定</Chip>;

  const expand = () => {
    if (!beat) return;
    expandAlts(beat.id, [
      '艾米没有去医院，第二天年糕自己回来了，但眼睛变了颜色',
      '医生记得年糕，消失的是艾米自己的记忆',
      '照片里的白猫换成了另一只黑猫，全家人都说本来就是它',
    ]);
    spend(2);
    toast('延展剧情走向 · 消耗 2 积分');
  };

  const tree = acts.map((a) => {
    const withShots = a.beats.filter((b) => shotsOf(b.k).length).length;
    return (
      <TreeGroup key={a.id} title={a.t} meta={a.span} count={`${withShots}/${a.beats.length} 已拍`}>
        {a.beats.map((b) => {
          const n = shotsOf(b.k).length;
          const alts2 = alts[b.id] ?? [];
          return (
            <div key={b.id}>
              <TreeItem selected={b.id === nodeSel} onClick={() => selectNode(b.id)}
                k={b.k} title={b.t} count={n ? `${n} 镜` : '未拍'} />
              {alts2.map((x, i) => (
                <div key={i} className="expl__alt"><Chip>备选</Chip><span>{x}</span></div>
              ))}
            </div>
          );
        })}
      </TreeGroup>
    );
  });

  const preview = !beat ? (
    <div className="blk"><div className="blk__body">
      <p style={{ margin: 0 }} className="t-cap dim">在左侧选择一个场景节点，这里会显示它的详情。</p>
    </div></div>
  ) : (() => {
    const list = shotsOf(beat.k);
    const alts2 = alts[beat.id] ?? [];
    return (
      <>
        {actOf && <div className="sec" style={{ marginBottom: 10 }}>{actOf.t} · {actOf.span}</div>}
        <div className="row" style={{ marginBottom: 18 }}>
          <Chip tone="a">{beat.k}</Chip>
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: 0 }}>{beat.t}</span>
        </div>
        {list.length > 0 ? (
          <>
            <div className="sec">本场镜头 · {list.length}</div>
            <div className="blk" style={{ marginBottom: 20 }}><div className="blk__body" style={{ padding: '6px 20px' }}>
              {list.map((s) => (
                <div key={s.id} className="pv-shot" role="button" tabIndex={0} title="跳到 Storyboard 处理这一镜"
                  onClick={() => { selectShot(s.id); setStep('storyboard'); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { selectShot(s.id); setStep('storyboard'); } }}>
                  <span className="mono">{s.id}</span>
                  <Chip>{s.size}</Chip>
                  <span className="pv-shot__d">{s.desc}</span>
                  {vpill(s.verdict)}
                </div>
              ))}
            </div></div>
          </>
        ) : (
          <div className="blk" style={{ marginBottom: 20 }}><div className="blk__body">
            <p className="t-cap dim" style={{ margin: 0, lineHeight: 1.7 }}>
              这一场还没有镜头。去画布从 Story 节点拉一条线，就能在这里长出第一镜。
            </p>
          </div></div>
        )}
        {alts2.length > 0 && (
          <>
            <div className="sec">备选走向 · {alts2.length}</div>
            <div className="blk" style={{ marginBottom: 20 }}><div className="blk__body" style={{ padding: '14px 20px' }}>
              {alts2.map((x, i) => (
                <div key={i} className="row" style={{ gap: 12, padding: '7px 0', borderBottom: i < alts2.length - 1 ? '1px solid var(--color-border-subtle)' : undefined }}>
                  <Chip tone="a" style={{ flex: '0 0 auto' }}>{i + 1}</Chip>
                  <span className="t-cap" style={{ lineHeight: 1.7 }}>{x}</span>
                </div>
              ))}
              <p className="t-cap dim" style={{ margin: '10px 0 0', lineHeight: 1.7 }}>
                点右上角还能再要三条。
              </p>
            </div></div>
          </>
        )}
      </>
    );
  })();

  return (
    <div className="stage">
      <StageBar
        title="Plot outline"
        pills={<Chip>Story Flow</Chip>}
        actions={<>
          <Button onClick={expand}><Icon name="map" />延展剧情走向</Button>
          <Button onClick={() => setStep('script')}><Icon name="right" />生成剧本</Button>
        </>}
      />

      <div className="stage__body" style={{ overflow: 'hidden' }}>
        <div className="expl">
          <div className="expl__tree">
            <ExplorerHead title="剧情结构" meta={`${allBeats.length} 场`} />
            {tree}
          </div>
          <div className="expl__view">{preview}</div>
        </div>
      </div>
    </div>
  );
}
