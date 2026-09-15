import { useState } from 'react';
import { Icon } from '@/ui/Icon';
import { Modal } from '@/ui/Modal';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import type { Asset } from '@/domain/assets/model';

/**
 * 新增形状照。走 Modal 原语（Esc 关闭、遮罩关闭、统一的头与页脚），
 * 内容自己带内边距 —— .mo__box 本身不给 padding。
 */
export function NewViewModal({ open, onClose, asset }: {
  open: boolean;
  onClose: () => void;
  asset: Asset | undefined;
}) {
  const styles = useProject((s) => s.styles);
  const projectStyle = useProject((s) => s.style);
  const addAssetView = useProject((s) => s.addAssetView);
  const selectAsset = useUi((s) => s.selectAsset);
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('全局');

  if (!open || !asset) return null;

  const close = () => { setName(''); setPrompt(''); onClose(); };

  const submit = () => {
    const n = name.trim();
    const p = prompt.trim();
    if (!n || !p) { toast('名称和提示词都要填，才能生成'); return; }
    if (asset.views.some((v) => v.name === n)) { toast('已经有同名形状照了，换个名称'); return; }
    addAssetView(asset.id, n, style, p);
    selectAsset(asset.id, n);
    toast(`已添加「${n}」并按「${style === '全局' ? projectStyle : style}」生成`);
    close();
  };

  return (
    <Modal open onClose={close} title={`新增形状照 · ${asset.name}`}
      subtitle="可单独调机位与画风"
      boxStyle={{ maxWidth: 520 }}
      footer={<>
        <button className="tbtn" onClick={close}>取消</button>
        <button className="ds-btn ds-btn--primary" style={{ height: 36, fontSize: 13 }} onClick={submit}>
          <Icon name="spark" />生成并添加
        </button>
      </>}>
      <div className="mo__form">
        <label className="mo__field">
          <span className="sec">名称</span>
          <input className="nv-input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="例如：奔跑 / 俯身抚摸猫 / 雨夜远景" />
        </label>

        <label className="mo__field">
          <span className="sec">提示词</span>
          <textarea className="nv-input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述这张形状照：姿势、角度、光线、情绪……" />
        </label>

        <div className="mo__field">
          <span className="sec">画风</span>
          <div className="styles">
            <button className="sty" aria-pressed={style === '全局'} title="跟项目画风走，项目换风格这张也跟着换"
              onClick={() => setStyle('全局')}>全局 · {projectStyle}</button>
            {styles.map((s) => (
              <button key={s} className="sty" aria-pressed={s === style} onClick={() => setStyle(s)}>{s}</button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
