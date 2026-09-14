import { Modal } from '@/ui';
import { GearWheel } from '@/components/GearWheel';
import type { Rig } from '@/domain/assets/model';

/** 器材弹窗：机身/镜头/焦段/光圈滚筒（GearWheel 组件） */
export function GearModal({ open, onClose, rig, onPatch }: {
  open: boolean;
  onClose: () => void;
  rig: Rig;
  onPatch: (patch: Partial<Rig>) => void;
}) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose}
      title="摄影机"
      subtitle="选真实器材，不是「标准焦段」— 光圈决定虚化，焦段决定空间压缩">
      <GearWheel rig={rig} onChange={onPatch} />
    </Modal>
  );
}
