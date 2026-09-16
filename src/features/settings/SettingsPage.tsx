import { useEffect } from 'react';
import { StageBar } from '@/components/StageBar';
import { Chip, Icon } from '@/ui';
import { ProviderSettings } from './ProviderSettings';
import { AgentSettings } from './AgentSettings';
import { SkillSettings } from './SkillSettings';
import { SETTINGS_SUB } from '@/domain/nav';
import { useReadyProviders, useSettings } from '@/store/settings';
import { isDesktop } from '@/api/desktop';

export type SettingsSection = 'models' | 'skills' | 'agents';

const TITLE: Record<SettingsSection, string> = {
  models: '模型设置',
  skills: 'Skill 管理',
  agents: '智能体管理',
};

/** 设置：二级菜单选分区，这里只渲染当前分区 */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const ready = useReadyProviders();
  const syncKeys = useSettings((st) => st.syncKeys);
  // 密钥的真相在系统钥匙串里，不在 store —— 打开设置时对一遍
  useEffect(() => { syncKeys(); }, [syncKeys]);

  const hint = SETTINGS_SUB.find((s) => s.k === section)?.hint;

  return (
    <div className="stage">
      <StageBar
        title={TITLE[section]}
        pills={section === 'models'
          ? (ready.length ? <Chip tone="ok">{ready.length} 家已接入</Chip> : <Chip tone="warn">还没接入任何厂商</Chip>)
          : <span className="t-cap dim">{hint}</span>}
      />
      <div className="stage__body"><div className="pad" style={{ maxWidth: 1080 }}>
        {section === 'models' && <ProviderSettings />}
        {section === 'skills' && <SkillSettings />}
        {section === 'agents' && <AgentSettings />}
        <p className="t-cap dim setnote">
          <Icon name="bolt" />
          这是**应用级**设置，跨项目共用 —— 模型与 Agent 的配置不属于某一个项目。
          {section === 'models' && (isDesktop()
            ? ' 密钥写入系统钥匙串，由 Rust 侧读写 —— 前端拿不到明文，请求也不经过前端。'
            : ' 当前是浏览器环境，没有系统钥匙串：密钥只记「配没配」，不会真正保存。装成桌面端后才会写入钥匙串。')}
        </p>
      </div></div>
    </div>
  );
}
