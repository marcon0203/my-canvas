import { ColorPicker } from '@/ui/ColorSwatch';
import { GELS } from '@/domain/prompt/vocabulary';
import type { GelKey, Rig } from '@/domain/assets/model';
import { cn } from '@/lib/cn';

/** 色片盘：原型 .gels/.gel 同构（9 色 + 自定义取色） */
export function GelPalette({ rig, onChange }: {
  rig: Rig;
  onChange: (patch: Partial<Rig>) => void;
}) {
  return (
    <div className="gels" role="group" aria-label="色片">
      {GELS.map((g) => (
        <button key={g.k} className="gel" aria-pressed={(rig.gel || 'none') === g.k} title={g.n}
          style={{ ['--gc' as string]: g.c }}
          onClick={() => onChange({ gel: g.k as GelKey })}>
          <i /><span>{g.n}</span>
        </button>
      ))}
      <ColorPicker label="自定义" color={rig.gelHex || '#8844ff'} className={cn(rig.gel === 'custom' && 'gel--on')}
        onChange={(hex) => onChange({ gel: 'custom', gelHex: hex })} />
    </div>
  );
}
