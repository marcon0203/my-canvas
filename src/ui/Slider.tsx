/** 滑块行：原型 .mr 同构（标签 + 轨道 + 值读数；gradient 变体为色温） */
export function Slider({ label, min, max, step = 1, value, unit = '', gradient = false,
  onChange }: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
  gradient?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mr">
      <span className="mr__t">{label}</span>
      <input
        className={gradient ? 'mr__r mr__r--k' : 'mr__r'}
        type="range" min={min} max={max} step={step} value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="mr__v">{value}{unit}</span>
    </div>
  );
}
