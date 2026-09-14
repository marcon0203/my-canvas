import { useRef } from 'react';
import { Button, Segmented } from '@/ui';
import { StageBar } from '@/components/StageBar';
import { Icon } from '@/ui/Icon';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';

const TABS = [
  { k: 'character', n: '角色小传' },
  { k: 'outline', n: '故事梗概' },
  { k: 'text', n: '正文' },
] as const;

const TYPE_ICON: Record<string, string> = { character: 'users', outline: 'book', text: 'text' };

/** 剧本页：原型 viewScript 同构（.segwrap/.seg 分区 + .doc/.blk 文档块，双击编辑） */
export function ScriptPage() {
  const blocks = useProject((s) => s.blocks);
  const updateBlock = useProject((s) => s.updateBlock);
  const spend = useProject((s) => s.spend);
  const docTab = useUi((s) => s.docTab);
  const blockEdit = useUi((s) => s.blockEdit);
  const setUi = useUi((s) => s.set);
  const setStep = useUi((s) => s.setStep);
  const agentSay = useUi((s) => s.agentSay);
  const toast = useUi((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const analyze = () => {
    setStep('assets');
    agentSay('', '已从剧本解析出 2 个角色、4 个场景、3 个道具。建议把每个形状照都生成出来、定稿后再进分镜。');
    spend(3);
  };

  const exportScript = () => {
    const text = blocks.map((b) => `## ${b.label}\n\n${b.body}`).join('\n\n---\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'script.md';
    a.click();
    URL.revokeObjectURL(url);
    toast('剧本已导出为 script.md');
  };

  const importScript = (file: File) => {
    file.text().then((t) => {
      updateBlock('bk3', t);
      setUi('docTab', 'text');
      toast(`已导入 ${file.name} 到正文（可撤销）`);
    });
  };

  return (
    <div className="stage">
      <StageBar
        title="Script"
        actions={<>
          <Button style={{ padding: '0 8px' }} title="历史版本" aria-label="历史版本"
            onClick={() => toast('历史版本在顶栏撤销/重做里')}><Icon name="hist" /></Button>
          <Button style={{ padding: '0 8px' }} title="导入剧本" aria-label="导入剧本"
            onClick={() => fileRef.current?.click()}><Icon name="import" /></Button>
          <input ref={fileRef} type="file" accept=".md,.txt" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importScript(f); e.target.value = ''; }} />
          <Button style={{ padding: '0 8px' }} title="导出剧本" aria-label="导出剧本"
            onClick={exportScript}><Icon name="dl" /></Button>
          <Button variant="primary" style={{ height: 34, fontSize: 13 }} onClick={analyze}>
            一键分析资产 <Icon name="right" />
          </Button>
        </>}
      />

      <div className="stage__body">
        <div className="segwrap">
          <Segmented ariaLabel="剧本分区"
            items={TABS.map((t) => ({ key: t.k, label: t.n }))}
            value={docTab}
            onChange={(k) => { setUi('docTab', k); setUi('blockEdit', null); }} />
        </div>
        <div className="doc">
          {blocks.filter((b) => b.type === docTab).map((b) => (
            <div key={b.id} className="blk">
              <div className="blk__bar">
                <span className="blk__ico"><Icon name={TYPE_ICON[b.type] ?? 'text'} /></span>
                <span>{b.label}</span>
                <span className="blk__hint">{blockEdit === b.id ? '' : '连按两下编辑'}</span>
              </div>
              <div className="blk__body" onDoubleClick={() => setUi('blockEdit', blockEdit === b.id ? null : b.id)}>
                {blockEdit === b.id
                  ? <textarea
                      className="blk__edit"
                      autoFocus
                      value={b.body}
                      onChange={(e) => updateBlock(b.id, e.target.value)}
                      onBlur={() => setUi('blockEdit', null)} />
                  : <ScriptText body={b.body} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 极简 markdown → 剧本排版（与原型 md() 同构：h2/h3/.sc/.meta/.ln/p） */
function ScriptText({ body }: { body: string }) {
  return (
    <>
      {body.split('\n').map((line, i) => {
        const s = line.trim();
        if (!s) return null;
        if (s.startsWith('## ')) return <h3 key={i}>{s.slice(3)}</h3>;
        if (s.startsWith('# ')) return <h2 key={i}>{s.slice(2)}</h2>;
        if (/^\*\*.+\*\*$/.test(s)) return <div key={i} className="sc">{s.replaceAll('**', '')}</div>;
        if (/^[^：:]+ · /.test(s) && s.length < 40) return <div key={i} className="meta">{s}</div>;
        if (/^(旁白|艾米|年糕)[：:]/.test(s)) return <p key={i} className="ln">{s}</p>;
        return <p key={i}>{s}</p>;
      })}
    </>
  );
}
