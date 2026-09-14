import { Meter, Panel } from '@/ui';
import { Icon } from '@/ui/Icon';

/** 记账单卡：原型 .mstat 同构 */
export function MetricCard({ label, value, unit }: {
  label: string;
  value: React.ReactNode;
  unit?: string;
}) {
  return (
    <div className="mstat">
      <span className="card__m">{label}</span>
      <b>{value}{unit && <u>{unit}</u>}</b>
    </div>
  );
}

/** 归因卡：原型 .mcharts 内的 .blk 同构（标题 + 按行 Meter + 洞察） */
export function AttributionBar({ title, sub, data, insight }: {
  title: string;
  sub: string;
  data: Record<string, { tries: number; usable: number }>;
  insight: string;
}) {
  const rows = Object.entries(data);
  return (
    <Panel bodyStyle={{ padding: '18px 20px 20px' }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div className="t-cap dim" style={{ margin: '2px 0 14px' }}>{sub}</div>
      {rows.length > 0
        ? rows.map(([k, v]) => (
          <div key={k} className="row" style={{ gap: 12, padding: '7px 0' }}>
            <span style={{ width: 110, fontSize: 13, flex: '0 0 auto' }}>{k}</span>
            <Meter ok={v.usable} total={v.tries} />
          </div>
        ))
        : <p className="t-cap dim" style={{ padding: '12px 0' }}>还没有生成记录 — 先去分镜跑两镜。</p>}
      <div className="minsight"><Icon name="spark" />{insight}</div>
    </Panel>
  );
}
