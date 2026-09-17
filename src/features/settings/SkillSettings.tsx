import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Input, Modal, Select, Tabs } from '@/ui';
import {
  isDesktop, skillBody, skillFork, skillImport, skillsDir, skillsList, skillsReveal,
  type SkillList as SkillList_, type SkillRoot,
} from '@/api/desktop';
import { SKILL_FOR_INTENT } from '@/api/agent';
import type { SkillMeta } from '@/domain/skills/loader';
import { INTENT_META, roster, personaById } from '@/domain/agent/roster';
import type { AgentId } from '@/domain/agent/roster';
import { TOOLS_FOR_INTENT, toolOf } from '@/domain/agent/tools';
import { defaultConfig, ownerOfConfigured } from '@/domain/agent/config';
import {
  GOTO_LABEL, SKILLS, TRIGGER_WEIGHT, skillOf, toolsOf, triggersOf,
} from '@/domain/agent/skills';
import type { SkillId } from '@/domain/agent/skills';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Field, Fields } from './Field';

/** 换负责人：从原来那位身上摘掉，给新的一位补上这个功能与它需要的工具 */
function useReassign() {
  const agents = useSettings((s) => s.agents);
  const patch = useSettings((s) => s.patchAgent);
  const toast = useUi((s) => s.toast);

  return (kind: SkillId, to: AgentId | '') => {
    for (const p of roster()) {
      const cur = agents[p.id] ?? defaultConfig(p);
      const has = cur.skills.includes(kind);
      if (p.id === to && !has) {
        patch(p.id, {
          skills: [...cur.skills, kind],
          tools: [...new Set([...cur.tools, ...TOOLS_FOR_INTENT[kind]])],
        });
      } else if (p.id !== to && has) {
        patch(p.id, { skills: cur.skills.filter((x) => x !== kind) });
      }
    }
    toast(to
      ? `「${INTENT_META[kind].name}」交给${personaById(to).name}`
      : `「${INTENT_META[kind].name}」暂时没有负责人，用户提到时会被告知做不了`);
  };
}

function OwnerSelect({ kind }: { kind: SkillId }) {
  const agents = useSettings((s) => s.agents);
  const reassign = useReassign();
  return (
    <Select ariaLabel={`${INTENT_META[kind].name} 由谁负责`}
      value={ownerOfConfigured(kind, agents) ?? ''}
      options={[
        { value: '', label: '无人负责' },
        ...roster().map((p) => ({ value: p.id, label: p.name })),
      ]}
      onChange={(v) => reassign(kind, v as AgentId | '')} />
  );
}

/** 列表页分两页：一页是装了哪些 Skill 文件，一页是功能由谁负责 */
type Tab = 'files' | 'jobs';

/**
 * Skill 管理 · 列表页。
 *
 * 两件事分两页：
 * - 已安装：磁盘上有哪些 Skill 文件、从哪个目录来的、能不能改
 * - 功能清单：每个功能由哪位智能体负责，做法是写在 Skill 文件里还是内置在程序里
 *
 * 分页是因为操作对象不一样 —— 一个是文件，一个是分工。挤在一页时，
 * 「我的 Skill 装上了吗」和「这件事谁做」的答案交错排着，两个都不好找。
 *
 * 没有负责人的功能不放进页签里 —— 那是真问题，藏在另一页后面就发现不了。
 */
