import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Input } from '@/ui';
import { isDesktop, workspaceInfo, workspacePrepare, type WorkspaceInfo } from '@/api/desktop';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Field, Fields } from './Field';

/**
 * 工作空间：用户数据的**唯一**落脚点。
 *
 * 这页要回答的就一个问题：「我的东西在哪儿」。所以真实情况（目录建没建、
 * 写不写得进去、各子目录有没有）要直接摆出来，而不是只显示一个输入框。
 */
export function WorkspaceSettings() {
  const saved = useSettings((s) => s.workspace);
  const setWorkspace = useSettings((s) => s.setWorkspace);
  const toast = useUi((s) => s.toast);

  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(saved); }, [saved]);
  useEffect(() => { void workspaceInfo(saved).then(setInfo); }, [saved]);

  const dirty = draft.trim() !== saved.trim();

  const apply = async (path: string) => {
    setBusy(true);
    try {
      if (!isDesktop()) {
        // 浏览器里没有文件系统，建不了目录 —— 只记下来，如实说明
        setWorkspace(path);
        toast('已记下路径。浏览器里建不了目录，装成桌面端后才会真的用它。');
        return;
      }
      if (path.trim()) {
        const next = await workspacePrepare(path);
        setInfo(next);
      }
      setWorkspace(path);
      toast(path.trim() ? '工作空间已切换，旧目录没有被动过' : '已改回默认 ~/.hitv');
    } catch (e) {
      toast(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">数据目录</span>
          {info && (info.source === 'default'
            ? <Chip>默认位置</Chip>
            : <Chip tone="a">自己指定的</Chip>)}
          <div className="spacer" />
          {info && isDesktop() && (info.writable
            ? <Chip tone="ok">可写</Chip>
            : <Chip tone="warn">写不进去</Chip>)}
        </header>

        <p className="skdesc">
          Skill 和项目数据都放在这个目录下。放进{' '}
          <span className="mono">{info?.root ?? '~/.hitv'}/skills</span> 的 Skill 下次运行就能用上。
        </p>

        <Fields>
          <Field label="位置"
            hint={info?.source === 'default'
              ? `没指定，用的默认位置。填别的路径可以换到任意目录，比如放进网盘同步。`
              : `不填就回到默认的 ${info?.defaultRoot ?? '~/.hitv'}`}>
            <Input value={draft} placeholder={info?.defaultRoot ?? '~/.hitv'}
              onChange={(e) => setDraft(e.target.value)} />
            <Button variant={dirty ? 'primary' : undefined} disabled={busy || !dirty}
              onClick={() => void apply(draft)}>
              <Icon name="check" />{busy ? '处理中' : '应用'}
            </Button>
            {dirty && <Button onClick={() => setDraft(saved)}>取消</Button>}
          </Field>

          <Field label="实际路径"
            hint={isDesktop()
              ? (info?.exists ? '目录已经建好了' : '目录还没建，应用时会建出来')
              : '浏览器里没有文件系统，看不到目录的真实状态。装成桌面端后这里会显示真实情况。'}>
            <span className="skplain mono">{info?.root ?? '读取中…'}</span>
          </Field>
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">目录里有什么</span>
          <span className="t-cap dim">灰掉的是还没用上的，先不建，免得目录里一堆空壳</span>
        </header>
        <div className="sktable">
          <div className="skhead">
            <span /><span>子目录</span><span>状态</span><span /><span />
          </div>
          {info?.subdirs.map((d) => (
            <div key={d.name} className={`skrow${d.used ? '' : ' atile--off'}`}>
              <span className="skrow__ic"><Icon name="image" /></span>
              <span className="skrow__main" style={{ cursor: 'default' }}>
                <span className="skrow__n mono">{d.name}/</span>
                <span className="dim skrow__k">{d.desc}</span>
              </span>
              <span className="skrow__out">
                {!d.used ? '还没用上' : d.exists ? '已建好' : '待创建'}
              </span>
              <span /><span />
            </div>
          ))}
        </div>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <Icon name="bolt" />
          <span className="pcard__n">换位置时会发生什么</span>
        </header>
        <ul className="issues">
          <li className="issue">
            <Icon name="check" />
            <span>新目录会被建出来，需要的子目录一并建好。</span>
          </li>
          <li className="issue">
            <Icon name="x" />
            <span>
              <b>旧目录里的东西不会被搬过去，也不会被删。</b>
              要迁就自己复制，确认无误再删旧的。
            </span>
          </li>
          <li className="issue">
            <Icon name="bolt" />
            <span>
              供应商配置在这儿：providers 目录下一家一个 YAML，api key 也在里面（文件权限 0600）。
              换工作空间之后要重新接入，把目录整个拷走则跟着走。
            </span>
          </li>
        </ul>
      </section>
    </>
  );
}
