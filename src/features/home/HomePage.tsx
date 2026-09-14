import { useNavigate } from 'react-router';
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
  const openProject = (id: string) => navigate(`/project/${id}/outline`);

  return (
    <div className="stage"><div className="stage__body"><div className="home">
      <h1 className="home__t">开始创作</h1>
      <p className="home__s">从一句灵感到成片，选一条创作路径开始。</p>

      <div className="hero" role="button" tabIndex={0}
        onClick={() => { const first = list.data?.[0]; if (first) openProject(first.id); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const first = list.data?.[0]; if (first) openProject(first.id); } }}>
        <img className="ph" src={imgUrlFor('hero-cover2', 'wide')} alt="" />
        <div className="hero__scrim" />
        <div className="hero__b">
          <span className="hero__tag"><Icon name="video" />主通道 · 短剧与动画</span>
          <div className="hero__t">Start a story</div>
          <div className="hero__d">一句话灵感 → 剧本 → 资产 → 分镜 → 成片</div>
        </div>
        <span className="hero__go"><Icon name="right" /></span>
      </div>

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
            <div className="card__pic card__pic--wide"><img className="ph" src={imgUrlFor(c.seed, 'wide')} alt="" /></div>
            <div className="card__b">
              <div className="card__n">{c.title}</div>
              <div className="card__m">{c.meta}</div>
            </div>
          </div>
        ))}
        <div className="card card--add" role="button" tabIndex={0} title="新建项目"
          onClick={() => toast('新建项目：从一句灵感开始，或导入已有剧本')}
          onKeyDown={(e) => { if (e.key === 'Enter') toast('新建项目：从一句灵感开始，或导入已有剧本'); }}>
          <div className="card__add"><Icon name="plus" /><span>新建项目</span></div>
        </div>
      </div>
    </div></div></div>
  );
}
