import { Chip, Icon, Select } from '@/ui';
import { INTENT_META, PERSONAS, personaById } from '@/domain/agent/roster';
import type { AgentId } from '@/domain/agent/roster';
import { TOOLS_FOR_INTENT, toolOf } from '@/domain/agent/tools';
import { defaultConfig, ownerOfConfigured } from '@/domain/agent/config';
import type { IntentKind } from '@/domain/agent/types';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const ALL = Object.keys(INTENT_META) as Exclude<IntentKind, 'chat'>[];

/**
 * Skill 管理：从**活儿**的角度看分工，而不是从 Agent 的角度。
 *
 * 智能体管理页回答「这位 Agent 能干什么」；这页回答「这件活归谁、要什么工具、
 * 现在有没有人接」—— 一件活没人接是真问题，从 Agent 那边一个个翻很难发现。
 */
export function SkillSettings() {
  const agents = useSettings((s) => s.agents);
  const patch = useSettings((s) => s.patchAgent);
  const toast = useUi((s) => s.toast);

  const orphans = ALL.filter((k) => !ownerOfConfigured(k, agents));

  /** 换归属：从旧主人那儿摘掉，给新主人补上技能与所需工具 */
  const reassign = (kind: Exclude<IntentKind, 'chat'>, to: AgentId | '') => {
    for (const p of PERSONAS) {
      const cur = agents[p.id] ?? defaultConfig(p);
      const has = cur.skills.includes(kind);
      if (p.id === to && !has) {
        patch(p.id, {
          skills: [...cur.skills, kind],
          tools: [...new Set([...cur.tools, ...TOOLS_FOR_INTENT[kind]])],
        });
      } else if (p.id !== to && has) {
        patch(p.id, { skills: cur.skills.filter((x) => x !== kind) });
      }
    }
    toast(to ? `「${INTENT_META[kind].name}」已归${personaById(to).name}` : `「${INTENT_META[kind].name}」暂时没人接`);
  };

  return (
    <>
      {orphans.length > 0 && (
        <section className="pcard pcard--warn">
          <header className="pcard__h">
            <Icon name="bolt" />
            <span className="pcard__n">{orphans.length} 件活儿没人接</span>
          </header>
          <p className="t-cap dim" style={{ margin: 0, lineHeight: 1.8 }}>
            {orphans.map((k) => INTENT_META[k].name).join('、')}
            —— 用户提到这些需求时 Agent 会明说「没人接」，而不是硬着头皮做。
            在下面给它指派一位，或者就这么放着。
          </p>
        </section>
      )}

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">全部 Skill · {ALL.length}</span>
          <span className="t-cap dim">归属改这里，工具会自动补齐</span>
        </header>
        <div className="skilltable">
          {ALL.map((k) => <SkillRow key={k} kind={k} onReassign={reassign} />)}
        </div>
      </section>
    </>
  );
}

function SkillRow({ kind, onReassign }: {
  kind: Exclude<IntentKind, 'chat'>;
  onReassign: (k: Exclude<IntentKind, 'chat'>, to: AgentId | '') => void;
}) {
  const agents = useSettings((s) => s.agents);
  const owner = ownerOfConfigured(kind, agents);
  const needs = TOOLS_FOR_INTENT[kind];

  return (
    <div className={`skillrow${owner ? '' : ' skillrow--orphan'}`}>
      <span className="skillrow__ic"><Icon name={INTENT_META[kind].icon} /></span>
      <div className="skillrow__main">
        <span className="skillrow__n">{INTENT_META[kind].name}</span>
        <span className="mono dim skillrow__k">{kind}</span>
      </div>
      <div className="skillrow__tools">
        {needs.map((t) => (
          <Chip key={t} tone={toolOf(t)?.needs ? 'a' : undefined}>{toolOf(t)?.name ?? t}</Chip>
        ))}
      </div>
      <Select ariaLabel={`${INTENT_META[kind].name} 的归属`}
        value={owner ?? ''}
        options={[
          { value: '', label: '没人接' },
          ...PERSONAS.map((p) => ({ value: p.id, label: p.name })),
        ]}
        onChange={(v) => onReassign(kind, v as AgentId | '')} />
    </div>
  );
}
