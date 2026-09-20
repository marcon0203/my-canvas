import type { IconName } from '@/ui/Icon';
import { Icon } from './Icon';

/**
 * 空态占位。
 *
 * **走正常文档流，不做绝对定位。** 原型里的 `.card__none` 是「铺满一个图片格子」
 * 的覆盖层，只在 position 非 static 的父容器里才对；组件被放到别处时它会以视口为
 * 定位基准铺满整屏，变成一层看不见的挡板 —— 页面看着正常，但什么都点不动。
 * 图片格子里的那种覆盖层继续用 `.card__none` 裸写在格子旁边，那儿父容器是确定的。
 */
export function EmptyState({ icon = 'image', text }: {
  icon?: IconName;
  text?: string;
}) {
  return (
    <div className="empty">
      <Icon name={icon} />
      {text}
    </div>
  );
}
