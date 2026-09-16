import { Button, Icon, Select, Switch, ToggleChip } from '@/ui';
import { PERSONAS, personaById, INTENT_META, intentName } from '@/domain/agent/roster';
import type { AgentId } from '@/domain/agent/roster';
import { TOOLS, TOOLS_FOR_INTENT, missingTools, toolOf, type ToolId } from '@/domain/agent/tools';
import { checkConfig, defaultConfig, neededModalities } from '@/domain/agent/config';
import { findModel, modelsOfModality } from '@/domain/providers/catalog';
import { MODALITY_LABEL, modelKey, parseModelKey, type Modality, type ModelRef } from '@/domain/providers/model';
import type { IntentKind } from '@/domain/agent/types';
import { useEffectiveGlobals, useExtraModels, useReadyProviders, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const ALL_INTENTS = Object.keys(INTENT_META) as Exclude<IntentKind, 'chat'>[];

/** 每个 Agent 单独配：接哪些活、用什么模型、给哪些工具 */
export function AgentSettings() {
  const globals = useEffectiveGlobals();
  const setGlobal = useSettings((s) => s.setGlobalModel);

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">全局默认模型</span>
          <span className="t-cap dim">Agent 没单独指定时用这里的</span>
        </header>
        {(['text', 'image', 'video'] as Modality[]).map((m) => (
          <label key={m} className="pcard__row">
            <span className="pcard__k">{MODALITY_LABEL[m]}</span>
            <ModelSelect modality={m} value={globals[m]} onChange={(ref) => setGlobal(m, ref)} allowInherit={false} />
          </label>
        ))}
      </section>

      <div className="setgrid">
        {PERSONAS.map((p) => <AgentCard key={p.id} id={p.id} />)}
      </div>
    </>
  );
}

function AgentCard({ id }: { id: AgentId }) {
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
    <section className={`pcard${cfg.enabled ? '' : ' pcard--off'}`}>
      <header className="pcard__h">
        <span className={`aface aface--${p.id}`} aria-hidden><Icon name={p.icon} /></span>
        <span className="pcard__n">{p.name}</span>
        <span className="pcard__en">{p.en}</span>
        <div className="spacer" />
        <Switch on={cfg.enabled} onChange={(v) => patch(id, { enabled: v })} label="启用" />
      </header>
      <p className="t-cap dim" style={{ margin: '0 0 12px' }}>{p.tagline}</p>

      <div className="pcard__k" style={{ marginBottom: 6 }}>模型</div>
      {needs.map((m) => (
        <label key={m} className="pcard__row">
          <span className="pcard__k">{MODALITY_LABEL[m]}</span>
          <ModelSelect modality={m} value={cfg.models[m]}
            inherited={globals[m]}
            onChange={(ref) => {
              const next = { ...cfg.models };
              if (ref) next[m] = ref; else delete next[m];
              patch(id, { models: next });
            }} />
        </label>
      ))}

      <div className="pcard__k" style={{ margin: '12px 0 6px' }}>接的活儿 · {cfg.skills.length}</div>
      <div className="chiprow">
        {ALL_INTENTS.map((k) => {
          const on = cfg.skills.includes(k);
          const miss = on ? missingTools(cfg.tools, k) : [];
          return (
            <ToggleChip key={k} on={on} onClick={() => toggleSkill(k)}
              title={miss.length ? `缺工具：${miss.map((t) => toolOf(t)?.name).join('、')}` : intentName(k)}>
              {INTENT_META[k].name}{miss.length ? ' ⚠' : ''}
            </ToggleChip>
          );
        })}
      </div>

      <div className="pcard__k" style={{ margin: '12px 0 6px' }}>工具 · {cfg.tools.length}</div>
      <div className="chiprow">
        {TOOLS.map((t) => (
          <ToggleChip key={t.id} on={cfg.tools.includes(t.id)} onClick={() => toggleTool(t.id)}
            title={`${t.desc}${t.needs ? `（需要${MODALITY_LABEL[t.needs]}模型）` : ''}`}>
            {t.name}{t.writes ? '' : ' ·读'}
          </ToggleChip>
        ))}
      </div>

      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((it, i) => (
            <li key={i} className={`issue issue--${it.level}`}>
              <Icon name={it.level === 'error' ? 'x' : 'bolt'} />{it.text}
            </li>
          ))}
        </ul>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <div className="spacer" />
        <Button onClick={() => { reset(id); toast(`${p.name} 的配置已恢复默认`); }}>
          <Icon name="undo" />恢复默认
        </Button>
      </div>
    </section>
  );
}

/** 模型下拉：按模态过滤，只列已接入厂商的（未接入的灰显带标记） */
function ModelSelect({ modality, value, inherited, onChange, allowInherit = true }: {
  modality: Modality;
  value: ModelRef | undefined;
  inherited?: ModelRef;
  onChange: (ref: ModelRef | undefined) => void;
  allowInherit?: boolean;
}) {
  const extra = useExtraModels();
  const ready = new Set<string>(useReadyProviders());

  const list = modelsOfModality(modality, extra);
  const inheritedSpec = inherited ? findModel(inherited, extra) : undefined;

  const options = [
    ...(allowInherit
      ? [{ value: '', label: inheritedSpec ? `跟随全局 · ${inheritedSpec.name}` : '跟随全局（未设置）' }]
      : [{ value: '', label: '未设置' }]),
    ...list.map((m) => ({
      value: modelKey({ provider: m.provider, model: m.id }),
      label: `${m.name}${ready.has(m.provider) ? '' : '（未接入）'}`,
    })),
  ];

  return (
    <Select ariaLabel={`${MODALITY_LABEL[modality]}模型`}
      value={value ? modelKey(value) : ''}
      options={options}
      onChange={(v) => onChange(v ? parseModelKey(v) : undefined)} />
  );
}
