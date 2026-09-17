import { useState } from 'react';
import { Button, Chip, Icon, Input, Modal, Segmented, Select, Switch, Textarea, ToggleChip } from '@/ui';
import {
  AGENT_ICONS, INTENT_META, faceClass, personaById, roster,
} from '@/domain/agent/roster';
import type { AgentId, Persona } from '@/domain/agent/roster';
import {
  GROUP_LABEL, TOOLS, TOOLS_FOR_INTENT, missingTools, toolOf,
  type ToolGroup, type ToolId,
} from '@/domain/agent/tools';
import {
  AUTONOMY_HINT, AUTONOMY_LABEL, checkConfig, defaultConfig, neededModalities,
  type AgentConfig, type Autonomy,
} from '@/domain/agent/config';
import {
  APPROVAL_LABEL, AUTO_MAX_CHOICES, DEFAULT_AUTO_MAX, RISK_LABEL, RISK_WHY,
  effectiveApproval, riskOfIntent, riskOfTool, type Risk, type ToolApproval,
} from '@/domain/agent/policy';
import { findModel, modelsOfModality } from '@/domain/providers/catalog';
import {
  MODALITY_LABEL, modelKey, parseModelKey, type Modality, type ModelRef,
} from '@/domain/providers/model';
import type { IntentKind } from '@/domain/agent/types';
import { useEffectiveGlobals, useExtraModels, useReadyProviders, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Field, Fields } from './Field';

const ALL_INTENTS = Object.keys(INTENT_META) as Exclude<IntentKind, 'chat'>[];
const GROUPS: ToolGroup[] = ['read', 'write', 'prompt', 'generate', 'camera', 'deliver', 'research'];

/**
 * 配一位 Agent 要填的东西分五步。
 *
 * 为什么分步而不是一屏摊开：这些东西**有依赖顺序**。要配哪些模态的模型，
 * 取决于上一步给了哪些工具；要不要放手自主跑，取决于它手上有什么工具。
 * 一屏摊开的话人得先跳到下面勾工具、再回上面改模型，改完还得记得回来看
 * 自主上限合不合适 —— 一屏十二个控件，哪个受哪个影响看不出来。
 *
 * 顺序就是依赖顺序，所以每一步只需要知道上一步的结果。
 */
export const AGENT_STEPS = [
  { key: 'who', name: '身份', hint: '叫什么、一句话说清它管哪一摊' },
  { key: 'brief', name: '侧重方向', hint: '系统提示词：它先看什么、什么算做完' },
  { key: 'can', name: '能干什么', hint: '接哪些活儿、给哪些工具' },
  { key: 'model', name: '模型', hint: '按上一步需要的模态各配一个' },
  { key: 'trust', name: '放手到哪一档', hint: '哪些动作它自己干，哪些停下来问你' },
] as const;

export type StepKey = (typeof AGENT_STEPS)[number]['key'];

/** 一步里要用到的东西。编辑时直接落到 store，新建时落到草稿 —— 两边同一套步骤 */
interface StepProps {
  p: Persona;
  cfg: AgentConfig;
  patch: (x: Partial<AgentConfig>) => void;
  patchP: (x: Partial<Pick<Persona, 'name' | 'tagline' | 'icon' | 'preamble'>>) => void;
  /** 新建时为 true：允许从某位复制，不显示删除与停用 */
  creating?: boolean;
}

/* ---------------- 步骤条 ---------------- */

