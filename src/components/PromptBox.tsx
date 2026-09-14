/** 合成结果展示：原型 .pv/.pv__s/.pv__legend 同构，片段按来源上色 */
export function PromptSegmentChip({ kind, value }: { kind: 'style' | 'ref' | 'own'; value: string }) {
  return <span className="pv__s" data-r={kind}>{value}</span>;
}

export function PromptBox({ segs }: { segs: readonly { k: 'style' | 'ref' | 'own'; v: string }[] }) {
  return (
    <>
      <div className="pv">
        {segs.map((s, i) => <PromptSegmentChip key={i} kind={s.k} value={s.v} />)}
      </div>
      <div className="pv__legend">
        <span><i style={{ background: 'var(--color-border-strong)' }} />画风</span>
        <span><i style={{ background: 'var(--color-accent)' }} />资产</span>
        <span><i style={{ background: 'var(--color-data-3)' }} />内容</span>
      </div>
    </>
  );
}
