import { useState } from 'react';
import { useNavigate } from 'react-router';
import { NewProjectModal } from './NewProjectModal';
import { BriefBox } from './BriefBox';
import { Icon } from '@/ui/Icon';
import { imgUrlFor } from '@/lib/media';
import { useProjectList } from '@/api/queries';
import { useUi } from '@/store/ui';

/**
 * 另外三种玩法。
 *
 * `todo` 的那几张**明说还没做**：走查里这三张卡点下去只弹一句
 * 「FMV Game 模式」，看起来像坏了。已经能进的（Canvas = 总览画布）
 * 就真的带人进去。
 *
 * 图标名原来写的是 `game` / `smile`，两个都不在图标表里，于是三张卡
 * 全静默回退成同一个 `image`，看起来一模一样 —— 现在图标名是类型，
 * 打错就编译不过（见 ui/Icon.tsx）。
 */
const MODES = [
  { icon: 'game', n: 'FMV Game', d: '零代码搭分支剧情树，逐节点生成片段，做多结局互动影游。', c: '2', todo: true },
  { icon: 'smile', n: 'Meme Play', d: '快速做玩梗短视频、动图与表情包，时长压在一分钟内。', c: '3', todo: true },
  { icon: 'grid', n: 'Canvas', d: '无限画布，把整条流程摆成节点图，看得见每一环的产物。', c: '4', todo: false },
] as const;

/** 首页：原型 viewHome 同构；最近的项目卡片来自 mock 注入的 store */
export function HomePage() {
  const navigate = useNavigate();
  const toast = useUi((s) => s.toast);
  const list = useProjectList();
  const [newOpen, setNewOpen] = useState(false);
  const openProject = (id: string) => navigate(`/project/${id}/outline`);

  return (
    <div className="stage"><div className="stage__body"><div className="home">
      <div className="home__head">
        <div>
          <h1 className="home__t">开始创作</h1>
          <p className="home__s">说一句你要做什么，Agent 规划好步骤，一步步跑给你看。</p>
        </div>
      </div>

      <BriefBox />

      <div className="modes">
        {MODES.map((m) => {
          // 已经能进的那张进去；还没做的那两张不装成能点
          const go = () => {
            if (m.todo) return;
            const first = (list.data ?? [])[0];
            if (first) navigate(`/project/${first.id}/overview`);
            else toast('先开一个项目，画布画的是那个项目的流程');
          };
          return (
            <div key={m.n}
              className={`mode-c mode-c--${m.c}${m.todo ? ' mode-c--todo' : ''}`}
              role={m.todo ? undefined : 'button'}
              tabIndex={m.todo ? undefined : 0}
              aria-disabled={m.todo || undefined}
              onClick={go}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
              <div className="row">
                <span className={`ds-chip ds-chip--solid ds-chip--${m.c}`}><Icon name={m.icon} /></span>
                <div className="spacer" />
                {m.todo
                  ? <span className="mode-c__soon">还没做</span>
                  : <span className="mode-c__go"><Icon name="right" /></span>}
              </div>
              <div className="mode-c__n">{m.n}</div>
              <div className="mode-c__d">{m.d}</div>
            </div>
          );
        })}
      </div>

      <div className="sec">最近的项目</div>
      <div className="cards">
        {(list.data ?? []).map((c) => (
          <div key={c.id} className="card" role="button" tabIndex={0} onClick={() => openProject(c.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') openProject(c.id); }}>
            <div className="card__pic card__pic--wide"><img className="ph" src={imgUrlFor(c.id, 'wide')} alt="" /></div>
            <div className="card__b">
              <div className="card__n">{c.proj}</div>
              <div className="card__m">{c.kind} · {c.ratio}</div>
            </div>
          </div>
        ))}
        <div className="card card--add" role="button" tabIndex={0} title="新建项目"
          onClick={() => setNewOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') setNewOpen(true); }}>
          <div className="card__add"><Icon name="plus" /><span>新建项目</span></div>
        </div>
      </div>
      <NewProjectModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div></div></div>
  );
}
