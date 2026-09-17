import { Icon } from '@/ui/Icon';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

/**
 * 账号角落：积分 + 头像。
 *
 * **积分是按项目记的**（project.json 里的 credits / budget），不是账号余额。
 * 所以没打开项目时它不显示 —— 原来会显示一个 0，看着像余额用完了。
 *
 * 也没有充值按钮：背后没有计费，摆一个点不动的按钮比不摆更糟。
 * 点数字跳到数据页，那儿有消耗明细。【待确认】要不要接真实计费。
 */
export function Account({ compact = false }: { compact?: boolean }) {
  const credits = useProject((s) => s.credits);
  const budget = useProject((s) => s.budget);
  const inProject = !!useProject((s) => s.hydratedFor);
  const setStep = useUi((s) => s.setStep);

  return (
    <div className={compact ? 'acct acct--compact' : 'acct'}>
      {inProject && (
        <button className="credit" onClick={() => setStep('metrics')}
          title={`本项目剩余 ${credits}，预算 ${budget}。点开看消耗明细`}>
          <Icon name="bolt" /><span>{credits}</span>
        </button>
      )}
      <div className="ava" title="账号">M</div>
    </div>
  );
}
