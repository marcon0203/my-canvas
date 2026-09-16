import { useEffect } from 'react';
import { StageBar } from '@/components/StageBar';
import { Button, Chip, Icon } from '@/ui';
import { ProviderDetail, ProviderList } from './ProviderSettings';
import { AgentDetail, AgentList } from './AgentSettings';
import { SkillDetail, SkillFileDetail, SkillList } from './SkillSettings';
import { SETTINGS_SUB } from '@/domain/nav';
import { personaById, type AgentId } from '@/domain/agent/roster';
import { providerOf } from '@/domain/providers/catalog';
import type { ProviderId } from '@/domain/providers/model';
import { isSkillId, skillOf } from '@/domain/agent/skills';
import { builtinSkill } from '@/domain/skills/builtin';
import { useReadyProviders, useSettings } from '@/store/settings';
import { isDesktop } from '@/api/desktop';

export type SettingsSection = 'models' | 'skills' | 'agents';

const TITLE: Record<SettingsSection, string> = {
  models: '模型设置',
  skills: 'Skill 管理',
  agents: '智能体管理',
};

/**
 * 设置：二级菜单选分区，这里只渲染当前分区。
 * `detail` 有值时是分区内的详情页（供应商 / 智能体），标题栏换成「返回 + 这是谁」。
 */
export function SettingsPage({ section, detail, onOpen, onBack }: {
  section: SettingsSection;
  /** 分区内的详情对象：智能体分区是 AgentId，模型分区是 ProviderId */
  detail?: string;
  /** 列表里点一张卡 → 进详情。导航靠 URL，刷新和后退都对 */
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const ready = useReadyProviders();
  const syncKeys = useSettings((st) => st.syncKeys);
  // 密钥的真相在系统钥匙串里，不在 store —— 打开设置时对一遍
  useEffect(() => { syncKeys(); }, [syncKeys]);

  const hint = SETTINGS_SUB.find((s) => s.k === section)?.hint;
  const p = section === 'agents' && detail ? personaById(detail as AgentId) : undefined;
  const prov = section === 'models' && detail ? providerOf(detail as ProviderId) : undefined;
  const sk = section === 'skills' && isSkillId(detail) ? skillOf(detail) : undefined;
  // 详情段可能是内置能力的 id（带点，如 outline.draft），也可能是真 skill 的名字
  const file = section === 'skills' && !sk && detail ? builtinSkill(detail) : undefined;

  return (
    <div className="stage">
      {p ? (
        <StageBar
          title={
            <span className="crumb">
              <span className={`aface aface--${p.id}`} aria-hidden><Icon name={p.icon} /></span>
              {p.name}
              <span className="crumb__en">{p.en}</span>
            </span>
          }
          pills={<span className="t-cap dim">{p.tagline}</span>}
          actions={<Button onClick={onBack}><Icon name="left" />返回智能体</Button>}
        />
      ) : file ? (
        <StageBar
          title={<span className="crumb"><Icon name="wand" />{file.meta.name}</span>}
          pills={<span className="t-cap dim">{file.meta.source} Skill</span>}
          actions={<Button onClick={onBack}><Icon name="left" />返回 Skill</Button>}
        />
      ) : sk ? (
        <StageBar
          title={<span className="crumb"><Icon name={sk.icon} />{sk.name}</span>}
          pills={<span className="mono dim t-cap">{sk.id}</span>}
          actions={<Button onClick={onBack}><Icon name="left" />返回 Skill</Button>}
        />
      ) : prov ? (
        <StageBar
          title={<span className="crumb">{prov.name}<span className="crumb__en">{prov.en}</span></span>}
          pills={<span className="t-cap dim">端点、密钥与模型清单</span>}
          actions={<Button onClick={onBack}><Icon name="left" />返回供应商</Button>}
        />
      ) : (
        <StageBar
          title={TITLE[section]}
          pills={section === 'models'
            ? (ready.length ? <Chip tone="ok">{ready.length} 家已接入</Chip> : <Chip tone="warn">还没接入任何厂商</Chip>)
            : <span className="t-cap dim">{hint}</span>}
        />
      )}
      <div className="stage__body"><div className="pad" style={{ maxWidth: 1080 }}>
        {section === 'models' && (prov
          ? <ProviderDetail id={prov.id} />
          : <ProviderList onOpen={onOpen} />)}
        {section === 'skills' && (sk
          ? <SkillDetail id={sk.id} />
          : file
            ? <SkillFileDetail name={file.meta.name} />
            : <SkillList onOpen={onOpen} />)}
        {section === 'agents' && (p
          ? <AgentDetail id={p.id} />
          : <AgentList onOpen={onOpen} />)}
        {!p && !prov && !sk && !file && (
          <p className="t-cap dim setnote">
            <Icon name="bolt" />
            这是**应用级**设置，跨项目共用 —— 模型与 Agent 的配置不属于某一个项目。
            {section === 'models' && (isDesktop()
              ? ' 密钥写入系统钥匙串，由 Rust 侧读写 —— 前端拿不到明文，请求也不经过前端。'
              : ' 当前是浏览器环境，没有系统钥匙串：密钥只记「配没配」，不会真正保存。装成桌面端后才会写入钥匙串。')}
          </p>
        )}
      </div></div>
    </div>
  );
}
