import { Button } from '@/ui';
import { Icon } from '@/ui/Icon';
import type { Verdict } from '@/domain/shots/model';

/** 可用 / 重摇 判定行 + 右侧附加操作（手改提示词等） */
export function VerdictToggle({ verdict, onVerdict, extra }: {
  verdict: Verdict;
  onVerdict: (v: Verdict) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="row wrap" style={{ gap: 8, marginTop: 16 }}>
      <Button iconBefore={<Icon name="check" />} style={verdict === 'ok' ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : undefined} onClick={() => onVerdict('ok')}>标记可用</Button>
      <Button iconBefore={<Icon name="refresh" />} style={verdict === 'redo' ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : undefined} onClick={() => onVerdict('redo')}>重摇</Button>
      {extra}
    </div>
  );
}
