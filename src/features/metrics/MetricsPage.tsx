import { Icon } from '@/ui/Icon';
import { AttributionBar, MetricCard } from '@/components/MetricCard';
import { Chip } from '@/ui';
import { StageBar } from '@/components/StageBar';
import { byModel, bySize, hitRate, totalTries } from '@/domain/metrics/model';
import { countAwaiting, countUsable, usable as isUsable } from '@/domain/shots/usable';
import { useProject, useAssetList } from '@/store/project';
import { useUi, type Step } from '@/store/ui';

/** 数据看板：原型 viewMetrics 同构（.mhero__ring/.mstats/.mcharts/.mstep） */
/** token 数好读一点。到万位就换单位 —— 一串八位数字没人读得出量级 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function MetricsPage() {
  const shots = useProject((s) => s.shots);
  const acts = useProject((s) => s.acts);
  const blocks = useProject((s) => s.blocks);
  const credits = useProject((s) => s.credits);
  const budget = useProject((s) => s.budget);
  const assets = useAssetList();
  const setStep = useUi((s) => s.setStep);

  const spent = budget - credits;
  const usage = useProject((s) => s.usage);
  const tokens = usage.inputTokens + usage.outputTokens;
  const hit = hitRate(shots);
  const tries = totalTries(shots);
  const usable = countUsable(shots);
  // 出过片但没判定的数量。命中率为 0 多半是因为它不为零 —— 界面要说出这件事，
  // 不能只把 0% 摆着让人以为模型很差
  const awaiting = countAwaiting(shots);
  const okDur = shots.filter(isUsable).reduce((n, s) => n + s.dur, 0);
  const totalDur = shots.reduce((n, s) => n + s.dur, 0);
  const lockedN = assets.filter((a) => a.status === 'locked').length;

  const C = 2 * Math.PI * 52;
  const ringOff = C * (1 - Math.max(hit, 1) / 100);

  const steps: readonly [string, string, string, number, Step][] = [
    ['剧情大纲', 'Plot outline', `${acts.length} 幕 · ${acts.flatMap((a) => a.beats).length} 场`, 1, 'outline'],
    ['剧本', 'Script', `${blocks.length} 个块`, 1, 'script'],
    ['资产', 'Assets', `${lockedN}/${assets.length} 已定稿`, assets.length ? lockedN / assets.length : 0, 'assets'],
    ['分镜', 'Storyboard',
      awaiting
        ? `${usable}/${shots.length} 判定可用 · ${awaiting} 段待判定`
        : `${usable}/${shots.length} 判定可用 · 命中率 ${hit}%`,
      shots.length ? usable / shots.length : 0, 'storyboard'],
    ['剪辑', 'Editing', `${okDur}s / ${totalDur}s 判定可用`, totalDur ? okDur / totalDur : 0, 'editing'],
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
              命中率 = 判定可用的镜头 ÷ 累计生成次数。这个数字决定第二部片能不能比第一部便宜。
            </div>
            <div className="mstats">
              <MetricCard label="累计生成" value={tries} />
              <MetricCard label="判定可用" value={usable} />
              <MetricCard label="单条可用成本（预估）"
                value={usable ? (spent / usable).toFixed(1) : '—'} unit="积分" />
            </div>
            {/* 预估与实际并排摆着。积分是本地常量拍的（大纲 2、分镜 3…），
                和厂商真实计费没有关系 —— 只摆积分的话，「已消耗 38 积分」
                会被当成真实开销 */}
            <div className="mstats" style={{ marginTop: 10 }}>
              <MetricCard label="预估消耗" value={spent} unit="积分" />
              <MetricCard label="实际用量"
                value={tokens ? fmtTokens(tokens) : '—'} unit={tokens ? 'token' : undefined} />
              <MetricCard label="进出比"
                value={usage.outputTokens ? `${(usage.inputTokens / usage.outputTokens).toFixed(1)}:1` : '—'} />
            </div>
            <p className="t-cap dim" style={{ margin: '8px 0 0' }}>
              「预估消耗」是本地按步数算的，和厂商计费无关。
              「实际用量」是厂商报回来的 token：
              进 {fmtTokens(usage.inputTokens)} / 出 {fmtTokens(usage.outputTokens)}。
              {usage.unreported > 0
                && ` 另有 ${usage.unreported} 轮那家没报用量，没算进上面这个数 —— 实际比它更多。`}
              {!tokens && ' 还没有真实用量：这个项目里的产物都是本地模板出的，或者那几家都不报用量。'}
            </p>

            {awaiting > 0 && (
              <button className="mhint" onClick={() => setStep('storyboard')}>
                <Icon name="eye" />
                <span>
                  还有 <b>{awaiting}</b> 段出过片但没判定
                  {usable === 0 && ' —— 命中率因此是 0%，不是模型不行'}。
                  逐镜判定「可用 / 重摇」之后这里才算得准。
                </span>
                <span className="mhint__go">去分镜页判定</span>
              </button>
            )}
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
