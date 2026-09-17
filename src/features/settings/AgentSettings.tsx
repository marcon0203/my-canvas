import { useState } from 'react';
import { Button, Icon, Switch } from '@/ui';
import { NewAgentModal } from './AgentWizard';
import { faceClass, personaById, roster } from '@/domain/agent/roster';
import type { AgentId } from '@/domain/agent/roster';
import { AUTONOMY_LABEL, checkConfig, defaultConfig } from '@/domain/agent/config';
import { findModel } from '@/domain/providers/catalog';
import { useEffectiveGlobals, useExtraModels, useReadyProviders, useSettings } from '@/store/settings';

/**
 * 智能体管理 · 列表页。
 *
 * 卡片只回答「这位是谁、现在什么状态、有没有毛病」—— 五位并排能一眼扫完。
 * 具体怎么配（提示词、模型、活儿、工具）进详情页，那儿是一位一屏，不用挤。
 */
export function AgentList({ onOpen }: { onOpen: (id: AgentId) => void }) {
  const [adding, setAdding] = useState(false);
  const customs = useSettings((s) => s.customAgents);
  return (
    <>
      <div className="settabs">
        <span className="pcard__n">班底 · {roster().length}</span>
        <span className="t-cap dim">
          出厂五位各管一个环节{customs.length ? `，另外 ${customs.length} 位是你自己建的` : ''}
        </span>
        <div className="spacer" />
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />新建智能体
        </Button>
      </div>
      <div className="agrid">
        {roster().map((p) => <AgentTile key={p.id} id={p.id} onOpen={onOpen} />)}
      </div>
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
            ? '已停用，它负责的功能没人做'
            : errs
              ? `${errs} 个问题要处理`
              : issues.length
                ? issues[0]!.text
                : offline
                  ? '配置没问题，但这家厂商还没接入，跑不起来'
                  : '配置自洽，可以跑'}
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
