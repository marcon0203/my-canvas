import { Chip, Icon, Select } from '@/ui';
import { SKILL_FOR_TASK } from '@/api/agent';
import { INTENT_META, personaById, roster } from '@/domain/agent/roster';
import type { AgentId } from '@/domain/agent/roster';
import { TOOLS_FOR_INTENT, toolOf } from '@/domain/agent/tools';
import { defaultConfig, ownerOfConfigured } from '@/domain/agent/config';
import {
  GOTO_LABEL, TASKS, TRIGGER_WEIGHT, taskOf, toolsOf, triggersOf,
} from '@/domain/agent/tasks';
import type { TaskId } from '@/domain/agent/tasks';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Field, Fields } from './Field';

/**
 * 任务分工。
 *
 * **「任务」和「Skill」不是一回事**，这两个词以前撞在一起，是这页看不懂的
 * 根因：任务是「用户能提的一件需求」，Skill 是「磁盘上那份怎么做的说明文件」。
 * 一个任务的做法可以写在 Skill 文件里，也可以内置在程序里 —— 那是「实现方式」
 * 那一列回答的事。
 *
 * 这页按**任务**看分工，智能体管理的另一页按**人**看能力。两个方向都要有：
 * 按人看时，「成本报告谁都没接」这种漏洞得五位挨个点开才发现；按任务看，
 * 它就在那一行摆着。
 */

