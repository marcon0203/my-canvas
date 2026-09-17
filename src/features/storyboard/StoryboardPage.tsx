import { useState } from 'react';
import { Button, Chip, Icon, Skeleton, Textarea, ToggleChip, TreeGroup, TreeItem } from '@/ui';
import { StageBar } from '@/components/StageBar';
import { RunBar } from '@/components/RunBar';
import { TakeGrid } from '@/components/TakeGrid';
import { VerdictToggle } from '@/components/VerdictToggle';
import { PromptBox } from '@/components/PromptBox';
import { imgUrlFor } from '@/lib/media';
import { useProject, useAssetList } from '@/store/project';
import { useUi } from '@/store/ui';
import { unlockedRefs, driftedRefs } from '@/domain/assets/locking';
import { compileShot, segmentsText } from '@/domain/prompt/compile';
import { STYLES } from '@/domain/prompt/vocabulary';
import { submitGen, type GenTask } from '@/api/generation';
import type { Shot, Verdict } from '@/domain/shots/model';

/** 分镜控制台：左树（TreeGroup/TreeItem）+ 右单镜工作台（RunBar/TakeGrid/VerdictToggle/PromptBox） */
export function StoryboardPage() {
  const shots = useProject((s) => s.shots);
  const acts = useProject((s) => s.acts);
  const stylePrompt = useProject((s) => s.stylePrompt);
  const assets = useAssetList();
  const usableN = shots.filter((s) => s.verdict === 'ok').length;
  const tries = shots.reduce((n, s) => n + s.takes, 0);
  const hit = tries ? Math.round((usableN / tries) * 100) : 0;

  const shotSel = useUi((s) => s.shotSel);
  const selectShot = useUi((s) => s.selectShot);
  const toast = useUi((s) => s.toast);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const cur = shots.find((s) => s.id === shotSel) ?? shots[0];
  const groups = [...new Set(shots.map((s) => s.sceneKey))];

  const markRunning = (id: string, on: boolean) => setRunningIds((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const run = (s: Shot) => {
    const st = useProject.getState();

    // 引用了没定稿的资产就不发请求。
    //
    // 这条规则产品里早就有（列表上那个黄点就是它），但只是提示，运行照跑 ——
    // 跑出来的画面里角色长什么样是随机的，钱花了还得重摇。美术那位的提示词里
    // 写着「定稿之后才能被分镜引用，这条规矩任何情况下都不绕过」，这里让它真生效。
    const unlocked = unlockedRefs(s, (aid) => assets.find((a) => a.aid === aid));
    if (unlocked.length) {
      const names = unlocked.map((aid) => assets.find((a) => a.aid === aid)?.name ?? aid);
      st.failRun(s.id, `引用的资产还没定稿：${names.join('、')}。去资产页定稿，或把这个引用去掉。`);
      toast(`「${s.id}」没发出去：${names.join('、')} 还没定稿`);
      return;
    }

    const segs = compileShot(s, { globalStylePrompt: stylePrompt, assetDescOf: (aid) => assets.find((a) => a.aid === aid)?.desc });
    const task = submitGen(
      {
        model: s.model, prompt: segmentsText(segs), ratio: (s.ratio ?? '9:16') as GenTask['params']['ratio'],
        batch: s.batch, refs: s.refs,
      },
      undefined,
      (t) => {
        // 提交就被拒：没扣分，也别让它挂在「生成中」
        markRunning(s.id, false);
        useProject.getState().failRun(s.id, t.error ?? '没说原因');
        toast(`「${s.id}」没跑起来：${t.error ?? ''}`);
      },
    );
    if (task.status === 'failed') return;
    markRunning(s.id, true);
    st.spend(3);
    toast(`「${s.id}」生成任务已提交 · ${s.model}`);
    const poll = setInterval(() => {
      if (task.status === 'done') {
        clearInterval(poll);
        st.commitRun(s.id);
        markRunning(s.id, false);
        toast(`「${s.id}」完成 · 出 ${task.params.batch} 版候选`);
      } else if (task.status === 'failed') {
        clearInterval(poll);
        markRunning(s.id, false);
        useProject.getState().failRun(s.id, task.error ?? '没说原因');
        toast(`「${s.id}」生成失败：${task.error ?? ''}`);
      } else if (task.status === 'cancelled') {
        clearInterval(poll);
        markRunning(s.id, false);
      }
    }, 200);
  };

  return (
    <div className="stage">
      <StageBar
        title="Storyboard"
        pills={<>
          <Chip>{usableN}/{shots.length} 可用</Chip>
          <Chip tone={hit >= 25 ? 'ok' : 'warn'}><Icon name="bolt" />命中率 {hit}%</Chip>
        </>}
        actions={<>
          <Button onClick={() => { useProject.getState().genAllKeys(); toast('生成关键帧 · 消耗 10 积分'); }}>
            <Icon name="image" />生成缺失关键帧
          </Button>
          <Button variant="primary" style={{ height: 34, fontSize: 13 }} onClick={() => {
            useProject.getState().batchVidStart();
            toast('批量生成视频 · 消耗 24 积分');
            setTimeout(() => {
              useProject.getState().batchVidDone();
              toast('批量生成完成 — 还需要逐镜判定可用/重摇，命中率才算得出来');
            }, 1500);
          }}>
            <Icon name="video" />一键批量生成视频
          </Button>
        </>}
      />
      <div className="stage__body" style={{ overflow: 'hidden' }}>
        <div className="expl">
          <div className="expl__tree">
            <div className="expl__head">
              <span className="sec" style={{ margin: 0 }}>分镜列表</span>
              <div className="spacer" />
              <span className="t-cap dim">{shots.length} 镜</span>
            </div>
            {groups.map((g) => {
              const list = shots.filter((s) => s.sceneKey === g);
              const beat = acts.flatMap((a) => a.beats).find((b) => b.k === g);
              const byAid = (aid: string) => assets.find((a) => a.aid === aid);
              return (
                <TreeGroup key={g} title={`${g}${beat ? ' · ' + beat.t : ''}`}
                  count={`${list.filter((s) => s.verdict === 'ok').length}/${list.length} 可用`}>
                  {list.map((s) => {
                    const warn = unlockedRefs(s, byAid).length > 0 || driftedRefs(s, byAid).length > 0;
                    const running = runningIds.has(s.id);
                    // 失败排在最前：它是唯一需要人立刻做点什么的状态
                    const st = running
                      ? { text: '生成中', color: 'var(--color-accent)' }
                      : s.fail ? { text: s.fail.n > 1 ? `失败 ×${s.fail.n}` : '失败', color: 'var(--color-warning)' }
                      : s.verdict === 'ok' ? { text: '可用', color: 'var(--color-success)' }
                      : s.verdict === 'redo' ? { text: '重摇', color: 'var(--color-warning)' }
                      : s.vid === 'run' ? { text: '生成中', color: 'var(--color-accent)' }
                      : { text: '未判定', color: 'var(--color-text-tertiary)' };
                    return (
                      <TreeItem key={s.id} asset selected={s.id === cur?.id}
                        onClick={() => selectShot(s.id)}
                        title={s.fail ? `${s.desc}\n失败：${s.fail.why}` : s.desc}
                        thumb={s.key
                          ? <img className="ph" src={imgUrlFor(s.id + (s.refImg ? '|' + s.refImg : ''), 'tall')} alt="" />
                          : <Icon name="image" />}
                        k={s.id}
                        dot={warn ? <i title="有引用问题待处理" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-warning)', flex: '0 0 auto' }} /> : undefined}
                        trailing={
                          <span className="expl__run" role="button" tabIndex={0} title="运行生成这一镜"
                            onClick={(e) => { e.stopPropagation(); if (!running) run(s); }}>
                            <Icon name="play" />
                          </span>
                        }
                        status={st}
                      />
                    );
                  })}
                </TreeGroup>
              );
            })}
          </div>
          <div className="expl__view">
            {cur
              ? <ShotInspector shot={cur} running={runningIds.has(cur.id)} onRun={() => run(cur)} />
              : <Panel><p style={{ margin: 0 }} className="t-cap dim">在左侧选择一个镜头，这里合成它的生成提示词。</p></Panel>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 单镜工作台：全部经由 ui/ 与业务组件 */
function ShotInspector({ shot, running, onRun }: { shot: Shot; running: boolean; onRun: () => void }) {
  const assets = useAssetList();
  const stylePrompt = useProject((s) => s.stylePrompt);
  const grp = useProject((s) => s.shots).filter((s) => s.sceneKey === shot.sceneKey);
  const beat = useProject.getState().acts.flatMap((a) => a.beats).find((b) => b.k === shot.sceneKey);
  const toast = useUi((s) => s.toast);

  const segs = compileShot(shot, { globalStylePrompt: stylePrompt, assetDescOf: (aid) => assets.find((a) => a.aid === aid)?.desc });
  const byAid = (aid: string) => assets.find((a) => a.aid === aid);
  const bad = unlockedRefs(shot, byAid);
  const drift = driftedRefs(shot, byAid);

  const patch = (p: Partial<Shot>) => useProject.getState().setShotField(shot.id, p);
  const verdict = (v: Verdict) => {
    const st = useProject.getState();
    if (v === 'ok') { st.setVerdict(shot.id, 'ok'); toast('已标记可用'); }
    else { st.setVerdict(shot.id, 'redo', 4); st.spend(4); toast('重摇 ×4 · 消耗 4 积分'); }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0 }}>{shot.id}</span>
        <Chip>{shot.size}</Chip>
        <Chip>{shot.dur}s</Chip>
        {running
          ? <Chip tone="a"><Icon name="refresh" className="spin" />生成中</Chip>
          : shot.fail ? <Chip tone="warn">{shot.fail.n > 1 ? `失败 ×${shot.fail.n}` : '失败'}</Chip>
          : shot.verdict === 'ok' ? <Chip tone="ok">可用</Chip>
          : shot.verdict === 'redo' ? <Chip tone="warn">重摇</Chip>
          : <Chip>未判定</Chip>}
        <div className="spacer" />
        <span className="t-cap dim">{shot.takes ? `摇了 ${shot.takes} 次` : '未跑'} · {shot.model}</span>
      </div>
      <div className="t-cap dim" style={{ marginBottom: shot.fail ? 12 : 20 }}>
        {shot.sceneKey}{beat ? ' · ' + beat.t : ''} — 第 {grp.findIndex((s) => s.id === shot.id) + 1} / {grp.length} 镜
      </div>

      {shot.fail && (
        <div className="shotfail">
          <Icon name="x" />
          <span className="shotfail__t">
            {shot.fail.why}
            {shot.fail.n > 1 && <span className="t-cap dim"> · 连续第 {shot.fail.n} 次</span>}
          </span>
          <div className="spacer" />
          <Button onClick={onRun} disabled={running}><Icon name="refresh" />重试</Button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 248px' }}>
          <div className="card__pic" style={{ borderRadius: 'var(--radius-tile)', overflow: 'hidden', aspectRatio: '9/16' }}>
            {running
              ? <Skeleton />
              : shot.key
                ? <img className="ph" src={imgUrlFor(shot.id + (shot.refImg ? '|' + shot.refImg : '') + ((shot.keyIdx ?? 0) ? `#t${shot.keyIdx}` : ''), 'tall')} alt="" />
                : <div className="card__none"><Icon name="image" />未生成关键帧</div>}
          </div>
          <Button style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
            onClick={() => { useProject.getState().genKey(shot.id); toast(`「${shot.id}」关键帧已生成 · 消耗 2 积分`); }}>
            <Icon name="image" />{shot.key ? '重新生成关键帧' : '生成关键帧'}
          </Button>

          <div className="sec" style={{ margin: '18px 0 8px' }}>参考图</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ToggleChip on={!shot.refImg} title="不绑定具体参考图，纯按提示词生成"
              style={{ width: 44, height: 62, fontSize: 10, color: 'var(--color-text-tertiary)' }}
              onClick={() => useProject.getState().setShotRefImg(shot.id, '')}>
              自动
            </ToggleChip>
            {shot.refs.map((aid) => {
              const a = assets.find((x) => x.aid === aid);
              const v = a?.views.find((x) => x.gen);
              if (!a || !v) return null;
              return (
                <ToggleChip key={aid} on={shot.refImg === aid}
                  title={`${aid} · ${v.name} · ${v.style}`} style={{ width: 44, padding: 0 }}
                  onClick={() => useProject.getState().setShotRefImg(shot.id, aid)}>
                  <img className="ph" src={imgUrlFor(a.id + String(a.ver) + v.name + v.style + v.redo, 'portrait')} alt="" />
                  <span style={{ fontSize: 9, lineHeight: 1.2 }}>{a.name.split(' ')[0]}</span>
                </ToggleChip>
              );
            })}
            {!shot.refs.length && <span className="t-cap dim" style={{ alignSelf: 'center' }}>先在右侧勾选引用资产</span>}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {bad.length > 0 && <Warn>引用了未定稿资产 {bad.join('、')} — 无法绑定参考图，模型会自由发挥</Warn>}
          {drift.length > 0 && <Warn>{drift.join('、')} 已升版，此镜仍引用旧版 — 待确认是否重摇</Warn>}

          <div className="sbsec" style={{ margin: '2px 0 6px' }}>画面内容</div>
          <div className="cine__row" style={{ paddingTop: 2 }}>
            <span className="cine__lab">画风</span>
            <div className="cine__opts">
              {['全局', ...STYLES].map((z) => (
                <ToggleChip key={z} on={z === (shot.style || '全局')}
                  onClick={() => {
                    if (z === '全局') patch({ style: undefined }); else patch({ style: z });
                    toast(`「${shot.id}」画风改为「${z}」`);
                  }}>{z}</ToggleChip>
              ))}
            </div>
          </div>
          <div className="cine__row">
            <span className="cine__lab">资产</span>
            <div className="cine__opts">
              {assets.map((a) => {
                const on = shot.refs.includes(a.aid);
                const lock = a.status === 'locked';
                return (
                  <ToggleChip key={a.aid} on={on}
                    title={`${a.aid}${lock ? '' : ' · 未定稿，绑不上参考图'}`}
                    onClick={() => useProject.getState().toggleShotRef(shot.id, a.aid)}>
                    {a.name.split(' ')[0]}{on && !lock ? ' ⚠' : ''}
                  </ToggleChip>
                );
              })}
            </div>
          </div>
          <div className="cine__row">
            <span className="cine__lab">本镜内容</span>
            <div className="cine__opts" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <Textarea rows={2} value={shot.own}
                onChange={(e) => patch({ own: e.target.value })}
                placeholder="这一镜实际发生什么：动作、事件、细节" />
            </div>
          </div>

          <div className="sbsec sbsec--spaced">合成结果 · {segs.length} 段</div>
          {shot.ejected ? (
            <>
              <Textarea rows={5} spellCheck={false}
                style={{ border: '1px solid var(--color-warning)' }}
                value={shot.custom ?? segmentsText(segs)}
                onChange={(e) => patch({ custom: e.target.value })} />
              <div className="t-cap" style={{ color: 'var(--color-warning)', marginTop: 6 }}>
                已脱管 — 手写内容优先，上面的选择器不再影响它
              </div>
            </>
          ) : (
            <PromptBox segs={segs} />
          )}

          <RunBar shot={shot} running={running}
            onModel={(m) => { patch({ model: m }); toast(`「${shot.id}」模型改为「${m}」`); }}
            onRatio={(r) => patch({ ratio: r })}
            onBatch={(b) => patch({ batch: b })}
            onRun={onRun} />

          <VerdictToggle verdict={shot.verdict} onVerdict={verdict} extra={
            <Button onClick={() => {
              patch({ ejected: !shot.ejected });
              toast(shot.ejected ? '已恢复自动合成' : '此镜已脱管：资产升版时不再自动同步，会单独列出来让你确认');
            }}>
              {shot.ejected ? '恢复自动合成' : '手改提示词'}
            </Button>
          } />

          {!running && (
            <TakeGrid shot={shot}
              onSelect={(idx) => { patch({ keyIdx: idx }); toast(`已选第 ${idx + 1} 张候选作为关键帧`); }} />
          )}
        </div>
      </div>
    </>
  );
}

/* 局部小件 */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="blk"><div className="blk__body">{children}</div></div>;
}
function Warn({ children }: { children: React.ReactNode }) {
  return <div className="sbwarn"><Icon name="refresh" />{children}</div>;
}
