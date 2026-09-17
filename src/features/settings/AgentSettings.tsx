import { useState } from 'react';
import { Button, Icon, Segmented, Select, Switch, Textarea, ToggleChip } from '@/ui';
import { PERSONAS, personaById, INTENT_META, intentName } from '@/domain/agent/roster';
import type { AgentId } from '@/domain/agent/roster';
import {
  GROUP_LABEL, TOOLS, TOOLS_FOR_INTENT, missingTools, toolOf,
  type ToolGroup, type ToolId,
} from '@/domain/agent/tools';
import {
  AUTONOMY_LABEL, AUTONOMY_HINT, checkConfig, defaultConfig, neededModalities, preambleOf,
  type Autonomy,
} from '@/domain/agent/config';
import { findModel, modelsOfModality } from '@/domain/providers/catalog';
import { MODALITY_LABEL, modelKey, parseModelKey, type Modality, type ModelRef } from '@/domain/providers/model';
import type { IntentKind } from '@/domain/agent/types';
import {
  AUTO_MAX_CHOICES, DEFAULT_AUTO_MAX, RISK_LABEL, RISK_WHY,
  riskOfIntent, riskOfTool, type Risk,
} from '@/domain/agent/policy';

const GROUPS: ToolGroup[] = ['read', 'write', 'prompt', 'generate', 'camera', 'deliver', 'research'];
import { useEffectiveGlobals, useExtraModels, useReadyProviders, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Field, Fields } from './Field';

const ALL_INTENTS = Object.keys(INTENT_META) as Exclude<IntentKind, 'chat'>[];

/**
 * 智能体管理 · 列表页。
 *
 * 卡片只回答「这位是谁、现在什么状态、有没有毛病」—— 五位并排能一眼扫完。
 * 具体怎么配（提示词、模型、活儿、工具）进详情页，那儿是一位一屏，不用挤。
 */
