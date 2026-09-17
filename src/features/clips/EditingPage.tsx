import { Icon } from '@/ui/Icon';
import { Button, Chip } from '@/ui';
import { StageBar } from '@/components/StageBar';
import { imgUrlFor, vidUrl } from '@/lib/media';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { secText, totalMs, type Cue } from '@/domain/clips/model';

/** 剪辑页：原型 viewEdit 同构（.player + .tl 三轨 + 右侧 .blk） */
export function EditingPage() {
  const shots = useProject((s) => s.shots);
  const timeline = useProject((s) => s.timeline);
  const subtitles = useProject((s) => s.subtitles);
  const ratio = useProject((s) => s.ratio);
  const style = useProject((s) => s.style);
  const runTool = useAgent((s) => s.runTool);
  const setStep = useUi((s) => s.setStep);
  const clipSel = useUi((s) => s.clipSel);
  const setUi = useUi((s) => s.set);

  const cur = shots.find((s) => s.id === clipSel) ?? shots[0];
  if (!cur) {
    return <div className="stage"><div className="stage__body"><p className="t-cap dim">还没有镜头 — 先去分镜添加。</p></div></div>;
  }
  const done = shots.filter((s) => s.vid === 'ok');
  const okDur = done.reduce((n, s) => n + s.dur, 0);
  // 排过时间线就按它画；没排过就按分镜顺序预览 —— 两者要看得出区别，
  // 否则「排时间线」这一步跑没跑过，界面上完全一样
  const planned = timeline.clips.length > 0;
  const filmMs = totalMs(timeline);
  // 每毫秒多少像素：原来写死 22px/秒，长片会把轨道拉到几千像素宽
  const PPS = 22;
  const wOf = (ms: number) => Math.max(8, (ms / 1000) * PPS);

  return (
    <div className="stage">
      <StageBar
        title="Editing"
        pills={planned
          ? <Chip tone="ok">已排 {timeline.clips.length} 段 · {secText(filmMs)}{timeline.beatMs ? ` · 卡点 ${timeline.beatMs}ms` : ''}</Chip>
          : <Chip>{done.length} 段可用 · {okDur}s（还没排时间线）</Chip>}
        actions={<>
          <Button onClick={() => runTool('edit.timeline')}>
            <Icon name="scissors" />排时间线
          </Button>
          <Button disabled={!planned} title={planned ? undefined : '先排时间线：字幕要挂在时间轴上'}
            onClick={() => runTool('edit.subtitle', { lang: 'zh' })}>
            <Icon name="text" />生成字幕
          </Button>
          <Button variant="primary" style={{ height: 34, fontSize: 13 }}
            onClick={() => runTool('file.export', { what: 'shots' })}>
            <Icon name="dl" />导出分镜表
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
                {(planned
                  ? timeline.clips.map((c) => ({ id: c.shotId, ms: c.dur }))
                  : shots.map((x) => ({ id: x.id, ms: x.dur * 1000 }))
                ).map(({ id, ms }) => {
                  const sh = shots.find((x) => x.id === id);
                  return (
                    <div key={id} className="tl__clip" role="button" tabIndex={0}
                      aria-selected={id === cur.id}
                      style={{ width: wOf(ms), background: 'var(--color-bg-muted)' }}
                      onClick={() => setUi('clipSel', id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setUi('clipSel', id); }}>
                      {sh?.vid === 'ok' && <img className="ph" src={imgUrlFor(id, 'wide')} alt="" />}
                      <span>{secText(ms)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="tl__row">
              <span className="tl__lab">配音</span>
              <div className="tl__track">
                {/* 配音还没有数据：audio.tts 那条链路还没通（同步返回音频字节，
                    与出图出视频不是同一套协议）。所以这条轨如实空着，
                    而不是画几条假的波形让人以为已经配过音了 */}
                <span className="t-cap dim">还没有配音 —— 配音工具还没接通</span>
              </div>
            </div>
            <div className="tl__row" style={{ marginBottom: 0 }}>
              <span className="tl__lab">字幕</span>
              <div className="tl__track">
                {subtitles.cues.length === 0
                  ? <span className="t-cap dim">
                      {planned ? '还没生成字幕 —— 让剪辑「生成字幕」' : '先排时间线，字幕要挂在时间轴上'}
                    </span>
                  : subtitles.cues.map((q: Cue, i) => (
                    <div key={`${q.at}-${i}`} className="tl__sub" style={{ width: wOf(q.dur) }} title={`${secText(q.at)}`}>
                      {q.text}
                    </div>
                  ))}
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
              {/* 转场、变速、配乐都要改媒体本身，得先有渲染管线（拼片段、转码）。
                  现在连一个占位按钮都不摆 —— 点了没反应比没有更糟 */}
              <Button onClick={() => { setUi('shotSel', cur.id); setStep('storyboard'); }}>
                <Icon name="refresh" />去分镜重生成
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
