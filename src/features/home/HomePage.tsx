import { useState } from 'react';
import { useNavigate } from 'react-router';
import { NewProjectModal } from './NewProjectModal';
import { BriefBox } from './BriefBox';
import { Icon } from '@/ui/Icon';
import { imgUrlFor } from '@/lib/media';
import { useProjectList } from '@/api/queries';
import { useUi } from '@/store/ui';

const MODES = [
  { icon: 'game', n: 'FMV Game', d: '零代码搭分支剧情树，逐节点生成片段，做多结局互动影游。', c: '2' },
  { icon: 'smile', n: 'Meme Play', d: '快速做玩梗短视频、动图与表情包，时长压在一分钟内。', c: '3' },
  { icon: 'grid', n: 'Canvas', d: '无限画布，拖拽组合 Idea / Story / Image / Video 四种节点。', c: '4' },
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
        {MODES.map((m) => (
          <div key={m.n} className={`mode-c mode-c--${m.c}`} role="button" tabIndex={0}
            onClick={() => toast(m.n + ' 模式')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toast(m.n + ' 模式'); } }}>
            <div className="row">
              <span className={`ds-chip ds-chip--solid ds-chip--${m.c}`}><Icon name={m.icon} /></span>
              <div className="spacer" />
              <span className="mode-c__go"><Icon name="right" /></span>
            </div>
            <div className="mode-c__n">{m.n}</div>
            <div className="mode-c__d">{m.d}</div>
          </div>
        ))}
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
