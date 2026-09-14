import { useState } from 'react';
import { Icon } from '@/ui/Icon';
import { SKILLS, useUi } from '@/store/ui';

/** Agent 侧栏：原型 renderAgent 同构（.agent / .agent__log / .skill / .agent__dock / .send） */
export function AgentPanel() {
  const step = useUi((s) => s.step);
  const agent = useUi((s) => s.agent);
  const agentSay = useUi((s) => s.agentSay);
  const agentReset = useUi((s) => s.agentReset);
  const toast = useUi((s) => s.toast);
  const [draft, setDraft] = useState('');
  const sk = SKILLS[step] ?? SKILLS.script!;

  const send = () => {
    const v = draft.trim();
    if (!v) { toast('先说点什么'); return; }
    agentSay(v, `收到。我会结合当前的 ${step} 环节来处理，产出会直接写进左侧文档，你可以再改。`);
    setDraft('');
  };

  return (
    <aside className="agent">
      <div className="agent__h">
        <span style={{ fontSize: 14, fontWeight: 600 }}>Agent</span>
        <div className="spacer" />
        <button className="tbtn" title="新会话" onClick={agentReset}><Icon name="plus" />New</button>
        <button className="tbtn" title="会话历史" aria-label="会话历史" style={{ padding: '0 8px' }}
          onClick={() => toast('会话历史：原型阶段仅展示')}><Icon name="hist" /></button>
      </div>
      <div className="agent__log" id="alog">
        {agent.length > 0
          ? agent.map((m, i) => (
            <div key={i} className={m.who === 'me' ? 'amsg amsg--me' : 'amsg amsg--ai'}>{m.t}</div>
          ))
          : (
            <>
              <div className="agent__hi">Hi~ I am your AI assistant</div>
              <div className="agent__lead">Based on the Skills combination,<br />I can help you:</div>
              {sk.map(([icon, name]) => (
                <button key={name} className="skill"
                  onClick={() => agentSay(name, `已启用 Skill「${name}」。告诉我要处理哪一部分，或者直接给我一句灵感。`)}>
                  <Icon name={icon} />{name}
                </button>
              ))}
            </>
          )}
      </div>
      <div className="agent__dock">
        <div className="agent__in">
          <textarea
            placeholder="Pick a skill or share an idea, e.g. &quot;an orange cat in a spacesuit watching sunset on Mars&quot;"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="tbtn" title="添加附件" aria-label="添加附件" style={{ padding: '0 8px' }}
              onClick={() => toast('附件：原型阶段不支持')}><Icon name="plus" /></button>
            <div className="spacer" />
            <button className="tbtn" title="语音输入" aria-label="语音输入" style={{ padding: '0 8px' }}
              onClick={() => toast('语音输入：原型阶段不支持')}><Icon name="mic" /></button>
            <button className="send" aria-label="发送" onClick={send}><Icon name="right" /></button>
          </div>
        </div>
      </div>
    </aside>
  );
}
