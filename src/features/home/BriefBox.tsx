import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Icon } from '@/ui';
import { KINDS, detectKind, nameFromBrief, pipelineFor, skippedFor, type ProjectKind } from '@/domain/agent/pipeline';
import { INTENT_META } from '@/domain/agent/roster';
import { defaultMeta, newProjectId, projectList, projectSave } from '@/api/workspace';
import { isDesktop } from '@/api/desktop';
import { useInvalidateProject } from '@/api/queries';
import { useAgent } from '@/store/agent';
import { waitHydrated } from '@/store/project';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * 首页的需求输入框。
 *
 * 用户给的是「我要做什么」，不是「跑哪个 skill」。这里负责：
 * 一句需求 → 猜类型（可改）→ 建项目 → 交给 Agent 按流水线一步步跑。
 *
 * 类型是**猜的**，所以猜完要摆出来让人一眼能改，而不是闷头往下跑。
 */
export function BriefBox() {
  const navigate = useNavigate();
  const workspace = useSettings((s) => s.workspace);
  const startPipeline = useAgent((s) => s.startPipeline);
  const invalidate = useInvalidateProject();
  const toast = useUi((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const [brief, setBrief] = useState('');
  const [picked, setPicked] = useState<ProjectKind | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const guess = detectKind(brief);
  const kind = picked ?? guess.kind;
  const stages = pipelineFor(kind);
  const skipped = skippedFor(kind);
  const ready = brief.trim().length > 0;

  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const name = nameFromBrief(brief);
      const taken = (await projectList(workspace)).map((p) => p.id);
      const id = newProjectId(name, taken);
      await projectSave({
        meta: { ...defaultMeta(id, name), kind },
        acts: [],
        // 需求原文存成剧本里的第一块 —— 它是这个项目的起点，
        // 落盘后就是 script/01-需求.md，用别的编辑器也读得到
        blocks: [{
          id: 'brief', type: 'text', label: '需求',
          body: [brief.trim(), files.length ? `\n\n附件：${files.map((f) => f.name).join('、')}` : ''].join(''),
        }],
        assets: { 角色: [], 场景: [], 道具: [] },
        shots: [],
      }, workspace);
      invalidate();
      navigate(`/project/${id}/outline`);

      // 清掉输入框：项目已经建出来了，这一步不该因为后面开跑失败而回滚
      const text = brief.trim();
      setBrief(''); setFiles([]); setPicked(null);

      // 等内容真的注入再开跑。等时间（原来是 900ms）会让 Agent 跑在上一个项目上
      try {
        await waitHydrated(id);
        startPipeline(text, kind);
      } catch {
        toast(`「${name}」建好了，但没打开。去首页的最近项目里点开它，再跟编剧说一句。`);
      }
    } catch (e) {
      // 建项目失败：多半是工作空间写不进去（路径不存在、没权限、磁盘满）
      const msg = String((e as { message?: string })?.message ?? e);
      toast(`建项目失败：${msg}。去设置 → 工作空间确认那个目录能写。`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="brief">
      <textarea className="brief__in" value={brief} rows={3}
        placeholder="说一句你要做什么。例如：做一支洗发水宣传片，突出「洗完第二天还蓬松」；或者：一只猫在雨夜生病，小女孩抱着它跑去医院"
        onChange={(e) => setBrief(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void go(); }} />

      {files.length > 0 && (
        <div className="brief__files">
          {files.map((f) => (
            <span key={f.name} className="brief__file">
              <Icon name="image" />{f.name}
              <button className="brief__x" aria-label={`移除 ${f.name}`}
                onClick={() => setFiles((p) => p.filter((x) => x.name !== f.name))}>
                <Icon name="x" />
              </button>
            </span>
          ))}
          {!isDesktop() && (
            <span className="t-cap dim">浏览器里只记文件名 —— 装成桌面端后才会真的存进项目目录</span>
          )}
        </div>
      )}

      <div className="brief__bar">
        <input ref={fileRef} type="file" multiple hidden
          accept="image/*,audio/*,video/*,.txt,.md,.pdf,.docx"
          onChange={(e) => {
            const next = [...e.target.files ?? []];
            setFiles((p) => [...p, ...next.filter((f) => !p.some((x) => x.name === f.name))]);
            e.target.value = '';
          }} />
        <button className="tbtn" title="参考图、音乐、已有剧本都可以"
          onClick={() => fileRef.current?.click()}>
          <Icon name="plus" />附件
        </button>

        <span className="brief__kinds">
          {KINDS.map((k) => (
            <button key={k} className={`brief__k${k === kind ? ' brief__k--on' : ''}`}
              onClick={() => setPicked(k)}>
              {k}
            </button>
          ))}
        </span>

        <div className="spacer" />
        <Button variant="primary" disabled={!ready || busy} onClick={() => void go()}>
          <Icon name="right" />{busy ? '创建中' : '开始'}
        </Button>
      </div>

      {ready && (
        <div className="brief__plan">
          <span className="t-cap dim">
            {picked
              ? `按「${kind}」来`
              : guess.matched.length
                ? `看到「${guess.matched.join('、')}」，当成${kind}。不对就点上面改`
                : `没看出明确类型，按${kind}来。不对就点上面改`}
            {' · '}{stages.length} 步
          </span>
          <div className="brief__steps">
            {stages.map((s, i) => (
              <span key={s.kind} className="brief__step" title={s.why}>
                <span className="brief__n">{i + 1}</span>
                {INTENT_META[s.kind].name}
              </span>
            ))}
          </div>
          {skipped.map((s) => (
            <span key={s.kind} className="t-cap dim">跳过「{s.name}」—— {s.why}</span>
          ))}
          <span className="t-cap dim">
            每一步出产物等你点头再往下走。想让它自己跑完，去设置 → 智能体管理把自主度改成「自主执行」。
          </span>
        </div>
      )}
    </section>
  );
}
