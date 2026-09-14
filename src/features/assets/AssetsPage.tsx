import { useState } from 'react';
import { Button, TreeItem } from '@/ui';
import { ExplorerHead } from '@/components/ExplorerHead';
import { StageBar } from '@/components/StageBar';
import { Icon } from '@/ui/Icon';
import { imgUrlFor } from '@/lib/media';
import { viewRig, type Asset, type AssetView, type Rig } from '@/domain/assets/model';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { AssetInspector } from './AssetInspector';
import { NewViewModal } from './NewViewModal';
import { StageModal } from '@/features/stage/StageModal';
import { GearModal } from '@/features/stage/GearModal';

/** 资产页：原型 viewAssets 同构（.expl 树 + .apv 检查器；弹窗走全局 modal 态） */
export function AssetsPage() {
  const assets = useProject((s) => s.assets);
  const all: Asset[] = [...assets.角色, ...assets.场景, ...assets.道具];
  const lockedN = all.filter((a) => a.status === 'locked').length;
  const batchRef = useProject((s) => s.batchRef);
  const toast = useUi((s) => s.toast);

  const assetSel = useUi((s) => s.assetSel);
  const selectAsset = useUi((s) => s.selectAsset);
  const viewSel = useUi((s) => s.viewSel);
  const modal = useUi((s) => s.modal);
  const openModal = useUi((s) => s.openModal);
  const [addOpen, setAddOpen] = useState(false);

  const a = all.find((x) => x.id === assetSel) ?? all[0];
  const v: AssetView | undefined = a
    ? (a.views.find((x) => x.name === (viewSel[a.id] ?? a.views[0]?.name)) ?? a.views[0])
    : undefined;

  const patchView = (p: Partial<Rig>) => {
    if (a && v) useProject.getState().patchViewRig(a.id, v.name, p);
  };

  /* 左树：原型 tree() 的 DOM（expl__act / expl__item--asset / expl__thumb / expl__st） */
  const tree = (['角色', '场景', '道具'] as const).map((g) => {
    const list = assets[g];
    return (
      <details key={g} className="expl__act" open>
        <summary>
          <Icon name="down" className="expl__chev" />
          <span className="expl__t">{g}</span>
          <span className="expl__count">{list.filter((x) => x.status === 'locked').length}/{list.length} 已定稿</span>
        </summary>
        <div className="expl__kids">
          {list.map((x) => {
            const gen = x.views.filter((vv) => vv.gen).length;
            const thumb = x.views.find((vv) => vv.gen);
            return (
              <TreeItem key={x.id} asset selected={x.id === a?.id} onClick={() => selectAsset(x.id)}
                thumb={thumb
                  ? <img className="ph" src={imgUrlFor(x.id + String(x.ver) + thumb.name + thumb.style + thumb.redo, 'portrait')} alt="" />
                  : <Icon name="image" />}
                title={x.name} count={`${gen}/${x.views.length}`}
                status={{
                  text: x.status === 'locked' ? `v${x.ver}` : '草稿',
                  color: x.status === 'locked' ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                }} />
            );
          })}
        </div>
      </details>
    );
  });

  return (
    <div className="stage">
      <StageBar
        title="Assets"
        pills={<span className={`pill ${lockedN === all.length ? 'pill--ok' : 'pill--warn'}`}>{lockedN}/{all.length} 已定稿</span>}
        actions={<>
          <Button onClick={() => { useProject.getState().batchRef(); toast('批量生成参考图 · 消耗 18 积分'); }}>
            <Icon name="refresh" />从剧本重新提取
          </Button>
          <Button variant="primary" style={{ height: 34, fontSize: 13 }}
            onClick={() => { batchRef(); toast('批量生成参考图 · 消耗 18 积分'); }}>
            <Icon name="image" />批量生成参考图
          </Button>
        </>}
      />

      <div className="stage__body" style={{ overflow: 'hidden' }}>
        <div className="expl">
          <div className="expl__tree">
            <ExplorerHead title="资产库" meta={`${all.length} 项`} />
            {tree}
          </div>
          <div className="expl__view">
            {a && v
              ? <AssetInspector asset={a} view={v} onAddView={() => setAddOpen(true)} />
              : <div className="blk"><div className="blk__body"><p style={{ margin: 0 }} className="t-cap dim">在左侧选一个资产，这里是它的形状照。</p></div></div>}
          </div>
        </div>
      </div>

      <NewViewModal open={addOpen} onClose={() => setAddOpen(false)} asset={a} />
      {a && v && modal === 'stage' && (
        <StageModal open onClose={() => openModal(null)} rig={viewRig(v)} onPatch={patchView}
          title={`机位与光线 · ${a.name} · ${v.name}`} />
      )}
      {a && v && modal === 'gear' && (
        <GearModal open onClose={() => openModal(null)} rig={viewRig(v)} onPatch={patchView} />
      )}
    </div>
  );
}
