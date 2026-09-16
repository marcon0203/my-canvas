import { Icon } from '@/ui/Icon';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

/**
 * 账号角落：积分 + 头像。
 *
 * **一份定义，两个挂点**：有一级图标栏的页面挂在栏底，项目内（一级栏收起）挂在顶栏。
 * 两处不会同时出现 —— 积分是花钱的东西，哪个界面都不能让它消失。
 */
export function Account({ compact = false }: { compact?: boolean }) {
  const credits = useProject((s) => s.credits);
  const toast = useUi((s) => s.toast);
  const recharge = () => toast('充值页面：积分用于图像与视频生成');

  return (
    <div className={compact ? 'acct acct--compact' : 'acct'}>
      <button className="credit" onClick={recharge} title={`剩余积分 ${credits}，点击充值`}>
        <Icon name="bolt" /><span>{credits}</span>
      </button>
      {!compact && <button className="tbtn" onClick={recharge}>充值</button>}
      <div className="ava" title="账号">M</div>
    </div>
  );
}
