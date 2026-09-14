/** 比率条：原型 metrics 归因条同构（track + ok/total/p% 读数） */
export function Meter({ ok, total }: { ok: number; total: number }) {
  const p = total ? Math.round((ok / total) * 100) : 0;
  return (
    <>
      <div style={{ flex: 1, minWidth: 90 }}>
        <div style={{ height: 6, borderRadius: 999, background: 'var(--color-bg-muted)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${Math.max(p, 2)}%`, borderRadius: 999,
            background: `var(--color-${p >= 25 ? 'success' : 'warning'})`,
          }} />
        </div>
      </div>
      <span className="mono" style={{ width: 76, textAlign: 'right', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {ok}/{total} · {p}%
      </span>
    </>
  );
}
