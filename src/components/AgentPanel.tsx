import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/ui/Icon';
import { useUi } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { skillsFor } from '@/domain/agent/skills';
import type { AgentMessage, Proposal } from '@/domain/agent/types';

/**
 * Agent 侧栏：流式对话驱动整条流水线。
 * 一轮 = 步骤卡（自己走完）→ 流式正文 → 产物卡（采纳 / 丢弃）。
 * 采纳才写项目，且记一条撤销 —— Agent 不会背着人改东西。
 */
export function AgentPanel() {
  const step = useUi((s) => s.step);
  const toast = useUi((s) => s.toast);
  const messages = useAgent((s) => s.messages);
  const runningId = useAgent((s) => s.runningId);
  const send = useAgent((s) => s.send);
  const stop = useAgent((s) => s.stop);
  const reset = useAgent((s) => s.reset);
  const syncStep = useAgent((s) => s.syncStep);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  // 换环节开新会话（技能卡是按环节推的）。
  // 用 syncStep 而非 reset：其它页面「跳到本环节并直接发起一轮」的场景不能被清掉
  useEffect(() => { syncStep(step); }, [step, syncStep]);

  // 流式输出时钉住底部
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const v = draft.trim();
    if (!v) { toast('先说点什么'); return; }
    setDraft('');
    send(v);
  };

  return (
    <aside className="agent">
      <div className="agent__h">
        <span style={{ fontSize: 14, fontWeight: 600 }}>Agent</span>
        <div className="spacer" />
        <button className="tbtn" title="新会话" onClick={reset}><Icon name="plus" />New</button>
        <button className="tbtn" title="会话历史" aria-label="会话历史" style={{ padding: '0 8px' }}
          onClick={() => toast('会话历史：本地模拟阶段只保留当前会话')}><Icon name="hist" /></button>
      </div>

      <div className="agent__log" id="alog" ref={logRef}>
        {messages.length > 0
          ? messages.map((m) => <MessageView key={m.id} msg={m} />)
          : (
            <>
              <div className="agent__hi">Hi~ I am your AI assistant</div>
              <div className="agent__lead">Based on the Skills combination,<br />I can help you:</div>
              {skillsFor(step).map((sk) => (
                <button key={sk.kind + sk.name} className="skill" onClick={() => send(sk.name, sk.kind)}>
                  <Icon name={sk.icon} />{sk.name}
                </button>
              ))}
            </>
          )}
      </div>

      <div className="agent__dock">
        <div className="agent__in">
          <textarea
            placeholder='说一句要做的事，例如"按大纲拆镜""把这段润色一下""算一下成本"'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="tbtn" title="添加附件" aria-label="添加附件" style={{ padding: '0 8px' }}
              onClick={() => toast('附件：本地模拟阶段不支持')}><Icon name="plus" /></button>
            <div className="spacer" />
            <button className="tbtn" title="语音输入" aria-label="语音输入" style={{ padding: '0 8px' }}
              onClick={() => toast('语音输入：本地模拟阶段不支持')}><Icon name="mic" /></button>
            {runningId !== null
              ? <button className="send send--stop" aria-label="停止生成" title="停止" onClick={stop}><Icon name="x" /></button>
              : <button className="send" aria-label="发送" onClick={submit}><Icon name="right" /></button>}
          </div>
        </div>
      </div>
    </aside>
  );
}

function MessageView({ msg }: { msg: AgentMessage }) {
  if (msg.who === 'me') return <div className="amsg amsg--me">{msg.text}</div>;
  return (
    <div className="amsg amsg--ai">
      {!!msg.steps?.length && <StepList steps={msg.steps} done={msg.stepDone ?? 0} />}
      {msg.text
        ? <div className="amsg__body">{renderRich(msg.text)}{msg.streaming && <span className="caret" />}</div>
        : msg.streaming && !msg.steps?.length ? <span className="caret" /> : null}
      {msg.proposal && <ProposalCard msgId={msg.id} p={msg.proposal} verdict={msg.verdict ?? 'pending'} />}
    </div>
  );
}

function StepList({ steps, done }: { steps: AgentMessage['steps'] & object; done: number }) {
  return (
    <div className="asteps">
      {steps.map((s, i) => {
        const state = i < done ? 'done' : i === done ? 'run' : 'wait';
        return (
          <div key={s.label} className={`astep astep--${state}`}>
            <span className="astep__ic">
              {state === 'done' ? <Icon name="check" /> : state === 'run' ? <span className="astep__spin" /> : <Icon name={s.icon} />}
            </span>
            <span className="astep__t">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ProposalCard({ msgId, p, verdict }: { msgId: number; p: Proposal; verdict: NonNullable<AgentMessage['verdict']> }) {
  const accept = useAgent((s) => s.accept);
  const discard = useAgent((s) => s.discard);
  return (
    <div className={`aprop aprop--${verdict}`}>
      <div className="aprop__h">
        <Icon name="layers" />
        <span className="aprop__t">{p.title}</span>
        {!!p.cost && <span className="aprop__cost"><Icon name="bolt" />{p.cost}</span>}
      </div>
      <div className="aprop__rows">
        {p.rows.map((r, i) => (
          <div key={i} className="aprop__row">
            <span className="aprop__k">{r.k}</span>
            <span className="aprop__v">{r.v}</span>
          </div>
        ))}
      </div>
      {verdict === 'pending' ? (
        <div className="aprop__act">
          <button className="tbtn tbtn--pri" onClick={() => accept(msgId)}><Icon name="check" />采纳</button>
          <button className="tbtn" onClick={() => discard(msgId)}><Icon name="x" />丢弃</button>
        </div>
      ) : (
        <div className="aprop__act aprop__act--settled">
          <Icon name={verdict === 'accepted' ? 'check' : 'x'} />
          {verdict === 'accepted' ? '已写入项目 · 可 Ctrl+Z 撤销' : '已丢弃'}
        </div>
      )}
    </div>
  );
}

/** 极简富文本：**粗体** 与换行。Agent 回复里只用到这两种 */
function renderRich(text: string) {
  return text.split('\n').map((line, li) => (
    <p key={li} className="amsg__p">
      {line.split(/(\*\*[^*]+\*\*)/g).map((seg, si) =>
        seg.startsWith('**') && seg.endsWith('**')
          ? <strong key={si}>{seg.slice(2, -2)}</strong>
          : <span key={si}>{seg}</span>)}
    </p>
  ));
}
