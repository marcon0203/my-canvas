import { Icon } from './Icon';

/** 空态/未生成占位：原型 .card__none 同构 */
export function EmptyState({ icon = 'image', text }: {
  icon?: string;
  text?: string;
}) {
  return (
    <div className="card__none">
      <Icon name={icon} />
      {text}
    </div>
  );
}
