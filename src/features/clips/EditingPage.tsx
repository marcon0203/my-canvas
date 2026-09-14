import { Icon } from '@/ui/Icon';
import { Button, Chip } from '@/ui';
import { StageBar } from '@/components/StageBar';
import { imgUrlFor, vidUrl } from '@/lib/media';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

/** 剪辑页：原型 viewEdit 同构（.player + .tl 三轨 + 右侧 .blk） */
export function EditingPage() {
  const shots = useProject((s) => s.shots);
  const ratio = useProject((s) => s.ratio);
  const style = useProject((s) => s.style);
  const spend = useProject((s) => s.spend);
  const clipSel = useUi((s) => s.clipSel);
  const setUi = useUi((s) => s.set);
  const toast = useUi((s) => s.toast);

  const cur = shots.find((s) => s.id === clipSel) ?? shots[0];
  if (!cur) {
    return <div className="stage"><div className="stage__body"><p className="t-cap dim">还没有镜头 — 先去分镜添加。</p></div></div>;
  }
  const done = shots.filter((s) => s.vid === 'ok');
  const okDur = done.reduce((n, s) => n + s.dur, 0);

  return (
    <div className="stage">
      <StageBar
        title="Editing"
        pills={<Chip>{done.length} 段可用 · {okDur}s</Chip>}
        actions={<>
          <Button onClick={() => toast('已按配乐节拍自动排好片段顺序')}>
            <Icon name="scissors" />自动成片
          </Button>
          <Button variant="primary" style={{ height: 34, fontSize: 13 }}
            onClick={() => { spend(12); toast('导出 MP4 · 消耗 12 积分'); }}>
            <Icon name="dl" />导出 MP4
          </Button>
        </>}
      />

      <div className="stage__body"><div className="edit">
        <div>
          <div className="player">
            {cur.vid === 'ok'
              ? <video src={vidUrl(cur.id)} poster={imgUrlFor(cur.id, 'tall')} autoPlay muted loop playsInline />
              : <img className="ph" src={imgUrlFor(cur.id, 'tall')} alt={cur.id} />}
          </div>
          <div className="tl">
            <div className="tl__row">
              <span className="tl__lab">画面</span>
              <div className="tl__track">
                {shots.map((s) => (
                  <div key={s.id} className="tl__clip" role="button" tabIndex={0}
                    aria-selected={s.id === cur.id}
                    style={{ width: s.dur * 22, background: 'var(--color-bg-muted)' }}
                    onClick={() => setUi('clipSel', s.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setUi('clipSel', s.id); }}>
                    {s.vid === 'ok' && <img className="ph" src={imgUrlFor(s.id, 'wide')} alt="" />}
                    <span>{s.dur}s</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="tl__row">
              <span className="tl__lab">配音</span>
              <div className="tl__track">
                <div className="tl__aud" style={{ width: (4 + 3 + 3) * 22 }} />
                <div className="tl__aud" style={{ width: (1 + 2 + 2) * 22, opacity: 0.5 }} />
                <div className="tl__aud" style={{ width: (4 + 4) * 22 }} />
              </div>
            </div>
            <div className="tl__row" style={{ marginBottom: 0 }}>
              <span className="tl__lab">字幕</span>
              <div className="tl__track">
                <div className="tl__sub" style={{ width: 10 * 22 }}>小时候，我总觉得世界上有些东西永远不会改变。</div>
                <div className="tl__sub" style={{ width: 5 * 22 }}>它不会说话…</div>
                <div className="tl__sub" style={{ width: 8 * 22 }}>那一天，我第一次知道，永远是有期限的。</div>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div className="sec">当前片段</div>
          <div className="blk"><div className="blk__body">
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="mono">{cur.id}</span>
              <div className="spacer" />
              <span className="t-cap dim">{cur.dur}s</span>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 13 }}>{cur.desc}</p>
            <div className="row wrap" style={{ gap: 6 }}>
              {['转场', '变速', '配乐'].map((x) => (
                <Button key={x} onClick={() => toast(`${x}：原型阶段提供占位，接真实剪辑 API 后生效`)}>{x}</Button>
              ))}
              <Button onClick={() => { spend(4); toast(`「${cur.id}」重新生成 · 消耗 4 积分`); }}>
                <Icon name="refresh" />重生成
              </Button>
            </div>
          </div></div>
          <div className="sec" style={{ marginTop: 20 }}>导出</div>
          <div className="blk"><div className="blk__body">
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="t-cap muted">画幅</span><div className="spacer" /><Chip>{ratio}</Chip>
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="t-cap muted">风格</span><div className="spacer" /><Chip>{style}</Chip>
            </div>
            <div className="row">
              <span className="t-cap muted">预计消耗</span><div className="spacer" />
              <Chip tone="a"><Icon name="bolt" />12</Chip>
            </div>
          </div></div>
        </div>
      </div></div>
    </div>
  );
}