/** 换负责人：从原来那位身上摘掉，给新的一位补上这件任务与它需要的工具 */
function useReassign() {
  const agents = useSettings((s) => s.agents);
  const patch = useSettings((s) => s.patchAgent);
  const toast = useUi((s) => s.toast);

  return (kind: TaskId, to: AgentId | '') => {
    for (const p of roster()) {
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
    toast(to
      ? `「${INTENT_META[kind].name}」已交给${personaById(to).name}`
      : `「${INTENT_META[kind].name}」暂时没有负责人，用户提到时会被告知做不了`);
  };
}

function OwnerSelect({ kind }: { kind: TaskId }) {
  const agents = useSettings((s) => s.agents);
  const reassign = useReassign();
  return (
    <Select ariaLabel={`${INTENT_META[kind].name} 由谁负责`}
      value={ownerOfConfigured(kind, agents) ?? ''}
      options={[
        { value: '', label: '无人负责' },
        ...roster().map((p) => ({ value: p.id, label: p.name })),
      ]}
      onChange={(v) => reassign(kind, v as AgentId | '')} />
  );
}

/** 哪些任务现在没有负责人。空数组 = 12 件都有人做 */
export const orphanTasks = (agents: ReturnType<typeof useSettings.getState>['agents']) =>
  TASKS.filter((t) => !ownerOfConfigured(t.id, agents));

/**
 * 没有负责人的提示。
 *
 * **放在页签之外**，两个页签都看得见 —— 一件任务没人负责是真问题
 * （用户提了会被告知做不了），藏在某一页后面就发现不了。
 */
export function OrphanNotice() {
  const agents = useSettings((s) => s.agents);
  const orphans = orphanTasks(agents);
  if (!orphans.length) return null;
  return (
    <section className="pcard pcard--warn">
      <header className="pcard__h">
        <Icon name="bolt" />
        <span className="pcard__n">{orphans.length} 个任务没有负责人</span>
      </header>
      <p className="skdesc" style={{ margin: 0 }}>
        <b>{orphans.map((t) => t.name).join('、')}</b>
        ：现在谁都不会做。用户要求时会被告知做不了。
        到「任务分工」里的「负责人」选一位即可。
      </p>
    </section>
  );
}

/** 任务分工 · 列表：12 件任务各由谁负责 */
export function TaskList({ onOpen }: { onOpen: (id: string) => void }) {
  const agents = useSettings((s) => s.agents);
  const editable = new Set(Object.values(SKILL_FOR_TASK));

  return (
    <section className="pcard">
      <header className="pcard__h">
        <span className="pcard__n">任务 · {TASKS.length}</span>
        <span className="t-cap dim">
          其中 {editable.size} 项的做法写在 Skill 文件里，可修改；其余内置在程序中
        </span>
      </header>
      <div className="sktable">
        <div className="skhead">
          <span /><span>任务</span><span>结果写入</span><span>实现方式</span><span>负责人</span>
        </div>
        {TASKS.map((t) => {
          const owner = ownerOfConfigured(t.id, agents);
          const skill = SKILL_FOR_TASK[t.id];
          return (
            <div key={t.id} className={`skrow${owner ? '' : ' skrow--orphan'}`}>
              <span className="skrow__ic"><Icon name={t.icon} /></span>
              <button className="skrow__main" onClick={() => onOpen(t.id)}
                title="查看触发条件、前置条件与结果写入位置">
                <span className="skrow__n">{t.name}</span>
                {/* 这里原来显示 intent key（outline.draft 这种）。那是内部标识，
                    对着它猜这件事做什么，不如直接把它做什么写出来 */}
                <span className="dim skrow__k">{t.summary}</span>
              </button>
              <span className="skrow__out">{t.goto ? GOTO_LABEL[t.goto] : '仅输出报告'}</span>
              <span>
                {skill
                  ? <Chip tone="ok">{skill}</Chip>
                  : <span className="t-cap dim">内置</span>}
              </span>
              <span className="skrow__own"><OwnerSelect kind={t.id} /></span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 任务分工 · 详情：这件任务怎么做、由谁做、什么时候触发 */
export function TaskDetail({ id }: { id: TaskId }) {
  const agents = useSettings((s) => s.agents);
  const s = taskOf(id)!;
  const owner = ownerOfConfigured(id, agents);
  const ownerCfg = owner ? agents[owner] : undefined;
  const t = triggersOf(id);

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">功能说明</span>
          <div className="spacer" />
          {s.impl.by === 'model' ? <Chip tone="ok">调模型</Chip> : <Chip>本地生成</Chip>}
        </header>
        <p className="skdesc">{s.summary}</p>
        <Fields>
          <Field label="负责人" hint={owner
            ? `由${personaById(owner).name}执行。换人时它需要的工具会自动补给新的那位。`
            : '现在无人负责，用户要求时会被告知做不了。'}>
            <OwnerSelect kind={id} />
          </Field>
          <Field label="前置条件" hint="不满足时会明确告知无法执行，而不是假装完成">
            <span className="skplain">{s.needs}</span>
          </Field>
          <Field label="结果">
            <span className="skplain">
              {s.goto
                ? <>先给你一份待确认的结果，点采纳后写进「{GOTO_LABEL[s.goto]}」，可以撤销</>
                : '只给一份报告，不改项目内容'}
            </span>
          </Field>
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">触发条件</span>
          <span className="t-cap dim">你输入一句话时，按这些关键词判断该执行哪个功能</span>
        </header>
        <Fields>
          <Field wide label={`动作词 · 命中一个记 ${TRIGGER_WEIGHT.act} 分`}>
            <div className="chipwall">
              {t.act.map((w) => <Chip key={w} tone="a">{w}</Chip>)}
            </div>
          </Field>
          <Field wide label={`主题词 · 命中一个记 ${TRIGGER_WEIGHT.topic} 分`}
            hint="说「按大纲拆镜」时，「拆镜」是动作、「大纲」只是背景，所以做的是分镜">
            <div className="chipwall">
              {t.topic.length
                ? t.topic.map((w) => <Chip key={w}>{w}</Chip>)
                : <span className="t-cap dim">没有主题词，只看动作</span>}
            </div>
          </Field>
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">依赖的工具</span>
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
                <span><b>{spec?.name}</b>：{spec?.desc}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">实现方式</span>
        </header>
        <p className="skdesc">
          {s.impl.by === 'model'
            ? <>桌面端走 Rust + Rig 真发请求，实现在 <span className="mono">{s.impl.module}</span>。浏览器里没有这条链路，会回落到本地草稿。</>
            : '还没接模型：结果在本地按规则生成，格式与接模型之后一致。具体依据见下面一行。'}
        </p>
        <p className="skdesc dim">{s.impl.note}</p>
      </section>
    </>
  );
}
