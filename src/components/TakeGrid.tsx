import { imgUrlFor } from '@/lib/media';
import type { Shot } from '@/domain/shots/model';

/**
 * 候选图网格（原型缺口的补全）：点一张换关键帧。
 * .takes/.take 样式在 prototype.css 补充段，沿用同一视觉语言。
 */
export function TakeGrid({ shot, onSelect }: {
  shot: Shot;
  onSelect: (idx: number) => void;
}) {
  if (!shot.takes) return null;
  const n = Math.min(shot.takes, 12);
  return (
    <>
      <div className="sec" style={{ margin: '18px 0 8px' }}>候选 · {shot.takes} 次生成</div>
      <div className="takes">
        {Array.from({ length: n }, (_, i) => (
          <button key={i} className="take" aria-pressed={(shot.keyIdx ?? 0) === i}
            title={`第 ${i + 1} 次抽取 · ${shot.model}`}
            onClick={() => onSelect(i)}>
            <img className="ph" src={imgUrlFor(`${shot.id}#t${i}`, 'tall')} alt="" loading="lazy" />
            <span className="take__i">{i + 1}</span>
          </button>
        ))}
      </div>
      <p className="t-cap dim" style={{ margin: '8px 0 0', lineHeight: 1.7 }}>
        点一张换关键帧，选中的就是分镜表、画布和成片里用的画面。
      </p>
    </>
  );
}
