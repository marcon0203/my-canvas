import { Icon } from '@/ui/Icon';
import { AttributionBar, MetricCard } from '@/components/MetricCard';
import { Chip } from '@/ui';
import { StageBar } from '@/components/StageBar';
import { byModel, bySize, hitRate, totalTries, usableShots } from '@/domain/metrics/model';
import { useProject, useAssetList } from '@/store/project';
import { useUi, type Step } from '@/store/ui';

/** 数据看板：原型 viewMetrics 同构（.mhero__ring/.mstats/.mcharts/.mstep） */
export function MetricsPage() {
  const shots = useProject((s) => s.shots);
  const acts = useProject((s) => s.acts);
  const blocks = useProject((s) => s.blocks);
  const credits = useProject((s) => s.credits);
  const budget = useProject((s) => s.budget);
  const assets = useAssetList();
  const setStep = useUi((s) => s.setStep);

  const spent = budget - credits;
  const hit = hitRate(shots);
  const tries = totalTries(shots);
  const usable = usableShots(shots);
  const okDur = shots.filter((s) => s.verdict === 'ok').reduce((n, s) => n + s.dur, 0);
  const totalDur = shots.reduce((n, s) => n + s.dur, 0);
  const lockedN = assets.filter((a) => a.status === 'locked').length;

  const C = 2 * Math.PI * 52;
  const ringOff = C * (1 - Math.max(hit, 1) / 100);

  const steps: readonly [string, string, string, number, Step][] = [
    ['剧情大纲', 'Plot outline', `${acts.length} 幕 · ${acts.flatMap((a) => a.beats).length} 场`, 1, 'outline'],
    ['剧本', 'Script', `${blocks.length} 个块`, 1, 'script'],
    ['资产', 'Assets', `${lockedN}/${assets.length} 已定稿`, assets.length ? lockedN / assets.length : 0, 'assets'],
    ['分镜', 'Storyboard', `${usable}/${shots.length} 可用 · 命中率 ${hit}%`, shots.length ? usable / shots.length : 0, 'storyboard'],
    ['剪辑', 'Editing', `${okDur}s / ${totalDur}s 可用素材`, totalDur ? okDur / totalDur : 0, 'editing'],
  ];

  return (
    <div className="stage">
      <StageBar
        title="Metrics"
        pills={<>
          <Chip tone="a">增强模块</Chip>
          <Chip><Icon name="bolt" />已消耗 {spent} 积分</Chip>
        </>}
      />

      <div className="stage__body"><div className="pad" style={{ maxWidth: 1080 }}>

        <div className="blk" style={{ marginBottom: 16 }}><div className="blk__body" style={{ padding: '26px 28px', display: 'flex', gap: 36, alignItems: 'center' }}>
          <div className="mhero__ring">
            <svg width="132" height="132" viewBox="0 0 132 132">
              <circle cx="66" cy="66" r="52" fill="none" stroke="var(--color-bg-muted)" strokeWidth="11" />
              <circle cx="66" cy="66" r="52" fill="none" stroke="var(--color-accent)" strokeWidth="11"
                strokeLinecap="round" strokeDasharray={C.toFixed(1)} strokeDashoffset={ringOff.toFixed(1)}
                transform="rotate(-90 66 66)" />
            </svg>
            <div className="mhero__num"><span><b>{hit}</b><i>%</i></span><em>命中率</em></div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-.01em' }}>生产记账</div>
            <div className="t-cap dim" style={{ margin: '3px 0 18px' }}>
              命中率 = 可用镜头 ÷ 累计生成次数。这个数字决定第二部片能不能比第一部便宜。
            </div>
            <div className="mstats">
              <MetricCard label="累计生成" value={tries} />
              <MetricCard label="可用镜头" value={usable} />
              <MetricCard label="单条可用成本" value={usable ? (spent / usable).toFixed(1) : '—'} unit="积分" />
            </div>
          </div>
        </div></div>

        <div className="mcharts">
          <AttributionBar title="按模型归因" sub="同一批镜头，不同模型的出片稳定性"
            data={byModel(shots)} insight="命中率高的模型，下一部片优先排它。" />
          <AttributionBar title="按景别归因" sub="哪种镜头最费生成次数"
            data={bySize(shots)} insight="难的景别一眼看得出来。下一部片排产时把它们前置。" />
        </div>

        <div className="blk" style={{ marginTop: 16 }}><div className="blk__body" style={{ padding: '6px 20px' }}>
          {steps.map(([zh, en, d, p, stepK], i) => (
            <div key={zh} className={i < steps.length - 1 ? 'mstep mstep--line' : 'mstep'}>
              <button className="row" style={{ width: '100%', background: 'none', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => setStep(stepK)}>
                <span className="mstep__n">{zh}<small>{en}</small></span>
                <span className="t-cap muted">{d}</span>
                <div className="spacer" />
                <Chip tone={p >= 1 ? 'ok' : 'neutral'}>{p >= 1 ? '完成' : p > 0 ? '进行中' : '未开始'}</Chip>
              </button>
              <div className="mstep__track"><div className="mstep__fill" style={{ width: `${Math.max(p * 100, 2)}%` }} /></div>
            </div>
          ))}
        </div></div>
      </div></div>
    </div>
  );
}