export function StepRail({ at, onGo, reachable }: {
  at: StepKey;
  onGo: (k: StepKey) => void;
  /** 新建时只让点已经走过的步骤；编辑时随便跳 */
  reachable: (k: StepKey, i: number) => boolean;
}) {
  const cur = AGENT_STEPS.findIndex((s) => s.key === at);
  return (
    <ol className="wsteps">
      {AGENT_STEPS.map((s, i) => {
        const done = i < cur;
        const on = i === cur;
        const can = reachable(s.key, i);
        return (
          <li key={s.key} className={`wstep${on ? ' wstep--on' : ''}${done ? ' wstep--done' : ''}`}>
            <button className="wstep__hit" disabled={!can} onClick={() => onGo(s.key)}
              aria-current={on} title={s.hint}>
              <span className="wstep__n">{done ? <Icon name="check" /> : i + 1}</span>
              <span className="wstep__t">{s.name}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------- 各步 ---------------- */

export function StepBody({ at, ...rest }: StepProps & { at: StepKey }) {
  switch (at) {
    case 'who': return <Who {...rest} />;
    case 'brief': return <Brief {...rest} />;
    case 'can': return <Can {...rest} />;
    case 'model': return <Models {...rest} />;
    case 'trust': return <Trust {...rest} />;
  }
}

function Who({ p, cfg, patch, patchP, creating }: StepProps) {
  const builtin = !p.custom;
  return (
    <Fields>
      <Field label="名字" hint={builtin ? '出厂那五位的名字对应环节，改不了' : '显示在会话抬头与卡片上'}>
        {builtin
          ? <span className="skplain">{p.name}<span className="dim"> · 内置</span></span>
          : <Input value={p.name} placeholder="比如 广告片编剧"
              onChange={(e) => patchP({ name: e.target.value })} />}
      </Field>
      <Field label="描述" hint="一句话说清它管哪一摊。空着就空着，不用凑字数">
        {builtin
          ? <span className="skplain">{p.tagline}</span>
          : <Input value={p.tagline} placeholder="比如 15 秒，前 3 秒要留住人"
              onChange={(e) => patchP({ tagline: e.target.value })} />}
      </Field>
      {!builtin && (
        <Field wide label="图标" hint="只影响头像，和它会做什么无关">
          <div className="chipwall">
            {AGENT_ICONS.map((ic) => (
              <button key={ic} className={`icpick${p.icon === ic ? ' icpick--on' : ''}`}
                aria-label={ic} aria-pressed={p.icon === ic}
                onClick={() => patchP({ icon: ic })}>
                <Icon name={ic} />
              </button>
            ))}
          </div>
        </Field>
      )}
      {creating && <CopyFrom patch={patch} patchP={patchP} />}
      {!creating && !builtin && (
        <Field label="状态" hint={cfg.enabled ? '停用之后它认领的活儿会变成没人接' : '它认领的活儿现在没人做'}>
          <Switch on={cfg.enabled} onChange={(v) => patch({ enabled: v })} label="启用" />
        </Field>
      )}
    </Fields>
  );
}

/**
 * 从某位复制一份。
 *
 * 只在新建时出现，而且是**填表时的一个动作**，不是一种「新建模式」：
 * 点了之后提示词、活儿、工具就落到下面的草稿里，接着照常一步步改。
 * 做成两种模式的话，人得先决定「我要空白还是要复制」—— 那个决定在还没
 * 看到里面有什么的时候做不了。
 */
function CopyFrom({ patch, patchP }: Pick<StepProps, 'patch' | 'patchP'>) {
  const agents = useSettings((s) => s.agents);
  const [from, setFrom] = useState<AgentId | ''>('');

  const take = (id: AgentId) => {
    const src = personaById(id);
    const c = agents[id] ?? defaultConfig(src);
    setFrom(id);
    patchP({ preamble: src.preamble, icon: src.icon });
    patch({ skills: [...c.skills], tools: [...c.tools], models: { ...c.models },
      autonomy: c.autonomy, autoMax: c.autoMax, toolPolicy: { ...c.toolPolicy } });
  };

  return (
    <Field label="照着谁来"
      hint={from
        ? `已把${personaById(from).name}的提示词、活儿、工具抄过来，后面几步照常改`
        : '可以不选。选了就把那位现在的配置抄一份过来，再改'}>
      <Select ariaLabel="照着哪位来" value={from}
        options={[{ value: '', label: '从空白开始' },
          ...roster().map((x) => ({ value: x.id, label: x.name }))]}
        onChange={(v) => (v ? take(v) : setFrom(''))} />
    </Field>
  );
}

function Brief({ p, cfg, patchP, patch }: StepProps) {
  const custom = !!cfg.preamble?.trim();
  const text = cfg.preamble ?? p.preamble;
  return (
    <Fields>
      <Field wide label="系统提示词"
        hint={<>
          自主规划下，这段比多勾几个技能更能决定它的行为：先看什么、什么算做完、
          拿不准时偏向哪边。<b>空着也行</b> —— 那它就只按工具和活儿行事，没有判断倾向。
        </>}>
        <Textarea rows={12} value={text} aria-label={`${p.name}的系统提示词`}
          placeholder="比如：只写 15 秒能拍完的东西。前 3 秒必须有一个具体动作。"
          onChange={(e) => {
            // 出厂那五位有自己的 preamble，改回原文等于没改写 —— 那就别存一份副本
            const v = e.target.value;
            patch({ preamble: v.trim() === p.preamble.trim() ? undefined : v });
            if (p.custom) patchP({ preamble: v });
          }} />
      </Field>
      {custom && !p.custom && (
        <Field label="已改写" hint="不再跟随出厂那份">
          <Button onClick={() => patch({ preamble: undefined })}>
            <Icon name="undo" />恢复出厂那段
          </Button>
        </Field>
      )}
    </Fields>
  );
}

function Can({ cfg, patch }: StepProps) {
  const toggleSkill = (k: IntentKind) => {
    const on = cfg.skills.includes(k);
    const next = on ? cfg.skills.filter((x) => x !== k) : [...cfg.skills, k];
    // 加活儿时把它要的工具一并补上 —— 否则勾了就是个红叉，没意义
    const tools = on
      ? cfg.tools
      : [...new Set([...cfg.tools, ...TOOLS_FOR_INTENT[k as Exclude<IntentKind, 'chat'>]])];
    patch({ skills: next, tools });
  };
  const toggleTool = (t: ToolId) => {
    const on = cfg.tools.includes(t);
    patch({ tools: on ? cfg.tools.filter((x) => x !== t) : [...cfg.tools, t] });
  };

  return (
    <Fields>
      <Field wide label={`接的活儿 · ${cfg.skills.length}`}
        hint="勾上时它需要的工具会自动补齐。¥ 要花积分，↗ 会把东西送出本机">
        <div className="chipwall">
          {ALL_INTENTS.map((k) => {
            const on = cfg.skills.includes(k);
            const miss = on ? missingTools(cfg.tools, k) : [];
            return (
              <ToggleChip key={k} on={on} onClick={() => toggleSkill(k)}
                title={miss.length
                  ? `缺工具：${miss.map((t) => toolOf(t)?.name).join('、')}`
                  : RISK_WHY[riskOfIntent(k)]}>
                {INTENT_META[k].name}
                {miss.length ? ' ⚠' : riskOfIntent(k) === 'spend' ? ' ¥'
                  : riskOfIntent(k) === 'egress' ? ' ↗' : ''}
              </ToggleChip>
            );
          })}
        </div>
      </Field>
      <Field wide label={`工具 · 已给 ${cfg.tools.length} / ${TOOLS.length}`}
        hint={<>
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
  );
}

function Models({ cfg, patch }: StepProps) {
  const globals = useEffectiveGlobals();
  const needs = neededModalities(cfg);
  if (!needs.length) {
    return (
      <p className="skdesc dim" style={{ margin: 0 }}>
        上一步给的工具都不调模型，所以这一步没有要配的。加了出图或出视频那类工具再回来。
      </p>
    );
  }
  return (
    <Fields>
      {needs.map((m) => (
        <Field key={m} label={MODALITY_LABEL[m]}
          hint={`上一步给的工具里有要${MODALITY_LABEL[m]}模型的`}>
          <ModelSelect modality={m} value={cfg.models[m]} inherited={globals[m]}
            onChange={(ref) => {
              const next = { ...cfg.models };
              if (ref) next[m] = ref; else delete next[m];
              patch({ models: next });
            }} />
        </Field>
      ))}
    </Fields>
  );
}

/**
 * 放手到哪一档。
 *
 * 两层：先按风险档给一个总的上限，再对个别工具单独改。
 * 只有档的话粒度太粗（出图和出视频都算花钱，但一次出图一两个积分、
 * 一条视频几十个）；只有逐个工具的话，二十七个工具没人会一个个设。
 */
function Trust({ cfg, patch }: StepProps) {
  const autoMax = cfg.autoMax ?? DEFAULT_AUTO_MAX;
  const over = cfg.toolPolicy ?? {};
  const setOver = (t: ToolId, v: ToolApproval | undefined) => {
    const next = { ...over };
    if (v) next[t] = v; else delete next[t];
    patch({ toolPolicy: next });
  };

  // 只列这位 Agent 真有的工具 —— 没给它的工具设审批策略没有意义
  const mine = TOOLS.filter((t) => cfg.tools.includes(t.id));
  const changed = mine.filter((t) => over[t.id]);

  return (
    <Fields>
      <Field label="自主度" hint={AUTONOMY_HINT[cfg.autonomy]}>
        <Segmented ariaLabel="自主度"
          items={(['propose', 'auto'] as Autonomy[]).map((a) => ({
            key: a, label: AUTONOMY_LABEL[a], title: AUTONOMY_HINT[a],
          }))}
          value={cfg.autonomy}
          onChange={(v) => patch({ autonomy: v as Autonomy })} />
      </Field>

      {cfg.autonomy === 'auto' && (
        <>
          <Field label="自主上限"
            hint={<>
              超过这一档的动作照样停下来等你点头。
              <b>导出文件、联网这类会把东西送出本机的，调到最高也不会自动做。</b>
            </>}>
            <Segmented ariaLabel="自主上限"
              items={AUTO_MAX_CHOICES.map((r) => ({ key: r, label: RISK_LABEL[r], title: RISK_WHY[r] }))}
              value={autoMax}
              onChange={(v) => patch({ autoMax: v as Risk })} />
          </Field>

          <Field wide label={`逐个工具${changed.length ? ` · 改过 ${changed.length} 个` : ''}`}
            hint="默认跟随上面那档。个别工具想单独放开或单独卡住，在这儿改">
            <div className="apol">
              {mine.map((t) => {
                const eff = effectiveApproval(t.id, autoMax, over[t.id]);
                return (
                  <div key={t.id} className="apol__row">
                    <span className="apol__n">{t.name}</span>
                    <span className="apol__r">{RISK_LABEL[riskOfTool(t.id)]}</span>
                    {eff === 'locked'
                      ? (
                        <span className="apol__lock" title="会把东西送出这台机器，这一条不给配置绕">
                          <Icon name="bolt" />永远问你
                        </span>
                      )
                      : (
                        <Select ariaLabel={`${t.name} 的审批策略`}
                          value={over[t.id] ?? ''}
                          options={[
                            { value: '', label: eff === 'auto' ? '跟随上限 · 自动跑' : '跟随上限 · 问你' },
                            { value: 'allow', label: APPROVAL_LABEL.allow },
                            { value: 'ask', label: APPROVAL_LABEL.ask },
                          ]}
                          onChange={(v) => setOver(t.id, (v || undefined) as ToolApproval | undefined)} />
                      )}
                  </div>
                );
              })}
              {!mine.length && <span className="t-cap dim">上一步还没给它任何工具。</span>}
            </div>
          </Field>
        </>
      )}
    </Fields>
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
  inherited?: ModelRef;
  onChange: (ref: ModelRef | undefined) => void;
}) {
  const extra = useExtraModels();
  const ready = new Set<string>(useReadyProviders());
  const list = modelsOfModality(modality, extra);
  const inheritedSpec = inherited ? findModel(inherited, extra) : undefined;

  return (
    <>
      <Select ariaLabel={`${MODALITY_LABEL[modality]}模型`}
        value={value ? modelKey(value) : ''}
        options={[
          { value: '', label: inheritedSpec ? `自动 · ${inheritedSpec.name}` : '自动（还没有可用模型）' },
          ...list.map((m) => ({
            value: modelKey({ provider: m.provider, model: m.id }),
            label: `${m.name}${ready.has(m.provider) ? '' : '（未接入）'}`,
          })),
        ]}
        onChange={(v) => onChange(v ? parseModelKey(v) : undefined)} />
      {/* 一个模型都没有时，光一个空下拉框说不清该去哪儿加 */}
      {list.length === 0 && (
        <span className="t-cap dim">去「模型设置」接入厂商，再把要用的模型加上</span>
      )}
    </>
  );
}

/* ---------------- 新建：同一套步骤，装在弹窗里 ---------------- */

/**
 * 空白草稿。**名字真的留空**，不给一个「（新建）」之类的占位 ——
 * 占位名字会让「填了没填」这个判断永远是「填了」，于是下一步的拦不住。
 */
const blank = (): Persona => ({
  id: '', custom: true, name: '', en: '', icon: 'users',
  tagline: '', steps: [], owns: [], greeting: '', preamble: '',
  handoff: '这件事不在我这儿，%s 接手更合适。',
});

export function NewAgentModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: AgentId) => void;
}) {
  const add = useSettings((s) => s.addAgent);
  const patchAgent = useSettings((s) => s.patchAgent);
  const toast = useUi((s) => s.toast);

  const [at, setAt] = useState<StepKey>('who');
  const [p, setP] = useState<Persona>(blank);
  const [cfg, setCfg] = useState<AgentConfig>(() => defaultConfig(blank()));

  const i = AGENT_STEPS.findIndex((s) => s.key === at);
  const named = !!p.name.trim();

  const close = () => {
    setAt('who');
    setP(blank());
    setCfg(defaultConfig(blank()));
    onClose();
  };

  const save = () => {
    const id = add({
      name: p.name, tagline: p.tagline, icon: p.icon,
      preamble: cfg.preamble ?? p.preamble, owns: cfg.skills,
    });
    // 身份之外的那几步落在草稿里，一并写下去
    patchAgent(id, {
      skills: cfg.skills, tools: cfg.tools, models: cfg.models,
      autonomy: cfg.autonomy, autoMax: cfg.autoMax, toolPolicy: cfg.toolPolicy,
    });
    toast(`已建好「${p.name.trim()}」`);
    close();
    onCreated(id);
  };

  return (
    <Modal open={open} onClose={close} wide title="新建智能体"
      subtitle={`第 ${i + 1} / ${AGENT_STEPS.length} 步 · ${AGENT_STEPS[i]!.name}`}
      footer={<>
        {i > 0 && <Button onClick={() => setAt(AGENT_STEPS[i - 1]!.key)}>上一步</Button>}
        <div className="spacer" />
        {/* 名字之外都可以留着以后改，所以除了第一步都能直接保存 —— 
            走完五步才让保存的话，只想建个空壳的人得点四次「下一步」 */}
        <Button disabled={!named} onClick={save}>
          <Icon name="check" />{i === AGENT_STEPS.length - 1 ? '建好了' : '先保存，剩下的以后配'}
        </Button>
        {i < AGENT_STEPS.length - 1 && (
          <Button variant="primary" disabled={!named}
            onClick={() => setAt(AGENT_STEPS[i + 1]!.key)}>
            下一步<Icon name="right" />
          </Button>
        )}
      </>}>
      <div className="wzd">
        <StepRail at={at} onGo={setAt}
          // 没填名字之前不许往后走：后面几步存不下来，走过去等于白填
          reachable={(_k, n) => named || n === 0} />
        <div className="wzd__b">
          {!named && at === 'who' && (
            <p className="t-cap dim" style={{ marginTop: 0 }}>先起个名字，后面几步才能往下走。</p>
          )}
          <StepBody at={at} p={p} cfg={cfg} creating
            patch={(x) => setCfg((c) => ({ ...c, ...x }))}
            patchP={(x) => setP((cur) => ({ ...cur, ...x }))} />
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- 编辑：同一套步骤，铺在详情页上 ---------------- */

export function AgentWizard({ id }: { id: AgentId }) {
  const p = personaById(id);
  const cfgRaw = useSettings((s) => s.agents[id]);
  const cfg = cfgRaw ?? defaultConfig(p);
  const patch = useSettings((s) => s.patchAgent);
  const patchPersona = useSettings((s) => s.patchPersona);
  const reset = useSettings((s) => s.resetAgent);
  const remove = useSettings((s) => s.removeAgent);
  const globals = useEffectiveGlobals();
  const extra = useExtraModels();
  const toast = useUi((s) => s.toast);
  const [at, setAt] = useState<StepKey>('who');

  const issues = checkConfig(cfg, globals, extra);
  const i = AGENT_STEPS.findIndex((s) => s.key === at);

  return (
    <>
      <section className={`pcard${cfg.enabled ? '' : ' pcard--off'}`}>
        <header className="pcard__h">
          <span className={`aface ${faceClass(p.id)}`} aria-hidden><Icon name={p.icon} /></span>
          <span className="pcard__n">{AGENT_STEPS[i]!.name}</span>
          <span className="t-cap dim">{AGENT_STEPS[i]!.hint}</span>
          <div className="spacer" />
          <Switch on={cfg.enabled} onChange={(v) => patch(id, { enabled: v })} label="启用" />
        </header>

        <div className="wzd">
          <StepRail at={at} onGo={setAt} reachable={() => true} />
          <div className="wzd__b">
            <StepBody at={at} p={p} cfg={cfg}
              patch={(x) => patch(id, x)}
              patchP={(x) => {
                // 自定义那几位的身份信息存在 customAgents 里；提示词两边都要落
                patchPersona(id, x);
                if (x.preamble !== undefined) patch(id, { preamble: x.preamble });
              }} />
          </div>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          {i > 0 && <Button onClick={() => setAt(AGENT_STEPS[i - 1]!.key)}>上一步</Button>}
          <div className="spacer" />
          {i < AGENT_STEPS.length - 1 && (
            <Button onClick={() => setAt(AGENT_STEPS[i + 1]!.key)}>下一步<Icon name="right" /></Button>
          )}
        </div>
      </section>

      {issues.length > 0 && (
        <section className="pcard pcard--warn">
          <header className="pcard__h">
            <Icon name="bolt" />
            <span className="pcard__n">{issues.length} 条要注意</span>
          </header>
          <ul className="issues">
            {issues.map((it, n) => (
              <li key={n} className={`issue issue--${it.level}`}>
                <Icon name={it.level === 'error' ? 'x' : 'bolt'} />{it.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">这份配置</span>
          <span className="t-cap dim">改动即时生效，不用点保存</span>
          <div className="spacer" />
          {p.custom && <Chip>自己建的</Chip>}
        </header>
        <div className="row">
          <Button onClick={() => { reset(id); toast(`${p.name} 的配置已恢复默认`); }}>
            <Icon name="undo" />恢复默认
          </Button>
          <div className="spacer" />
          {p.custom && (
            <Button className="tbtn--bad"
              onClick={() => {
                remove(id);
                toast(`已删掉「${p.name}」。它认领的活儿现在没人接`);
              }}>
              <Icon name="x" />删掉这位
            </Button>
          )}
        </div>
        {!p.custom && (
          <p className="t-cap dim" style={{ marginBottom: 0 }}>
            内置的五位删不掉 —— 它们各自对应一个环节，删了那个环节就没人当班。
            不想用的话在上面停用，或者新建一位把活儿挪过去。
          </p>
        )}
      </section>
    </>
  );
}
