import { FramePreview } from '@/components/FramePreview';
import { INTENT, type Intent } from '@/domain/prompt/vocabulary';

/** 意图卡：原型 .intents/.intent 同构。入口不是「选景别」，是「想让观众感觉到什么」 */
export function IntentCards({ onApply }: {
  onApply: (it: Intent) => void;
}) {
  return (
    <>
      {INTENT.map((p, i) => (
        <button key={p.n} className="intent" onClick={() => onApply(p)} title={`${p.n} — ${p.d}`}>
          <span className="intent__f"><FramePreview rig={previewRigOf(p)} width={56} /></span>
          <span className="intent__n">{p.n}</span>
          <span className="intent__d">{p.d}</span>
          <span className="sr-only" data-intent={i} />
        </button>
      ))}
    </>
  );
}

function previewRigOf(p: Intent): { size: string; el?: number; az?: number; angle?: string; dof?: string; cam?: string } {
  const c = p.c;
  return {
    size: typeof c.size === 'string' ? c.size : '全景',
    angle: typeof c.angle === 'string' ? c.angle : undefined,
    dof: typeof c.dof === 'string' ? c.dof : '中等',
    cam: typeof c.cam === 'string' ? c.cam : '固定',
    el: c.angle === '俯拍' ? 38 : c.angle === '仰拍' ? -26 : 0,
    az: c.angle === '过肩' ? 150 : 0,
  };
}