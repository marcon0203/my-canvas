import { Icon } from '@/ui/Icon';
import { imgUrlFor } from '@/lib/media';
import type { Asset, AssetView } from '@/domain/assets/model';

/** 形状照切换条：原型 .vbar/.apv__strip/.vt 同构 */
export function ViewStrip({ asset, current, onSelect, onAdd, onApplyPeers }: {
  asset: Asset;
  current: AssetView;
  onSelect: (v: AssetView) => void;
  onAdd: () => void;
  onApplyPeers: () => void;
}) {
  const gen = asset.views.filter((v) => v.gen).length;
  return (
    <div className="vbar">
      <div className="vbar__h">
        <span className="sec" style={{ margin: 0 }}>形状照</span>
        <span className="t-cap dim">{gen}/{asset.views.length} 已生成</span>
        <div className="spacer" />
        <button className="tbtn" title="机位、灯光、器材套到本资产其它形状照，景别各留各的" onClick={onApplyPeers}>
          <Icon name="layers" />套用到其它形状照
        </button>
      </div>
      <div className="apv__strip">
        {asset.views.map((v) => (
          <button key={v.name} className={v === current ? 'vt vt--on' : 'vt'}
            aria-pressed={v === current}
            title={`${v.name} · ${v.style}${v.gen ? '' : ' · 未生成'}`}
            onClick={() => onSelect(v)}>
            <span className="vt__pic">
              {v.gen
                ? <img className="ph" src={imgUrlFor(asset.id + String(asset.ver) + v.name + v.style + v.redo, 'portrait')} alt="" />
                : <Icon name="image" />}
            </span>
            <span className="vt__k">{v.name}</span>
            {v.gen ? null : <span className="vt__dot" />}
          </button>
        ))}
        <button className="vt vt--add" title="新增形状照" onClick={onAdd}>
          <Icon name="plus" /><span className="vt__k">新增</span>
        </button>
      </div>
    </div>
  );
}
