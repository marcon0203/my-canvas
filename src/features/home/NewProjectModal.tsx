import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Icon, Input, Modal, Segmented } from '@/ui';
import { defaultMeta, newProjectId, projectSave } from '@/api/workspace';
import { useInvalidateProject } from '@/api/queries';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const RATIOS = ['9:16', '16:9', '1:1', '4:5'];
const KINDS = ['短剧', '动画', 'MV', '广告'];

/**
 * 新建项目：只问必要的三件事，剩下的都有默认值。
 *
 * 灵感**不在这里问** —— 进项目后对编剧说一句就行，那是 Agent 的活儿，
 * 在弹窗里填一段话然后什么都不发生会让人以为它没生效。
 */
export function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const workspace = useSettings((s) => s.workspace);
  const invalidate = useInvalidateProject();
  const toast = useUi((s) => s.toast);

  const [name, setName] = useState('');
  const [ratio, setRatio] = useState('9:16');
  const [kind, setKind] = useState('短剧');
  const [busy, setBusy] = useState(false);

  const close = () => { setName(''); setRatio('9:16'); setKind('短剧'); onClose(); };

  const create = async () => {
    const proj = name.trim();
    if (!proj) { toast('先给项目起个名字'); return; }
    setBusy(true);
    try {
      const { projectList } = await import('@/api/workspace');
      const taken = (await projectList(workspace)).map((p) => p.id);
      const id = newProjectId(proj, taken);
      await projectSave({
        meta: { ...defaultMeta(id, proj), ratio, kind },
        // 空项目：大纲、剧本、资产、分镜全是空的，从起草大纲开始
        acts: [], blocks: [],
        assets: { 角色: [], 场景: [], 道具: [] },
        shots: [],
      }, workspace);
      invalidate();
      close();
      navigate(`/project/${id}/outline`);
      toast(`「${proj}」建好了。跟编剧说一句灵感就能起草大纲。`);
    } catch (e) {
      toast(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="新建项目"
      footer={<>
        <Button onClick={close}>取消</Button>
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          <Icon name="check" />{busy ? '创建中' : '创建'}
        </Button>
      </>}>
      <div className="mo__form">
        <div className="mo__field">
          <span className="sec">项目名</span>
          <Input value={name} autoFocus placeholder="例如：猫的梦"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void create(); }} />
          <span className="t-cap dim">也是它在工作空间里的目录名，之后能认出来是哪个</span>
        </div>
        <div className="mo__field">
          <span className="sec">画幅</span>
          <Segmented ariaLabel="画幅" items={RATIOS.map((r) => ({ key: r, label: r }))}
            value={ratio} onChange={setRatio} />
          <span className="t-cap dim">之后可以改，分镜里还能给单个镜头单独设</span>
        </div>
        <div className="mo__field">
          <span className="sec">类型</span>
          <Segmented ariaLabel="类型" items={KINDS.map((k) => ({ key: k, label: k }))}
            value={kind} onChange={setKind} />
        </div>
      </div>
    </Modal>
  );
}