export function SkillList({ onOpen }: { onOpen: (id: string) => void }) {
  const agents = useSettings((s) => s.agents);
  const [loaded, setLoaded] = useState<SkillList_ | null>(null);
  const [tab, setTab] = useState<Tab>('files');
  const [adding, setAdding] = useState(false);
  const workspace = useSettings((s) => s.workspace);
  const toast = useUi((s) => s.toast);
  const reload = () => { void skillsList(workspace).then(setLoaded); };
  useEffect(() => { void skillsList(workspace).then(setLoaded); }, [workspace]);

  const orphans = SKILLS.filter((s) => !ownerOfConfigured(s.id, agents));
  const migrated = new Set(Object.values(SKILL_FOR_INTENT));

  /** 复制一份内置的到工作空间，之后改副本就生效 */
  const fork = async (name: string) => {
    try {
      await skillFork(name, workspace);
      toast(`已复制「${name}」到工作空间，改那份就生效`);
      reload();
    } catch (e) {
      toast(String((e as { message?: string })?.message ?? e));
    }
  };

  return (
    <>
      {orphans.length > 0 && (
        <section className="pcard pcard--warn">
          <header className="pcard__h">
            <Icon name="bolt" />
            <span className="pcard__n">{orphans.length} 个功能没有负责人</span>
          </header>
          <p className="skdesc" style={{ margin: 0 }}>
            <b>{orphans.map((s) => s.name).join('、')}</b>
            ：现在谁都不会做。用户要求时会被告知做不了。
            到「功能清单」里的「负责人」选一位即可。
          </p>
        </section>
      )}

      <div className="settabs">
        <Tabs value={tab} onChange={setTab}
          items={[
            { key: 'files', label: `已安装 · ${loaded?.skills.length ?? 0}` },
            { key: 'jobs', label: `功能清单 · ${SKILLS.length}` },
          ]} />
        <div className="spacer" />
        {tab === 'files' && (
          <>
            {isDesktop() && (
              <Button onClick={() => {
                void skillsReveal(workspace).catch((e: unknown) =>
                  toast(String((e as { message?: string })?.message ?? e)));
              }}>
                <Icon name="home" />打开目录
              </Button>
            )}
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Icon name="plus" />添加 Skill
            </Button>
          </>
        )}
      </div>

      {tab === 'files'
        ? (
          <>
            <section className="pcard">
              <header className="pcard__h">
                <span className="pcard__n">装了哪些</span>
                <span className="t-cap dim">
                  {isDesktop() ? '内置的 + 你自己放进去的' : '浏览器里没有文件系统，只能看到内置的'}
                </span>
              </header>
              <p className="skdesc dim">
                Skill 是一份写给智能体的操作说明。放进 skills 目录就生效；
                和内置同名时，用你的那份。
              </p>
              {loaded?.skills.length
                ? (
                  <div className="sktable">
                    <div className="skhead">
                      <span /><span>名字</span><span>来源</span><span>附件</span><span />
                    </div>
                    {loaded.skills.map((m) => (
                      <div key={m.name} className="skrow">
                        <span className="skrow__ic"><Icon name="wand" /></span>
                        <button className="skrow__main" onClick={() => onOpen(m.name)}
                          title="看它的正文与附件">
                          <span className="skrow__n mono">{m.name}</span>
                          <span className="dim skrow__k">{m.description}</span>
                        </button>
                        <span className="skrow__out">{m.source}</span>
                        <span className="chipwall">
                          {m.hasReferences && <Chip>references</Chip>}
                          {m.hasScripts && <Chip>scripts</Chip>}
                          {m.hasAssets && <Chip>assets</Chip>}
                          {!m.hasReferences && !m.hasScripts && !m.hasAssets
                            && <span className="t-cap dim">只有 SKILL.md</span>}
                        </span>
                        <span className="skrow__own">
                          {m.source === '内置' && isDesktop() && (
                            <Button onClick={() => void fork(m.name)}
                              title="复制到工作空间，之后改副本就生效，升级不会覆盖">
                              改一份
                            </Button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )
                : <p className="t-cap dim" style={{ margin: 0 }}>还没有安装任何 Skill。</p>}
            </section>

            <Roots roots={loaded?.roots ?? []} />

            {!!loaded?.warnings.length && (
              <section className="pcard pcard--warn">
                <header className="pcard__h">
                  <Icon name="bolt" />
                  <span className="pcard__n">{loaded.warnings.length} 个目录没能识别</span>
                </header>
                <p className="skdesc dim" style={{ marginTop: 0 }}>
                  这些目录在 skills 里，但不是有效的 Skill，所以没有加载：
                </p>
                <ul className="issues">
                  {loaded.warnings.map((w) => (
                    <li key={w.dir} className="issue issue--warn">
                      <Icon name="x" /><span className="mono">{w.dir}</span>：{w.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )
        : (
          <section className="pcard">
            <header className="pcard__h">
              <span className="pcard__n">每个功能由谁负责</span>
              <span className="t-cap dim">
                其中 {migrated.size} 个的做法写在 Skill 文件里，可以改；其余内置在程序里
              </span>
            </header>
            <div className="sktable">
              <div className="skhead">
                <span /><span>功能</span><span>结果写到</span><span>做法</span><span>负责人</span>
              </div>
              {SKILLS.map((s) => {
                const owner = ownerOfConfigured(s.id, agents);
                const skill = SKILL_FOR_INTENT[s.id];
                return (
                  <div key={s.id} className={`skrow${owner ? '' : ' skrow--orphan'}`}>
                    <span className="skrow__ic"><Icon name={s.icon} /></span>
                    <button className="skrow__main" onClick={() => onOpen(s.id)}
                      title="查看它在什么情况下触发、需要什么前置条件、结果写到哪儿">
                      <span className="skrow__n">{s.name}</span>
                      <span className="mono dim skrow__k">{s.id}</span>
                    </button>
                    <span className="skrow__out">{s.goto ? GOTO_LABEL[s.goto] : '只出报告'}</span>
                    <span>
                      {skill
                        ? <Chip tone="ok">{skill}</Chip>
                        : <span className="t-cap dim">内置</span>}
                    </span>
                    <span className="skrow__own"><OwnerSelect kind={s.id} /></span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

      <AddSkillModal open={adding} onClose={() => setAdding(false)} onAdded={reload} />
    </>
  );
}

/**
 * 扫了哪几个目录。
 *
 * 摆出来是因为「我放的 Skill 怎么没生效」十次里有九次是放错了目录。
 *
 * 内置的那份**不会**在初始化时复制进工作空间：复制过去之后，升级带来的新版
 * 内置 Skill 会被旧副本盖掉，而界面上看不出是副本在生效。要改内置的做法，
 * 用列表里的「改一份」—— 那时候盖住内置是你要的结果。
 */
function Roots({ roots }: { roots: readonly SkillRoot[] }) {
  if (!roots.length) return null;
  return (
    <section className="pcard">
      <header className="pcard__h">
        <span className="pcard__n">从哪儿加载</span>
        <span className="t-cap dim">按顺序扫，同名时后面那份生效</span>
      </header>
      <ul className="issues">
        {roots.map((r) => (
          <li key={r.path} className="issue">
            <Icon name={r.wins ? 'check' : 'book'} />
            <span>
              <b>{r.name}</b>
              <span className="mono dim"> {r.path}</span>
              {!r.exists && <span className="dim"> · 目录还不存在，往里放东西时会自动建</span>}
              {r.wins && roots.length > 1 && <span className="dim"> · 同名时用这里的</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 添加自己的 Skill。
 *
 * 做成「填目录路径 + 导入」而不是系统文件选择框：选择框要再装一个 Tauri 插件，
 * 而这一步不常做，路径粘贴够用。导入会把整个目录**复制**进工作空间 ——
 * 只记一个指向桌面临时文件夹的路径的话，文件夹一挪，智能体就少一段说明，
 * 而且不知道是从什么时候开始少的。
 */
function AddSkillModal({ open, onClose, onAdded }: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const workspace = useSettings((s) => s.workspace);
  const toast = useUi((s) => s.toast);
  const [dir, setDir] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { void skillsDir(workspace).then(setDir); }, [workspace]);

  const close = () => {
    if (busy) return;           // 复制到一半关掉，留下的是半个 Skill，没法交代
    setPath(''); setErr('');
    onClose();
  };

  const submit = async () => {
    const v = path.trim();
    if (!v) { setErr('先填一个目录路径'); return; }
    setBusy(true); setErr('');
    try {
      const meta = await skillImport(v, workspace);
      setPath('');
      toast(`已添加「${meta.name}」，现在就能用`);
      onAdded();
      onClose();
    } catch (e) {
      // 失败原因都是可操作的（没有 SKILL.md、同名、选错目录），原话给人看
      setErr(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="添加 Skill"
      subtitle={isDesktop() ? '从一个目录导入' : '浏览器里做不了这一步'}
      footer={<>
        <Button onClick={close} disabled={busy}>取消</Button>
        <Button variant="primary" disabled={!isDesktop() || busy} onClick={() => void submit()}>
          <Icon name="check" />{busy ? '导入中' : '导入'}
        </Button>
      </>}>
      <div className="mo__form">
        <div className="mo__field">
          <span className="sec">格式要求</span>
          <span className="t-cap dim">
            一个文件夹，里面必须有 <span className="mono">SKILL.md</span>：开头写它叫什么、
            什么时候用，下面写做法。可以另带 <span className="mono">references/</span>（资料）
            和 <span className="mono">scripts/</span>（脚本）。
          </span>
        </div>

        <div className="mo__field">
          <span className="sec">要导入的目录</span>
          <Input value={path} placeholder="例如 /Users/me/我的skill/write-ad-copy"
            disabled={!isDesktop() || busy}
            onChange={(e) => { setPath(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          <span className="t-cap dim">
            {isDesktop()
              ? '填文件夹的完整路径。导入是复制一份，之后原目录挪走也不影响'
              : '浏览器里没有文件系统，这一步要在桌面端做'}
          </span>
        </div>

        <div className="mo__field">
          <span className="sec">会复制到</span>
          <span className="skplain mono">{dir || '读取中…'}</span>
          <span className="t-cap dim">也可以直接把文件夹拷进这个目录，效果一样</span>
        </div>

        {err && <span className="t-cap" style={{ color: 'var(--color-warning)' }}>{err}</span>}
      </div>
    </Modal>
  );
}

/** 一个 Skill 文件的详情。操作说明与附带文件都是点进来才读，不常驻 */
export function SkillFileDetail({ name }: { name: string }) {
  const [meta, setMeta] = useState<SkillMeta | null>(null);
  const [body, setBody] = useState<string | null>(null);

  const workspace = useSettings((s) => s.workspace);
  useEffect(() => {
    void skillsList(workspace).then((l) => setMeta(l.skills.find((s) => s.name === name) ?? null));
    void skillBody(name, workspace).then(setBody);
  }, [name, workspace]);

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">什么时候用它</span>
          <span className="t-cap dim">智能体只凭这一句判断要不要用这个 Skill</span>
          <div className="spacer" />
          {meta && <Chip>{meta.source}</Chip>}
        </header>
        <p className="skdesc">{meta?.description ?? '读取中…'}</p>
        {meta && <p className="t-cap dim mono" style={{ margin: 0 }}>{meta.dir}</p>}
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">操作说明</span>
          <span className="t-cap dim">真用到它的那一轮才会读进去</span>
        </header>
        <pre className="skbody">{body ?? '读取中…'}</pre>
      </section>

      {meta && (meta.hasReferences || meta.hasScripts || meta.hasAssets) && (
        <section className="pcard">
          <header className="pcard__h">
            <span className="pcard__n">附带文件</span>
            <span className="t-cap dim">操作说明里点到哪个才读哪个</span>
          </header>
          <div className="chipwall">
            {meta.hasReferences && <Chip tone="a">references/</Chip>}
            {meta.hasScripts && <Chip tone="a">scripts/</Chip>}
            {meta.hasAssets && <Chip tone="a">assets/</Chip>}
          </div>
          <p className="t-cap dim" style={{ marginTop: 12, marginBottom: 0 }}>
            scripts 里的是脚本，直接运行，不当文字读。
          </p>
        </section>
      )}
    </>
  );
}

/** Skill 管理 · 详情页：这个功能怎么做、由谁做、什么时候触发 */
export function SkillDetail({ id }: { id: SkillId }) {
  const agents = useSettings((s) => s.agents);
  const s = skillOf(id)!;
  const owner = ownerOfConfigured(id, agents);
  const ownerCfg = owner ? agents[owner] : undefined;
  const t = triggersOf(id);

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">这个功能做什么</span>
          <div className="spacer" />
          {s.impl.by === 'model' ? <Chip tone="ok">调模型</Chip> : <Chip>本地生成</Chip>}
        </header>
        <p className="skdesc">{s.summary}</p>
        <Fields>
          <Field label="负责人" hint={owner
            ? `由${personaById(owner).name}执行。换人时它需要的工具会自动补给新的那位。`
            : '现在无人负责，用户要求时会被告知做不了。'}>
            <OwnerSelect kind={id} />
          </Field>
          <Field label="前置条件" hint="不满足时会明确说做不了，而不是假装做完">
            <span className="skplain">{s.needs}</span>
          </Field>
          <Field label="结果">
            <span className="skplain">
              {s.goto
                ? <>先给你一份待确认的结果，点采纳后写进「{GOTO_LABEL[s.goto]}」，可以撤销</>
                : '只给一份报告，不改项目内容'}
            </span>
          </Field>
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">什么时候会触发</span>
          <span className="t-cap dim">你随手打一句话时，按这些词判断该做哪件事</span>
        </header>
        <Fields>
          <Field wide label={`动作词 · 命中一个记 ${TRIGGER_WEIGHT.act} 分`}>
            <div className="chipwall">
              {t.act.map((w) => <Chip key={w} tone="a">{w}</Chip>)}
            </div>
          </Field>
          <Field wide label={`主题词 · 命中一个记 ${TRIGGER_WEIGHT.topic} 分`}
            hint="说「按大纲拆镜」时，「拆镜」是动作、「大纲」只是背景，所以做的是分镜">
            <div className="chipwall">
              {t.topic.length
                ? t.topic.map((w) => <Chip key={w}>{w}</Chip>)
                : <span className="t-cap dim">没有主题词，只看动作</span>}
            </div>
          </Field>
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">要哪些工具</span>
          <span className="t-cap dim">
            {owner ? `勾掉任意一个，${personaById(owner).name}就接不了这件活` : '指派给谁，就自动补给谁'}
          </span>
        </header>
        <div className="chipwall">
          {toolsOf(id).map((tid) => {
            const spec = toolOf(tid);
            const missing = ownerCfg && !ownerCfg.tools.includes(tid);
            return (
              <Chip key={tid} tone={missing ? 'warn' : spec?.needs ? 'a' : undefined}>
                {spec?.name ?? tid}{missing ? ' · 缺' : ''}
              </Chip>
            );
          })}
        </div>
        <ul className="issues" style={{ marginTop: 12 }}>
          {toolsOf(id).map((tid) => {
            const spec = toolOf(tid);
            return (
              <li key={tid} className="issue">
                <Icon name={spec?.writes ? 'wand' : 'book'} />
                <span><b>{spec?.name}</b>：{spec?.desc}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">怎么实现的</span>
        </header>
        <p className="skdesc">
          {s.impl.by === 'model'
            ? <>桌面端走 Rust + Rig 真发请求，实现在 <span className="mono">{s.impl.module}</span>。浏览器里没有这条链路，会回落到本地草稿。</>
            : '还没接模型：结果按项目现状本地算出来，格式和接模型后一致。'}
        </p>
        <p className="skdesc dim">{s.impl.note}</p>
      </section>
    </>
  );
}
