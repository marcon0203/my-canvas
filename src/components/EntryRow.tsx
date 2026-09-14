import { Icon } from '@/ui/Icon';

/** 入口行：原型 .entry 同构（标题 + 当前值摘要 + 箭头，点开弹窗） */
export function EntryRow({ title, value, onOpen, titleWidth = 56 }: {
  title: string;
  value: string;
  onOpen: () => void;
  titleWidth?: number;
}) {
  return (
    <button className="entry" onClick={onOpen}>
      <span className="entry__t" style={{ width: titleWidth }}>{title}</span>
      <span className="entry__v">{value}</span>
      <span className="entry__go"><Icon name="right" /></span>
    </button>
  );
}
