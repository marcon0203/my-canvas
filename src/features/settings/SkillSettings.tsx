import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Input, Modal } from '@/ui';
import {
  isDesktop, skillBody, skillFork, skillImport, skillsDir, skillsList, skillsReveal,
  type SkillList as SkillList_, type SkillRoot,
} from '@/api/desktop';
import type { SkillMeta } from '@/domain/skills/loader';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * Skill 管理 · 列表页。
 *
 * 这一页只讲**文件**：磁盘上有哪些 Skill、从哪个目录来的、能不能改。
 *
 * 「哪件任务由谁负责」以前也挤在这一页（叫「功能清单」），现在搬到了
 * 智能体管理下面的「任务分工」—— 那张表四列里有三列讲的是智能体的分工，
 * 只有「实现方式」和 Skill 文件有关；进这一页的人是来管文件的，不是来调分工的。
 */
export function SkillList({ onOpen }: { onOpen: (id: string) => void }) {
  const [loaded, setLoaded] = useState<SkillList_ | null>(null);
  const [adding, setAdding] = useState(false);
  const workspace = useSettings((s) => s.workspace);
  const toast = useUi((s) => s.toast);
  const reload = () => { void skillsList(workspace).then(setLoaded); };
  useEffect(() => { void skillsList(workspace).then(setLoaded); }, [workspace]);

  /** 复制一份内置的到工作空间，之后改副本就生效 */
  const fork = async (name: string) => {
    try {
      await skillFork(name, workspace);
      toast(`已复制「${name}」到工作空间，修改副本即可生效`);
      reload();
    } catch (e) {
      toast(String((e as { message?: string })?.message ?? e));
    }
  };

  return (
    <>
      <div className="settabs">
        <span className="pcard__n">已安装 · {loaded?.skills.length ?? 0}</span>
        <span className="t-cap dim">
          {isDesktop() ? '内置的 + 你自己放进去的' : '浏览器里没有文件系统，只能看到内置的'}
        </span>
        <div className="spacer" />
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
      </div>

        <section className="pcard">
          {/* 标题与计数在上面那条页签位上，这儿不重复一遍 */}
          <p className="skdesc dim" style={{ marginTop: 0 }}>
            Skill 是一份写给智能体的操作说明。放入 skills 目录即生效；
            与内置同名时，以你的为准。
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
                      title="查看正文与附件">
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
                          title="复制到工作空间后即可修改，程序升级不会覆盖你的副本">
                          创建副本
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
 * 用列表里的「创建副本」—— 那时候盖住内置是你要的结果。
 */
function Roots({ roots }: { roots: readonly SkillRoot[] }) {
  if (!roots.length) return null;
  return (
    <section className="pcard">
      <header className="pcard__h">
        <span className="pcard__n">加载目录</span>
        <span className="t-cap dim">按顺序扫描，同名时以靠后的目录为准</span>
      </header>
      <ul className="issues">
        {roots.map((r) => (
          <li key={r.path} className="issue">
            <Icon name={r.wins ? 'check' : 'book'} />
            <span>
              <b>{r.name}</b>
              <span className="mono dim"> {r.path}</span>
              {!r.exists && <span className="dim"> · 目录尚未创建，放入文件时会自动建立</span>}
              {r.wins && roots.length > 1 && <span className="dim"> · 同名时以此目录为准</span>}
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
            什么时候用，下面写执行步骤。可另带 <span className="mono">references/</span>（资料）
            和 <span className="mono">scripts/</span>（脚本）。
          </span>
        </div>

        <div className="mo__field">
          <span className="sec">导入目录</span>
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
          <span className="sec">安装位置</span>
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
  // 三态：还在读 / 读到了 / 这个名字根本不存在。
  // 少了第三态的话，名字写错或那个 skill 被删掉时，页面会一直停在「读取中…」
  const [found, setFound] = useState<'loading' | 'yes' | 'no'>('loading');

  const workspace = useSettings((s) => s.workspace);
  useEffect(() => {
    setFound('loading');
    setMeta(null);
    setBody(null);
    void skillsList(workspace).then((l) => {
      const hit = l.skills.find((s) => s.name === name);
      setMeta(hit ?? null);
      setFound(hit ? 'yes' : 'no');
      if (hit) void skillBody(name, workspace).then(setBody, () => setBody(''));
    });
  }, [name, workspace]);

  if (found === 'no') {
    return (
      <section className="pcard pcard--warn">
        <header className="pcard__h">
          <Icon name="bolt" />
          <span className="pcard__n">没有叫「{name}」的 Skill</span>
        </header>
        <p className="skdesc" style={{ margin: 0 }}>
          它可能已经从 skills 目录里删掉了，或者这个名字拼错了。返回列表可以看到当前已安装的。
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">适用场景</span>
          <span className="t-cap dim">智能体仅凭这一句判断是否需要使用该 Skill</span>
          <div className="spacer" />
          {meta && <Chip>{meta.source}</Chip>}
        </header>
        <p className="skdesc">{meta?.description ?? '读取中…'}</p>
        {meta && <p className="t-cap dim mono" style={{ margin: 0 }}>{meta.dir}</p>}
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">操作说明</span>
          <span className="t-cap dim">仅在实际用到它的那一轮才载入上下文</span>
        </header>
        <pre className="skbody">{body ?? '读取中…'}</pre>
      </section>

      {meta && (meta.hasReferences || meta.hasScripts || meta.hasAssets) && (
        <section className="pcard">
          <header className="pcard__h">
            <span className="pcard__n">附带文件</span>
            <span className="t-cap dim">操作说明引用到哪个才载入哪个</span>
          </header>
          <div className="chipwall">
            {meta.hasReferences && <Chip tone="a">references/</Chip>}
            {meta.hasScripts && <Chip tone="a">scripts/</Chip>}
            {meta.hasAssets && <Chip tone="a">assets/</Chip>}
          </div>
          <p className="t-cap dim" style={{ marginTop: 12, marginBottom: 0 }}>
            scripts 目录下的是脚本，直接运行，不作为文字载入。
          </p>
        </section>
      )}
    </>
  );
}
