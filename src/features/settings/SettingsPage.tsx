import { useEffect } from 'react';
import { StageBar } from '@/components/StageBar';
import { Button, Chip, Icon } from '@/ui';
import { ProviderDetail, ProviderList } from './ProviderSettings';
import { AgentDetail, AgentList } from './AgentSettings';
import { SkillFileDetail, SkillList } from './SkillSettings';
import { TaskDetail } from './TaskAssign';
import { WorkspaceSettings } from './WorkspaceSettings';
import { SETTINGS_SUB } from '@/domain/nav';
import { faceClass, personaById, type AgentId } from '@/domain/agent/roster';
import { providerOf } from '@/domain/providers/catalog';
import type { ProviderId } from '@/domain/providers/model';
import { isTaskId, taskOf } from '@/domain/agent/tasks';
import { useReadyProviders, useSettings } from '@/store/settings';
import { isDesktop } from '@/api/desktop';

export type SettingsSection = 'workspace' | 'models' | 'skills' | 'agents';

const TITLE: Record<SettingsSection, string> = {
  workspace: '工作空间',
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
  const syncProviders = useSettings((st) => st.syncProviders);
  // 真相在 <workspace>/providers/*.yaml 里，不在 store —— 打开设置时对一遍。
  // **这是一次目录扫描，不弹任何东西**：上一版密钥在系统钥匙串里，而界面要
  // 显示尾号，于是这一步是「一家一次读明文」，macOS 上配了几家就弹几次登录密码
  useEffect(() => { void syncProviders(); }, [syncProviders]);

  const hint = SETTINGS_SUB.find((s) => s.k === section)?.hint;
  // 智能体分区的详情段有两种：**任务 id 带点**（outline.draft），智能体 id 不带点。
  // 靠这个分辨，不用再多一段路由
  const task = section === 'agents' && isTaskId(detail) ? taskOf(detail) : undefined;
  const p = section === 'agents' && detail && !task ? personaById(detail as AgentId) : undefined;
  const prov = section === 'models' && detail ? providerOf(detail as ProviderId) : undefined;
  // Skill 分区的详情段就是文件名。**不经过 builtinSkill 查一遍** ——
  // 那份清单只有构建期嵌进来的内置几个，桌面端点自己导入的 skill 会查不到，
  // 于是又渲染回列表页（这是个真出现过的 bug）。名字直接传下去，详情页自己去读
  const file = section === 'skills' && detail ? detail : undefined;

  return (
    <div className="stage">
      {p ? (
        <StageBar
          title={
            <span className="crumb">
              <span className={`aface ${faceClass(p.id)}`} aria-hidden><Icon name={p.icon} /></span>
              {p.name}
              <span className="crumb__en">{p.en}</span>
            </span>
          }
          pills={<span className="t-cap dim">{p.tagline}</span>}
          actions={<Button onClick={onBack}><Icon name="left" />返回智能体</Button>}
        />
      ) : file ? (
        <StageBar
          title={<span className="crumb"><Icon name="wand" /><span className="mono">{file}</span></span>}
          pills={<span className="t-cap dim">Skill 文件</span>}
          actions={<Button onClick={onBack}><Icon name="left" />返回 Skill</Button>}
        />
      ) : task ? (
        <StageBar
          title={<span className="crumb"><Icon name={task.icon} />{task.name}</span>}
          pills={<span className="t-cap dim">{task.summary}</span>}
          actions={<Button onClick={onBack}><Icon name="left" />返回智能体</Button>}
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
        {/* 卡片之间的间距靠这个容器的 gap。`.pcard` 自己不带外边距 ——
            之前这层容器漏了，四个分区的卡片全是贴在一起的 */}
        <div className="setgrid">
          {section === 'workspace' && <WorkspaceSettings />}
          {section === 'models' && (prov
            ? <ProviderDetail id={prov.id} onBack={onBack} />
            : <ProviderList onOpen={onOpen} />)}
          {section === 'skills' && (file
            ? <SkillFileDetail name={file} />
            : <SkillList onOpen={onOpen} />)}
          {section === 'agents' && (task
            ? <TaskDetail id={task.id} />
            : p
              ? <AgentDetail id={p.id} />
              : <AgentList onOpen={onOpen} />)}
        </div>
        {!p && !prov && !task && !file && (
          <p className="t-cap dim setnote">
            <Icon name="bolt" />
            这里的配置跨项目共用。
            {/* 浏览器里密钥存不住，这一条用户必须知道；桌面端存在哪儿他不需要知道 */}
            {section === 'models' && !isDesktop()
              && ' 当前是浏览器环境，密钥只记「配没配」，不会真正保存。要装成桌面端。'}
          </p>
        )}
      </div></div>
    </div>
  );
}
