import { Button, Select } from '@/ui';
import { Icon } from '@/ui/Icon';
import { useProject } from '@/store/project';
import type { Shot } from '@/domain/shots/model';

/** 消耗标签：本次 / 累计 */
export function CostTag({ shot, cost }: { shot: Shot; cost: number }) {
  return (
    <span className="t-cap dim">
      本次 <Icon name="bolt" />{cost}
      {shot.takes > 0 && <> · 此镜已花 <Icon name="bolt" />{shot.takes * 2}</>}
    </span>
  );
}

/** 运行台：原型 .runbar 同构（模型 + 画幅 + 数量 + 预计消耗 + 运行）。模型/画幅来自 mock 下发的配置 */
export function RunBar({ shot, running, onModel, onRatio, onBatch, onRun }: {
  shot: Shot;
  running: boolean;
  onModel: (m: string) => void;
  onRatio: (r: string) => void;
  onBatch: (b: number) => void;
  onRun: () => void;
}) {
  const models = useProject((s) => s.models);
  const ratios = useProject((s) => s.ratios);
  return (
    <div className="runbar" style={{ marginTop: 20 }}>
      <div className="runbar__bar" style={{ borderTop: 0, paddingTop: 0 }}>
        <Select ariaLabel="模型" options={models} value={shot.model} onChange={onModel} />
        <Select ariaLabel="画幅" options={ratios} value={shot.ratio ?? '9:16'} onChange={onRatio} />
        <Select ariaLabel="一次生成几版"
          options={[1, 2, 4, 8].map((b) => ({ value: String(b), label: `×${b}` }))}
          value={String(shot.batch)} onChange={(v) => onBatch(Number(v))} />
        <div className="spacer" />
        <CostTag shot={shot} cost={2 * shot.batch} />
        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
          loading={running} iconBefore={<Icon name="play" />} onClick={onRun}>
          运行
        </Button>
      </div>
    </div>
  );
}
