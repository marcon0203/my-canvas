import { useState } from 'react';
import { Icon } from '@/ui/Icon';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import type { Asset } from '@/domain/assets/model';

/** 新增形状照：原型 openAddView 同构（.mo 弹窗 + .nv-input + .styles/.sty） */
export function NewViewModal({ open, onClose, asset }: {
  open: boolean;
  onClose: () => void;
  asset: Asset | undefined;
}) {
  const styles = useProject((s) => s.styles);
  const addAssetView = useProject((s) => s.addAssetView);
  const selectAsset = useUi((s) => s.selectAsset);
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState(styles[0] ?? '温暖手绘');

  if (!open || !asset) return null;

  const submit = () => {
    const n = name.trim();
    const p = prompt.trim();
    if (!n || !p) { toast('名称和提示词都要填，才能生成'); return; }
    if (asset.views.some((v) => v.name === n)) { toast('已经有同名形状照了，换个名称'); return; }
    addAssetView(asset.id, n, style, p);
    selectAsset(asset.id, n);
    toast(`已添加「${n}」并按「${style}」生成`);
    setName('');
    setPrompt('');
    onClose();
  };

  return (
    <div className="mo" data-close onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mo__box" style={{ maxWidth: 520 }}>
        <div className="mo__h">
          <span style={{ fontSize: 16, fontWeight: 600 }}>新增形状照 · {asset.name}</span>
          <div className="spacer" />
          <button className="tbtn" onClick={onClose}>关闭</button>
        </div>
        <div className="sec" style={{ marginBottom: 6 }}>名称</div>
        <input className="nv-input" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="例如：奔跑 / 俯身抚摸猫 / 雨夜远景" />
        <div className="sec" style={{ margin: '14px 0 6px' }}>提示词</div>
        <textarea className="nv-input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述这张形状照：姿势、角度、光线、情绪……" />
        <div className="sec" style={{ margin: '14px 0 8px' }}>风格</div>
        <div className="styles">
          {styles.map((s) => (
            <button key={s} className="sty" aria-pressed={s === style} onClick={() => setStyle(s)}>{s}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 20, gap: 10, justifyContent: 'flex-end' }}>
          <button className="tbtn" onClick={onClose}>取消</button>
          <button className="ds-btn ds-btn--primary" style={{ height: 36, fontSize: 13 }} onClick={submit}>
            <Icon name="spark" />生成并添加
          </button>
        </div>
      </div>
    </div>
  );
}
