import { Icon } from '@/ui/Icon';
import { SECTIONS, type SectionId } from '@/domain/nav';

/** 一级导航：左侧窄图标栏。只管「在哪个大区」，不管大区内部 */
export function Rail({ active, onPick }: {
  active: SectionId;
  onPick: (id: SectionId) => void;
}) {
  return (
    <nav className="rail" aria-label="主导航">
      {SECTIONS.map((s) => (
        <button key={s.id} className="rail__b" aria-current={s.id === active}
          title={s.todo ? `${s.n}（还没实现）` : s.n} onClick={() => onPick(s.id)}>
          <Icon name={s.icon} />
          <span className="rail__n">{s.n}</span>
        </button>
      ))}
    </nav>
  );
}
