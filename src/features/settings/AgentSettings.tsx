import { useState } from 'react';
import { Button, Icon, Switch, Tabs } from '@/ui';
import { NewAgentModal } from './AgentWizard';
import { OrphanNotice, TaskList } from './TaskAssign';
import { TASKS } from '@/domain/agent/tasks';
import { faceClass, personaById, roster } from '@/domain/agent/roster';
import type { AgentId } from '@/domain/agent/roster';
import { AUTONOMY_LABEL, checkConfig, defaultConfig } from '@/domain/agent/config';
import { findModel } from '@/domain/providers/catalog';
import { useEffectiveGlobals, useExtraModels, useReadyProviders, useSettings } from '@/store/settings';

/** 智能体管理分两页：按人看能力，按任务看分工 */
type Tab = 'agents' | 'tasks';

/**
 * 智能体管理 · 列表页。
 *
 * 两个页签是同一件事的两个方向：
 * - **智能体**：这位能做什么、现在状态如何（按人看）
 * - **任务分工**：这件任务由谁做、结果写到哪、做法能不能改（按任务看）
 *
 * 两个都要有。按人看时，「成本报告谁都没接」这种漏洞得五位挨个点开才发现；
 * 按任务看，它就在那一行摆着。
 *
 * 「任务分工」原来挂在 Skill 管理下面叫「功能清单」—— 那张表四列里有三列讲的
 * 是智能体的分工，只有「实现方式」和 Skill 文件有关，放错地方了。
 */
export function AgentList({ onOpen }: { onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('agents');
  const [adding, setAdding] = useState(false);
  const customs = useSettings((s) => s.customAgents);

  return (
    <>
      {/* 没有负责人的提示放在页签外：两个页签都看得见 */}
      <OrphanNotice />

      <div className="settabs">
        <Tabs value={tab} onChange={setTab}
          items={[
            { key: 'agents', label: `智能体 · ${roster().length}` },
            { key: 'tasks', label: `任务分工 · ${TASKS.length}` },
          ]} />
        <div className="spacer" />
        {tab === 'agents' && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />新建智能体
          </Button>
        )}
      </div>

      {tab === 'agents'
        ? (
          <>
            <p className="t-cap dim" style={{ margin: 0 }}>
              内置 5 个各负责一个创作环节
              {customs.length ? `，另有 ${customs.length} 个为你自建` : ''}
            </p>
            <div className="agrid">
              {roster().map((p) => <AgentTile key={p.id} id={p.id} onOpen={onOpen} />)}
            </div>
          </>
        )
        : <TaskList onOpen={onOpen} />}

      <NewAgentModal open={adding} onClose={() => setAdding(false)} onCreated={onOpen} />
    </>
  );
}

/** 一张卡片。整张可点进详情；启用开关单独拦住点击，免得手一抖进了详情页 */
function AgentTile({ id, onOpen }: { id: AgentId; onOpen: (id: AgentId) => void }) {
  const p = personaById(id);
  const cfg = useSettings((s) => s.agents[id]) ?? defaultConfig(p);
  const patch = useSettings((s) => s.patchAgent);
  const globals = useEffectiveGlobals();
  const extra = useExtraModels();

  const ready = new Set<string>(useReadyProviders());

  const issues = checkConfig(cfg, globals, extra);
  const errs = issues.filter((i) => i.level === 'error').length;
  const textRef = cfg.models.text ?? globals.text;
  const textName = textRef ? findModel(textRef, extra)?.name : undefined;
  // checkConfig 只管配置自不自洽，管不着有没有密钥 —— 卡片答的是「现在能不能跑」，
  // 所以厂商没接入也得算一种「跑不起来」，不能显示成「配置自洽」
  const offline = !!textRef && !ready.has(textRef.provider);

  return (
    <article className={`atile${cfg.enabled ? '' : ' atile--off'}`}>
      <button className="atile__hit" onClick={() => onOpen(id)}
        aria-label={`配置${p.name}`}>
        <header className="atile__h">
          <span className={`aface ${faceClass(p.id)}`} aria-hidden><Icon name={p.icon} /></span>
          <span className="atile__n">{p.name}</span>
          <span className="atile__en">{p.en}</span>
        </header>
        <p className="atile__tag">{p.tagline}</p>
        <dl className="atile__stats">
          <div><dt>功能</dt><dd>{cfg.skills.length}</dd></div>
          <div><dt>工具</dt><dd>{cfg.tools.length}</dd></div>
          <div><dt>自主度</dt><dd>{AUTONOMY_LABEL[cfg.autonomy]}</dd></div>
        </dl>
        <p className="atile__model">
          <Icon name="cube" />
          {textName
            ? `${textName}${cfg.models.text ? '' : ' · 跟随全局'}`
            : '没有可用的文本模型'}
        </p>
        <p className={`atile__st${errs ? ' atile__st--bad' : ''}`}>
          {!cfg.enabled
            ? '已停用，它负责的功能当前没有负责人'
            : errs
              ? `${errs} 项配置待处理`
              : issues.length
                ? issues[0]!.text
                : offline
                  ? '配置完整，但该供应商尚未接入，暂时无法调用'
                  : '配置完整，可以调用'}
        </p>
      </button>
      {/* 开关放在可点区之外：它不是「进详情」，而是就地生效 */}
      <div className="atile__sw">
        <Switch on={cfg.enabled} onChange={(v) => patch(id, { enabled: v })} label={`启用${p.name}`} />
      </div>
    </article>
  );
}

/**
 * 智能体管理 · 详情页 = 配置向导。
 *
 * 原来是一屏四张卡从上到下摊开（基本 / 提示词 / 能干什么 / 问题）。
 * 问题是这些东西有依赖顺序：配哪些模态的模型取决于给了哪些工具，
 * 放不放手取决于它手上有什么 —— 摊开之后人得来回跳，改完还不知道
 * 哪一处还没跟上。分步之后每一步只依赖上一步，见 AgentWizard。
 */
export { AgentWizard as AgentDetail, NewAgentModal } from './AgentWizard';
