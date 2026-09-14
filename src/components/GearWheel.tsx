import { GEAR, GEAR_KEYS, type GearKey } from '@/domain/prompt/vocabulary';
import type { Rig } from '@/domain/assets/model';

/** 器材滚轮：原型 .wheels/.wh/.wh3 同构（CSS 3D 转轮） */
export function GearWheel({ rig, onChange }: {
  rig: Rig;
  onChange: (patch: Partial<Rig>) => void;
}) {
  const STEP = 26;
  return (
    <div className="wheels">
      {GEAR_KEYS.map((k) => {
        const G = GEAR[k];
        const cu = Math.max(0, G.o.findIndex((x) => x[0] === rig[k]));
        return (
          <div key={k} className="wh">
            <div className="wh__t">{G.t}</div>
            <button className="wh__ar" aria-label="上一个" onClick={() => shift(k, -1, rig, onChange)}>‹</button>
            <div className="wh3">
              <div className="wh3__c" style={{ transform: `translateZ(-86px) rotateX(${cu * STEP}deg)` }}>
                {G.o.map((o, i) => (
                  <div key={o[0]} className="wh3__i" data-on={i === cu ? 1 : 0}
                    style={{ transform: `rotateX(${-i * STEP}deg) translateZ(86px)` }}
                    onClick={() => onChange({ [k]: o[0] } as Partial<Rig>)}>
                    {o[0]}
                  </div>
                ))}
              </div>
              <div className="wh3__bar" />
            </div>
            <button className="wh__ar wh__ar--dn" aria-label="下一个" onClick={() => shift(k, 1, rig, onChange)}>‹</button>
            <div className="wh__w">{G.o[cu]![2]}</div>
          </div>
        );
      })}
    </div>
  );
}

function shift(k: GearKey, dir: number, rig: Rig, onChange: (p: Partial<Rig>) => void) {
  const G = GEAR[k];
  const i = Math.max(0, G.o.findIndex((x) => x[0] === rig[k]));
  onChange({ [k]: G.o[(i + dir + G.o.length) % G.o.length]![0] } as Partial<Rig>);
}
