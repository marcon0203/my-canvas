import { Icon } from '@/ui/Icon';
import { SECTIONS, type SectionId } from '@/domain/nav';
import { Account } from './Account';

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
      {/* 账号常驻栏底 —— 没有顶栏的页面也得看得见积分。
          .spacer 是 margin-left:auto，在竖排的栏里顶不动东西，靠 .rail__f 自己 margin-top:auto */}
      <div className="rail__f"><Account compact /></div>
    </nav>
  );
}