export function AgentList({ onOpen }: { onOpen: (id: AgentId) => void }) {
  return (
    <div className="agrid">
      {PERSONAS.map((p) => <AgentTile key={p.id} id={p.id} onOpen={onOpen} />)}
    </div>
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
          <span className={`aface aface--${p.id}`} aria-hidden><Icon name={p.icon} /></span>
          <span className="atile__n">{p.name}</span>
          <span className="atile__en">{p.en}</span>
        </header>
        <p className="atile__tag">{p.tagline}</p>
        <dl className="atile__stats">
          <div><dt>活儿</dt><dd>{cfg.skills.length}</dd></div>
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
            ? '已停用，它的活儿不会有人接'
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

/** 智能体管理 · 详情页。一位一屏 */
export function AgentDetail({ id }: { id: AgentId }) {
  const p = personaById(id);
  const cfg = useSettings((s) => s.agents[id]) ?? defaultConfig(p);
  const patch = useSettings((s) => s.patchAgent);
  const reset = useSettings((s) => s.resetAgent);
  const globals = useEffectiveGlobals();
  const extra = useExtraModels();
  const toast = useUi((s) => s.toast);

  const issues = checkConfig(cfg, globals, extra);
  const needs = neededModalities(cfg);

  const toggleSkill = (k: IntentKind) => {
    const on = cfg.skills.includes(k);
    const next = on ? cfg.skills.filter((x) => x !== k) : [...cfg.skills, k];
    // 加技能时把它要的工具一并补上 —— 否则勾了就是红叉，没意义
    const tools = on ? cfg.tools : [...new Set([...cfg.tools, ...TOOLS_FOR_INTENT[k as Exclude<IntentKind, 'chat'>]])];
    patch(id, { skills: next, tools });
  };

  const toggleTool = (t: ToolId) => {
    const on = cfg.tools.includes(t);
    patch(id, { tools: on ? cfg.tools.filter((x) => x !== t) : [...cfg.tools, t] });
  };

  return (
    <>
      <section className={`pcard${cfg.enabled ? '' : ' pcard--off'}`}>
        <header className="pcard__h">
          <span className="pcard__n">基本</span>
          <div className="spacer" />
          <Switch on={cfg.enabled} onChange={(v) => patch(id, { enabled: v })} label="启用" />
        </header>
        <Fields>
          <Field label="自主度" hint={AUTONOMY_HINT[cfg.autonomy]}>
            <Segmented ariaLabel="自主度"
              items={(['propose', 'auto'] as Autonomy[]).map((a) => ({ key: a, label: AUTONOMY_LABEL[a], title: AUTONOMY_HINT[a] }))}
              value={cfg.autonomy}
              onChange={(v) => patch(id, { autonomy: v as Autonomy })} />
          </Field>
          {cfg.autonomy === 'auto' && (
            <Field label="自主上限"
              hint={<>
                超过这一档的动作照样停下来等你点头。
                <b>导出文件这类会把东西送出本机的，调到最高也不会自动做。</b>
              </>}>
              <Segmented ariaLabel="自主上限"
                items={AUTO_MAX_CHOICES.map((r) => ({
                  key: r, label: RISK_LABEL[r], title: RISK_WHY[r],
                }))}
                value={cfg.autoMax ?? DEFAULT_AUTO_MAX}
                onChange={(v) => patch(id, { autoMax: v as Risk })} />
            </Field>
          )}
          {needs.map((m) => (
            <Field key={m} label={MODALITY_LABEL[m]}>
              <ModelSelect modality={m} value={cfg.models[m]}
                inherited={globals[m]}
                onChange={(ref) => {
                  const next = { ...cfg.models };
                  if (ref) next[m] = ref; else delete next[m];
                  patch(id, { models: next });
                }} />
            </Field>
          ))}
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">侧重方向 · 系统提示词</span>
          <span className="t-cap dim">自主规划下，这段比多勾几个技能更能决定它的行为</span>
        </header>
        <Preamble id={id} />
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">能干什么</span>
          <span className="t-cap dim">勾上活儿时所需工具会自动补齐</span>
        </header>
        <Fields>
          <Field wide label={`接的活儿 · ${cfg.skills.length}`}>
            <div className="chipwall">
              {ALL_INTENTS.map((k) => {
                const on = cfg.skills.includes(k);
                const miss = on ? missingTools(cfg.tools, k) : [];
                return (
                  <ToggleChip key={k} on={on} onClick={() => toggleSkill(k)}
                    title={miss.length
                      ? `缺工具：${miss.map((t) => toolOf(t)?.name).join('、')}`
                      : `${intentName(k)} · ${RISK_WHY[riskOfIntent(k)]}`}>
                    {INTENT_META[k].name}
                    {miss.length ? ' ⚠' : riskOfIntent(k) === 'spend' ? ' ¥'
                      : riskOfIntent(k) === 'egress' ? ' ↗' : ''}
                  </ToggleChip>
                );
              })}
            </div>
          </Field>
          <Field wide label={`工具 · ${cfg.tools.length} / ${TOOLS.length}`}
            hint={<>
              ¥ 要花积分，↗ 会把东西送出本机。这两类在自主模式下会停下来等你点头。
              <b>虚线的还没实现</b>，<b>点线的实现了但还没拿真 key 验过</b>；
              鼠标停上去看具体缺什么。
            </>}>
            {GROUPS.map((g) => {
              const list = TOOLS.filter((t) => t.group === g);
              if (!list.length) return null;
              return (
                <div key={g} className="toolgrp">
                  <span className="toolgrp__n">{GROUP_LABEL[g]}</span>
                  <div className="chipwall">
                    {list.map((t) => {
                      const r = riskOfTool(t.id);
                      const off = t.status === 'declared';
                      const soon = t.status === 'unverified';
                      return (
                        <ToggleChip key={t.id} on={cfg.tools.includes(t.id)}
                          onClick={() => toggleTool(t.id)}
                          className={off ? 'tchip--todo' : soon ? 'tchip--soon' : undefined}
                          title={[
                            t.desc,
                            t.needs ? `需要${MODALITY_LABEL[t.needs]}模型` : '',
                            RISK_WHY[r],
                            off ? `还没实现：${t.blockedBy}`
                              : soon ? `待验证：${t.blockedBy}` : '已实现',
                          ].filter(Boolean).join(' · ')}>
                          {t.name}
                          {r === 'spend' ? ' ¥' : r === 'egress' ? ' ↗' : ''}
                        </ToggleChip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Field>
        </Fields>
      </section>

      {issues.length > 0 && (
        <section className="pcard pcard--warn">
          <header className="pcard__h">
            <Icon name="bolt" />
            <span className="pcard__n">{issues.length} 条要注意</span>
          </header>
          <ul className="issues">
            {issues.map((it, i) => (
              <li key={i} className={`issue issue--${it.level}`}>
                <Icon name={it.level === 'error' ? 'x' : 'bolt'} />{it.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="row">
        <div className="spacer" />
        <Button onClick={() => { reset(id); toast(`${p.name} 的配置已恢复默认`); }}>
          <Icon name="undo" />恢复默认
        </Button>
      </div>
    </>
  );
}

/**
 * 系统提示词：默认折叠 —— 大多数人不改；改过的展开显示并标出来。
 */
function Preamble({ id }: { id: AgentId }) {
  const p = personaById(id);
  const cfg = useSettings((s) => s.agents[id]) ?? defaultConfig(p);
  const patch = useSettings((s) => s.patchAgent);
  const custom = !!cfg.preamble?.trim();
  const [open, setOpen] = useState(custom);
  const [draft, setDraft] = useState(preambleOf(cfg, p));

  if (!open) {
    return (
      <div className="prem">
        <p className="prem__peek">{preambleOf(cfg, p).split('\n')[0]}</p>
        <button className="tbtn" onClick={() => { setDraft(preambleOf(cfg, p)); setOpen(true); }}>
          <Icon name="wand" />{custom ? '已改写 · 查看' : '改写'}
        </button>
      </div>
    );
  }
  return (
    <div className="prem prem--open">
      <Textarea rows={10} value={draft} onChange={(e) => setDraft(e.target.value)}
        aria-label={`${p.name}的系统提示词`} />
      <div className="row" style={{ marginTop: 6 }}>
        {custom && <span className="t-cap dim">已改写，不再跟随出厂默认</span>}
        <div className="spacer" />
        {custom && (
          <Button onClick={() => { patch(id, { preamble: undefined }); setDraft(p.preamble); setOpen(false); }}>
            <Icon name="undo" />恢复出厂
          </Button>
        )}
        <Button onClick={() => setOpen(false)}>收起</Button>
        <Button variant="primary" onClick={() => {
          patch(id, { preamble: draft.trim() === p.preamble.trim() ? undefined : draft });
          setOpen(false);
        }}><Icon name="check" />保存</Button>
      </div>
    </div>
  );
}

/**
 * 模型下拉：按模态过滤，只列已接入厂商的（未接入的灰显带标记）。
 *
 * 缺省项是「自动」而不是「跟随全局」—— 全局默认模型那一栏已经去掉，
 * 不选时就按已接入的厂商挑一个，没有一个需要人去维护的全局值。
 */
function ModelSelect({ modality, value, inherited, onChange }: {
  modality: Modality;
  value: ModelRef | undefined;
  /** 不选时实际会用哪个，摆出来省得人猜 */
  inherited?: ModelRef;
  onChange: (ref: ModelRef | undefined) => void;
}) {
  const extra = useExtraModels();
  const ready = new Set<string>(useReadyProviders());

  const list = modelsOfModality(modality, extra);
  const inheritedSpec = inherited ? findModel(inherited, extra) : undefined;

  const options = [
    { value: '', label: inheritedSpec ? `自动 · ${inheritedSpec.name}` : '自动（还没有可用模型）' },
    ...list.map((m) => ({
      value: modelKey({ provider: m.provider, model: m.id }),
      label: `${m.name}${ready.has(m.provider) ? '' : '（未接入）'}`,
    })),
  ];

  return (
    <>
      <Select ariaLabel={`${MODALITY_LABEL[modality]}模型`}
        value={value ? modelKey(value) : ''}
        options={options}
        onChange={(v) => onChange(v ? parseModelKey(v) : undefined)} />
      {/* 一个模型都没有时，光一个空下拉框说不清该去哪儿加 */}
      {list.length === 0 && (
        <span className="t-cap dim">去「模型设置」接入厂商，再把要用的模型加上</span>
      )}
    </>
  );
}
