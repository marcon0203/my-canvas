import { useEffect, useState } from 'react';
import { Chip, Icon, Select } from '@/ui';
import { isDesktop, skillBody, skillsList, type SkillList as SkillList_ } from '@/api/desktop';
import { SKILL_FOR_INTENT } from '@/api/agent';
import type { SkillMeta } from '@/domain/skills/loader';
import { INTENT_META, PERSONAS, personaById } from '@/domain/agent/roster';
import type { AgentId } from '@/domain/agent/roster';
import { TOOLS_FOR_INTENT, toolOf } from '@/domain/agent/tools';
import { defaultConfig, ownerOfConfigured } from '@/domain/agent/config';
import {
  GOTO_LABEL, SKILLS, TRIGGER_WEIGHT, skillOf, toolsOf, triggersOf,
} from '@/domain/agent/skills';
import type { SkillId } from '@/domain/agent/skills';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Field, Fields } from './Field';

/** 换归属：从旧主人那儿摘掉，给新主人补上技能与所需工具 */
function useReassign() {
  const agents = useSettings((s) => s.agents);
  const patch = useSettings((s) => s.patchAgent);
  const toast = useUi((s) => s.toast);

  return (kind: SkillId, to: AgentId | '') => {
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
}

function OwnerSelect({ kind }: { kind: SkillId }) {
  const agents = useSettings((s) => s.agents);
  const reassign = useReassign();
  return (
    <Select ariaLabel={`${INTENT_META[kind].name} 的归属`}
      value={ownerOfConfigured(kind, agents) ?? ''}
      options={[
        { value: '', label: '没人接' },
        ...PERSONAS.map((p) => ({ value: p.id, label: p.name })),
      ]}
      onChange={(v) => reassign(kind, v as AgentId | '')} />
  );
}

/**
 * Skill 管理 · 列表页。从**活儿**的角度看分工，而不是从 Agent 的角度。
 *
 * 智能体管理页回答「这位 Agent 能干什么」；这页回答「这件活归谁、有没有人接」。
 * 一件活没人接是真问题，从 Agent 那边一个个翻很难发现。
 */
export function SkillList({ onOpen }: { onOpen: (id: string) => void }) {
  const agents = useSettings((s) => s.agents);
  const [loaded, setLoaded] = useState<SkillList_ | null>(null);
  useEffect(() => { void skillsList().then(setLoaded); }, []);

  const orphans = SKILLS.filter((s) => !ownerOfConfigured(s.id, agents));
  const migrated = new Set(Object.values(SKILL_FOR_INTENT));

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">已装载的 Skill · {loaded?.skills.length ?? 0}</span>
          <span className="t-cap dim">
            {isDesktop() ? '扫描内置目录与用户目录' : '浏览器里只能看到内置的 —— 没有文件系统'}
          </span>
        </header>
        <p className="skdesc dim">
          一个 Skill 是磁盘上的一个目录：<span className="mono">SKILL.md</span> 里
          frontmatter 写 name 与 description，正文是给模型的指令。
          加载分三级 —— 名字与说明常驻，正文用到才读，
          <span className="mono">references/</span> 里的附件正文指到哪个读哪个。
          往用户目录里放一个文件夹就多一个 Skill，不用改代码。
        </p>
        {loaded?.skills.length
          ? (
            <div className="sktable">
              <div className="skhead">
                <span /><span>名字</span><span>来源</span><span>附件</span><span />
              </div>
              {loaded.skills.map((m) => (
                <div key={m.name} className="skrow">
                  <span className="skrow__ic"><Icon name="wand" /></span>
                  <button className="skrow__main" onClick={() => onOpen(m.name)}
                    title="看它的正文与附件">
                    <span className="skrow__n mono">{m.name}</span>
                    <span className="dim skrow__k">{m.description}</span>
                  </button>
                  <span className="skrow__out">{m.source}</span>
                  <span className="chipwall">
                    {m.hasReferences && <Chip>references</Chip>}
                    {m.hasScripts && <Chip>scripts</Chip>}
                    {m.hasAssets && <Chip>assets</Chip>}
                    {!m.hasReferences && !m.hasScripts && !m.hasAssets
                      && <span className="t-cap dim">只有 SKILL.md</span>}
                  </span>
                  <span />
                </div>
              ))}
            </div>
          )
          : <p className="t-cap dim" style={{ margin: 0 }}>还没有装载任何 Skill。</p>}
      </section>

      {!!loaded?.warnings.length && (
        <section className="pcard pcard--warn">
          <header className="pcard__h">
            <Icon name="bolt" />
            <span className="pcard__n">{loaded.warnings.length} 个目录没被当成 Skill</span>
          </header>
          <ul className="issues">
            {loaded.warnings.map((w) => (
              <li key={w.dir} className="issue issue--warn">
                <Icon name="x" /><span className="mono">{w.dir}</span> —— {w.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {orphans.length > 0 && (
        <section className="pcard pcard--warn">
          <header className="pcard__h">
            <Icon name="bolt" />
            <span className="pcard__n">{orphans.length} 件活儿没人接</span>
          </header>
          <p className="t-cap dim" style={{ margin: 0, lineHeight: 1.8 }}>
            {orphans.map((s) => s.name).join('、')}
            —— 用户提到这些需求时 Agent 会明说「没人接」，而不是硬着头皮做。
          </p>
        </section>
      )}

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">内置能力 · {SKILLS.length}</span>
          <span className="t-cap dim">
            {migrated.size} 件已经有 SKILL.md，其余还是写死在代码里的逻辑
          </span>
        </header>
        <div className="sktable">
          <div className="skhead">
            <span /><span>活儿</span><span>产出</span><span>Skill</span><span>归属</span>
          </div>
          {SKILLS.map((s) => {
            const owner = ownerOfConfigured(s.id, agents);
            const skill = SKILL_FOR_INTENT[s.id];
            return (
              <div key={s.id} className={`skrow${owner ? '' : ' skrow--orphan'}`}>
                <span className="skrow__ic"><Icon name={s.icon} /></span>
                <button className="skrow__main" onClick={() => onOpen(s.id)}
                  title="查看这件活的触发词、前置条件与产出">
                  <span className="skrow__n">{s.name}</span>
                  <span className="mono dim skrow__k">{s.id}</span>
                </button>
                <span className="skrow__out">{s.goto ? GOTO_LABEL[s.goto] : '只出报告'}</span>
                <span>
                  {skill
                    ? <Chip tone="ok">{skill}</Chip>
                    : <span className="t-cap dim">还没有</span>}
                </span>
                <span className="skrow__own"><OwnerSelect kind={s.id} /></span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

/** 真 Skill 的详情：正文（第 2 级）与附件（第 3 级）都在点进来之后才读 */
export function SkillFileDetail({ name }: { name: string }) {
  const [meta, setMeta] = useState<SkillMeta | null>(null);
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    void skillsList().then((l) => setMeta(l.skills.find((s) => s.name === name) ?? null));
    void skillBody(name).then(setBody);
  }, [name]);

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">description</span>
          <span className="t-cap dim">常驻在上下文里的就这一句，模型靠它决定用不用</span>
          <div className="spacer" />
          {meta && <Chip>{meta.source}</Chip>}
        </header>
        <p className="skdesc">{meta?.description ?? '读取中…'}</p>
        {meta && <p className="t-cap dim mono" style={{ margin: 0 }}>{meta.dir}</p>}
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">SKILL.md 正文</span>
          <span className="t-cap dim">第 2 级：轮到这个 skill 时才读进上下文</span>
        </header>
        <pre className="skbody">{body ?? '读取中…'}</pre>
      </section>

      {meta && (meta.hasReferences || meta.hasScripts || meta.hasAssets) && (
        <section className="pcard">
          <header className="pcard__h">
            <span className="pcard__n">附件</span>
            <span className="t-cap dim">第 3 级：正文指到哪个才读哪个</span>
          </header>
          <div className="chipwall">
            {meta.hasReferences && <Chip tone="a">references/</Chip>}
            {meta.hasScripts && <Chip tone="a">scripts/</Chip>}
            {meta.hasAssets && <Chip tone="a">assets/</Chip>}
          </div>
          <p className="t-cap dim" style={{ marginTop: 12, marginBottom: 0 }}>
            scripts 里的东西是拿来**执行**的，不进上下文 —— 这是三级里最省的一档。
          </p>
        </section>
      )}
    </>
  );
}

/** Skill 管理 · 详情页：这件活到底怎么干 */
export function SkillDetail({ id }: { id: SkillId }) {
  const agents = useSettings((s) => s.agents);
  const s = skillOf(id)!;
  const owner = ownerOfConfigured(id, agents);
  const ownerCfg = owner ? agents[owner] : undefined;
  const t = triggersOf(id);

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">这件活干什么</span>
          <div className="spacer" />
          {s.impl.by === 'model' ? <Chip tone="ok">已接模型</Chip> : <Chip>本地草稿</Chip>}
        </header>
        <p className="skdesc">{s.summary}</p>
        <Fields>
          <Field label="归属" hint={owner
            ? `${personaById(owner).name}接这件活。换人时所需工具会自动补给新主人。`
            : '现在没人接 —— 用户提到时 Agent 会明说做不了，而不是硬着头皮做。'}>
            <OwnerSelect kind={id} />
          </Field>
          <Field label="前置条件" hint="不满足时 Agent 说不行，而不是假装做了">
            <span className="skplain">{s.needs}</span>
          </Field>
          <Field label="产出">
            <span className="skplain">
              {s.goto
                ? <>一份待采纳的产物（<span className="mono">{s.patch}</span>），采纳后落到「{GOTO_LABEL[s.goto]}」页，计一条撤销记录</>
                : '只说话，没有可采纳的产物 —— 它读记账数据出报告，不改项目'}
            </span>
          </Field>
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">什么时候轮到它</span>
          <span className="t-cap dim">自由输入按这些词打分：动词决定意图，主题词只加权</span>
        </header>
        <Fields>
          <Field wide label={`动作词 · 每命中一个 +${TRIGGER_WEIGHT.act}`}>
            <div className="chipwall">
              {t.act.map((w) => <Chip key={w} tone="a">{w}</Chip>)}
            </div>
          </Field>
          <Field wide label={`主题词 · 每命中一个 +${TRIGGER_WEIGHT.topic}`}
            hint="「按大纲拆镜」里「大纲」是主题、「拆镜」是动作，所以落到分镜而不是大纲">
            <div className="chipwall">
              {t.topic.length
                ? t.topic.map((w) => <Chip key={w}>{w}</Chip>)
                : <span className="t-cap dim">没有主题词，只认动作</span>}
            </div>
          </Field>
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">要哪些工具</span>
          <span className="t-cap dim">
            {owner ? `勾掉任意一个，${personaById(owner).name}就接不了这件活` : '指派给谁，就自动补给谁'}
          </span>
        </header>
        <div className="chipwall">
          {toolsOf(id).map((tid) => {
            const spec = toolOf(tid);
            const missing = ownerCfg && !ownerCfg.tools.includes(tid);
            return (
              <Chip key={tid} tone={missing ? 'warn' : spec?.needs ? 'a' : undefined}>
                {spec?.name ?? tid}{missing ? ' · 缺' : ''}
              </Chip>
            );
          })}
        </div>
        <ul className="issues" style={{ marginTop: 12 }}>
          {toolsOf(id).map((tid) => {
            const spec = toolOf(tid);
            return (
              <li key={tid} className="issue">
                <Icon name={spec?.writes ? 'wand' : 'book'} />
                <span><b>{spec?.name}</b> —— {spec?.desc}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">怎么实现的</span>
        </header>
        <p className="skdesc">
          {s.impl.by === 'model'
            ? <>桌面端走 Rust + Rig 真发请求，实现在 <span className="mono">{s.impl.module}</span>。浏览器里没有这条链路，会回落到本地草稿。</>
            : '还没接模型：产物由前端按项目现状算出来，形状与真产物一致，所以接模型时界面不用改。'}
        </p>
        <p className="skdesc dim">{s.impl.note}</p>
      </section>
    </>
  );
}
