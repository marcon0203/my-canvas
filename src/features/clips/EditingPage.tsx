import { Icon } from '@/ui/Icon';
import { Button, Chip } from '@/ui';
import { StageBar } from '@/components/StageBar';
import { imgUrlFor, vidUrl } from '@/lib/media';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { secText, totalMs, type Cue } from '@/domain/clips/model';
import { countAwaiting, cutReady, cutReadyDur, hasClip } from '@/domain/shots/usable';

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
  // 「可入片」而不是「可用」：出过片就能排进时间线，但可用是人判定出来的。
  // 这两个曾经在界面上都写作「可用」，于是剪辑页说 18 段、数据页说 0 段
  const ready = shots.filter(cutReady);
  const readyDur = cutReadyDur(shots);
  const awaiting = countAwaiting(shots);
  // 排过时间线就按它画；没排过就按分镜顺序预览 —— 两者要看得出区别，
  // 否则「排时间线」这一步跑没跑过，界面上完全一样
  const planned = timeline.clips.length > 0;
  const filmMs = totalMs(timeline);
  // 时间线上有、但本机没有视频文件的那几镜。**拼片之前就要说清** ——
  // 让人点了才知道不行，等于把一次失败换成了一次困惑
  const noFile = timeline.clips
    .filter((c) => !shots.find((s) => s.id === c.shotId)?.file)
    .map((c) => c.shotId);
  // 每毫秒多少像素：原来写死 22px/秒，长片会把轨道拉到几千像素宽
  const PPS = 22;
  const wOf = (ms: number) => Math.max(8, (ms / 1000) * PPS);

  return (
    <div className="stage">
      <StageBar
        title="Editing"
        pills={<>
          {planned
            ? <Chip tone="ok">已排 {timeline.clips.length} 段 · {secText(filmMs)}{timeline.beatMs ? ` · 卡点 ${timeline.beatMs}ms` : ''}</Chip>
            : <Chip>{ready.length} 段可入片 · {readyDur}s（还没排时间线）</Chip>}
          {awaiting > 0 && <Chip tone="warn">{awaiting} 段待判定</Chip>}
        </>}
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
            {hasClip(cur)
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
                      {sh && hasClip(sh) && <img className="ph" src={imgUrlFor(id, 'wide')} alt="" />}
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
                <span className="t-cap dim">配音工具还没接通</span>
              </div>
            </div>
            <div className="tl__row" style={{ marginBottom: 0 }}>
              <span className="tl__lab">字幕</span>
              <div className="tl__track">
                {subtitles.cues.length === 0
                  ? <span className="t-cap dim">
                      {planned ? '还没生成字幕，点上面的「生成字幕」' : '先排时间线，字幕要挂在时间轴上'}
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
          <div className="sec" style={{ marginTop: 20 }}>成片</div>
          <div className="blk"><div className="blk__body">
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="t-cap muted">画幅</span><div className="spacer" /><Chip>{ratio}</Chip>
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="t-cap muted">风格</span><div className="spacer" /><Chip>{style}</Chip>
            </div>
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="t-cap muted">字幕</span><div className="spacer" />
              <Chip>{subtitles.cues.length ? `${subtitles.cues.length} 条，烧进画面` : '没有'}</Chip>
            </div>
            {/* **前置条件如实摆出来，不做一个点了才知道不行的按钮。**
                拼片要三样：排过时间线、每一镜都有本地视频文件、本机有 ffmpeg。
                前两样这儿能查；ffmpeg 在不在只有 Rust 侧知道，所以那一条
                由它报错时说清（见 render::probe） */}
            {!planned ? (
              <p className="t-cap dim" style={{ margin: 0 }}>
                还没排时间线。先点上面的「排时间线」—— 拼片要知道每一镜放多久。
              </p>
            ) : noFile.length ? (
              <p className="t-cap dim" style={{ margin: 0 }}>
                这 {noFile.length} 镜还没有视频文件：{noFile.slice(0, 4).join('、')}
                {noFile.length > 4 ? ` 等 ${noFile.length} 镜` : ''}。
                去分镜把它们出一遍视频，拼片要的是本机文件。
              </p>
            ) : (
              <Button variant="primary" onClick={() => runTool('film.render')}>
                <Icon name="play" />拼成 mp4
              </Button>
            )}
          </div></div>
        </div>
      </div></div>
    </div>
  );
}
