import { useState } from 'react';
import { useNavigate } from 'react-router';
import { StageBar } from '@/components/StageBar';
import { Chip, Icon } from '@/ui';
import { ProviderSettings } from './ProviderSettings';
import { AgentSettings } from './AgentSettings';
import { useReadyProviders } from '@/store/settings';

type Tab = 'providers' | 'agents';

/** 设置：模型服务商接入 + 每个 Agent 单独配置 */
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('providers');
  const ready = useReadyProviders();
  const navigate = useNavigate();

  return (
    <div className="stage">
      <StageBar
        title="Settings"
        pills={ready.length
          ? <Chip tone="ok">{ready.length} 家已接入</Chip>
          : <Chip tone="warn">还没接入任何厂商</Chip>}
        actions={<>
          <button className="tbtn" onClick={() => navigate(-1)} title="返回">
            <Icon name="left" />返回
          </button>
          <div className="seg" role="tablist" aria-label="设置分区">
            <button role="tab" aria-selected={tab === 'providers'} onClick={() => setTab('providers')}>
              模型服务商
            </button>
            <button role="tab" aria-selected={tab === 'agents'} onClick={() => setTab('agents')}>
              Agent 配置
            </button>
          </div>
        </>}
      />
      <div className="stage__body"><div className="pad" style={{ maxWidth: 1080 }}>
        {tab === 'providers' ? <ProviderSettings /> : <AgentSettings />}
        <p className="t-cap dim setnote">
          <Icon name="bolt" />
          这是**应用级**设置，跨项目共用 —— 模型与 Agent 的配置不属于某一个项目。
          密钥只写入系统钥匙串，前端不保存明文（当前是浏览器环境，接 Tauri 后由 Rust 侧读写）。
          内置模型目录只是种子：厂商改了 id 或出了新模型，在上面直接改端点、加模型即可。
        </p>
      </div></div>
    </div>
  );
}
