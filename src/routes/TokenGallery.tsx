import { useEffect, useState } from 'react';
import { cssVar } from '@/lib/cssVar';
import { getTheme, setTheme, type Theme } from '@/lib/theme';

/* 从计算样式读，而不是在这里重抄一遍值 —— 抄就会漂移 */
const SURFACES = ['canvas', 'surface', 'sidebar', 'muted', 'hover'];
const INKS = ['ink', 'ink-muted', 'ink-faint', 'ink-disabled'];
const LINES = ['line-soft', 'line', 'line-strong', 'line-focus'];
const ACCENTS = ['accent', 'accent-hover', 'accent-active', 'accent-soft', 'accent-subtle'];
const STATUS = ['success', 'success-bg', 'warning', 'warning-bg', 'error', 'error-bg', 'info', 'info-bg'];
const DATA = ['data-1', 'data-1-soft', 'data-2', 'data-2-soft', 'data-3', 'data-3-soft',
  'data-4', 'data-4-soft', 'data-5', 'data-5-soft'];
const SCENE = ['scene-bg', 'scene-floor', 'scene-prop', 'scene-mark', 'scene-label',
  'gizmo-cam', 'model-base', 'model-mid', 'model-shade'];

const RADII = ['xs', 'chip', 'control', 'tile', 'card', 'shell'];
const SPACES = ['1', '2', '3', '4', '5', '6', '8', '10', '12'];
const TEXTS: Array<[string, string]> = [
  ['axis', '坐标轴 11'], ['caption', '辅助 12'], ['label', '标签 13'], ['body', '正文 14'],
  ['title', '标题 16'], ['metric-sm', '数值 20'], ['metric', '大数值 24'],
];
const SHADOWS = ['card', 'raised', 'shell', 'accent', 'focus'];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-title font-semibold">{title}</h2>
        {note && <span className="text-caption text-ink-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name }: { name: string }) {
  const [value, setValue] = useState('');
  useEffect(() => setValue(cssVar(`--color-${name}`)), [name]);
  return (
    <div className="rounded-tile border border-line-soft bg-surface overflow-hidden">
      <div className="h-14 border-b border-line-soft" style={{ background: `var(--color-${name})` }} />
      <div className="px-3 py-2">
        <div className="text-caption font-medium">{name}</div>
        <div className="text-axis text-ink-faint tnum">{value || '—'}</div>
      </div>
    </div>
  );
}

function Grid({ names }: { names: string[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {names.map((n) => <Swatch key={n} name={n} />)}
    </div>
  );
}

export function TokenGallery() {
  const [theme, setLocal] = useState<Theme>(getTheme);

  useEffect(() => { setTheme(theme); }, [theme]);

  return (
    <div className="min-h-full bg-canvas text-ink">
      <header
        className="sticky top-0 z-10 flex items-center gap-3 border-b border-line-soft bg-surface px-6"
        style={{ height: 'var(--header-h)' }}
      >
        <span className="text-title font-bold tracking-tight">设计 Token</span>
        <span className="text-caption text-ink-faint">阶段 0 验收页 · 全部从计算样式读取</span>
        <div className="ml-auto flex items-center gap-2">
          {(['light', 'dark'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setLocal(t)}
              aria-pressed={theme === t}
              className="rounded-full border px-3 py-1 text-caption transition-colors
                         aria-pressed:border-accent aria-pressed:text-accent
                         border-line text-ink-muted hover:border-line-strong"
            >
              {t === 'light' ? '浅色' : '深色'}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Section title="表面" note="bg-canvas / bg-surface / bg-muted …">
          <Grid names={SURFACES} />
        </Section>

        <Section title="文字" note="text-ink / text-ink-muted …">
          <Grid names={INKS} />
        </Section>

        <Section title="描边" note="border-line / border-line-strong …">
          <Grid names={LINES} />
        </Section>

        <Section title="强调" note="全局占比约 10%，唯一强调色">
          <Grid names={ACCENTS} />
        </Section>

        <Section title="状态" note="warning 与 data-3 是两个 token，不要合并">
          <Grid names={STATUS} />
        </Section>

        <Section title="数据编码" note="图表与提示词片段来源上色共用这一组">
          <Grid names={DATA} />
        </Section>

        <Section title="3D 场景" note="供 useSceneColors 读取，切主题时场景一并变">
          <Grid names={SCENE} />
        </Section>

        <Section title="圆角" note="五档刻度，分层的关键">
          <div className="flex flex-wrap items-end gap-4">
            {RADII.map((r) => (
              <div key={r} className="text-center">
                <div
                  className="mb-2 h-16 w-16 border border-line bg-muted"
                  style={{ borderRadius: `var(--radius-${r})` }}
                />
                <div className="text-caption">{r}</div>
                <div className="text-axis text-ink-faint tnum">{cssVar(`--r-${r}`)}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="间距" note="基准 4px；p-4 = 16px">
          <div className="flex flex-wrap items-end gap-4">
            {SPACES.map((s) => (
              <div key={s} className="text-center">
                <div className="mb-2 bg-accent-soft" style={{ width: `var(--s-${s})`, height: 40 }} />
                <div className="text-axis text-ink-faint tnum">{cssVar(`--s-${s}`)}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="字阶">
          <div className="rounded-card border border-line-soft bg-surface p-5">
            {TEXTS.map(([k, label]) => (
              <div key={k} className="flex items-baseline gap-4 border-b border-line-soft py-2 last:border-0">
                <span className="w-24 text-axis text-ink-faint">{k}</span>
                <span style={{ fontSize: `var(--fs-${k})`, lineHeight: `var(--lh-${k})` }}>
                  {label} · 布光台 Storyboard 1234
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="阴影" note="冷调、极低不透明度；分区靠描边而非阴影">
          <div className="flex flex-wrap gap-6">
            {SHADOWS.map((s) => (
              <div key={s} className="text-center">
                <div
                  className="mb-2 h-16 w-24 rounded-card bg-surface"
                  style={{ boxShadow: `var(--shadow-${s})` }}
                />
                <div className="text-caption">{s}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="结构尺寸" note="改布局只动 tokens.component.css">
          <div className="rounded-card border border-line-soft bg-surface p-5 text-label">
            {['sidebar-width', 'header-h', 'rail-width', 'explorer-tree-w', 'stage-box',
              'control-h', 'table-row-h', 'view-thumb-w'].map((k) => (
              <div key={k} className="flex justify-between border-b border-line-soft py-2 last:border-0">
                <span className="text-ink-muted">--{k}</span>
                <span className="tnum">{cssVar(`--${k}`)}</span>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}

/* 工具类探针：Tailwind 按需生成，没被引用的类不会进产物。
   这些类阶段 1 的组件会用到，先在此引用一次，确认 token → 工具类链路已通。 */
export const __utilityProbe = [
  'shadow-card', 'shadow-raised', 'shadow-accent',
  'bg-data-1', 'bg-data-2', 'bg-data-3', 'bg-data-4', 'bg-data-5',
  'bg-data-1-soft', 'text-data-1', 'text-data-5',
  'bg-success-bg', 'text-success', 'bg-warning-bg', 'text-warning',
  'bg-error-bg', 'text-error', 'text-on-accent', 'bg-accent',
  'rounded-chip', 'rounded-control', 'rounded-tile', 'rounded-shell',
  'text-axis', 'text-caption', 'text-label', 'text-body', 'text-metric',
].join(' ');
