import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/ui/Icon';

/**
 * 提示词编辑器：可直接改的提示词 + 底部参数条 + 自己的运行按钮。
 *
 * 参数（画风、画幅…）不再各占一行，而是挂在输入框底部 —— 它们是这条提示词的参数，
 * 不是页面的章节。改了提示词就脱管（不再跟参数联动），可以一键交回自动合成。
 */
export function PromptComposer({
  value, auto, ejected, onChange, onReset, onRun, running, cost, params, hint,
}: {
  /** 当前显示的提示词 */
  value: string;
  /** 自动合成的那条，用于判断「改回原样」 */
  auto: string;
  /** 是否已脱管 */
  ejected: boolean;
  /** 编辑提交（失焦或 Cmd+Enter）。与 auto 相同则传 null，交回自动合成 */
  onChange: (custom: string | null) => void;
  onReset: () => void;
  onRun: () => void;
  running?: boolean;
  cost?: number;
  /** 底部参数条：画风、画幅等 */
  params?: ReactNode;
  hint?: ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  // 外部变了（切形状照、调镜头语言）且用户没在编辑时，跟上
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === value.trim()) return;
    onChange(next && next !== auto.trim() ? next : null);
  };

  return (
    <div className="pcomp">
      <textarea
        ref={ref}
        className="pcomp__in"
        aria-label="生成提示词"
        value={draft}
        placeholder="描述你要的画面，或直接用下面的参数让它自动合成"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); onRun(); }
          if (e.key === 'Escape') { setDraft(value); ref.current?.blur(); }
        }}
      />
      <div className="pcomp__bar">
        {params}
        <div className="spacer" />
        {ejected && (
          <button className="tbtn" title="丢掉手改，交回按画风与镜头语言自动合成" onClick={onReset}>
            <Icon name="undo" />交回自动
          </button>
        )}
        {cost !== undefined && <span className="pcomp__cost"><Icon name="bolt" />{cost}</span>}
        <button className="pcomp__run" onClick={() => { commit(); onRun(); }} disabled={running}
          title="按当前这条提示词生成">
          {running ? <span className="pcomp__spin" /> : <Icon name="play" />}
          {running ? '生成中' : '运行'}
        </button>
      </div>
      {(ejected || hint) && (
        <div className="pcomp__hint">
          {ejected
            ? '这条提示词已手改 —— 不再跟画风与镜头语言联动。'
            : hint}
        </div>
      )}
    </div>
  );
}

/**
 * 参数条上的一项：标签 + 当前值。
 * `pick` 表示它能点开挑 —— 点击由外层（Popover 或按钮）接管，这里只负责长相。
 */
export function ParamChip({ label, value, title, pick, tone }: {
  label: string;
  value: ReactNode;
  title?: string;
  pick?: boolean;
  tone?: 'muted';
}) {
  const cls = `pparam${tone === 'muted' ? ' pparam--muted' : ''}${pick ? '' : ' pparam--static'}`;
  const inner = (
    <>
      <span className="pparam__k">{label}</span>
      <span className="pparam__v">{value}</span>
      {pick && <Icon name="down" className="pparam__chev" />}
    </>
  );
  return pick
    ? <button className={cls} title={title}>{inner}</button>
    : <span className={cls} title={title}>{inner}</span>;
}
