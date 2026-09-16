import { useState } from 'react';
import { Button, Chip, Icon, Input, Select, Switch } from '@/ui';
import { PROVIDERS, providerOf } from '@/domain/providers/catalog';
import { MODALITY_LABEL, type Modality, type ModelSpec, type ProviderId } from '@/domain/providers/model';
import { baseUrlOf, providerSetting, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/** 厂商接入：端点、密钥、启用的模型。密钥只写钥匙串，界面只显示尾号 */
export function ProviderSettings() {
  return (
    <div className="setgrid">
      {PROVIDERS.map((p) => <ProviderCard key={p.id} id={p.id} />)}
    </div>
  );
}

function ProviderCard({ id }: { id: ProviderId }) {
  const spec = providerOf(id)!;
  const setting = useSettings((s) => providerSetting(s, id));
  const baseUrl = useSettings((s) => baseUrlOf(s, id));
  const setKey = useSettings((s) => s.setKey);
  const clearKey = useSettings((s) => s.clearKey);
  const setBaseUrl = useSettings((s) => s.setBaseUrl);
  const toggle = useSettings((s) => s.toggleProvider);
  const toast = useUi((s) => s.toast);
  const [draftKey, setDraftKey] = useState('');
  const [adding, setAdding] = useState(false);

  const models = [...spec.models, ...setting.extraModels];
  const off = setting.disabled;

  return (
    <section className={`pcard${off ? ' pcard--off' : ''}`}>
      <header className="pcard__h">
        <span className="pcard__n">{spec.name}</span>
        <span className="pcard__en">{spec.en}</span>
        {setting.hasKey
          ? <Chip tone="ok">已接入 {setting.keyHint}</Chip>
          : <Chip tone="warn">未配置</Chip>}
        <div className="spacer" />
        <Switch on={!off} onChange={(v) => toggle(id, v)} label="启用" />
      </header>

      <label className="pcard__row">
        <span className="pcard__k">端点</span>
        <Input value={baseUrl} placeholder={spec.userDefined ? '必填，例如 http://localhost:11434/v1' : spec.baseUrl}
          onChange={(e) => setBaseUrl(id, e.target.value)} />
      </label>

      <label className="pcard__row">
        <span className="pcard__k">密钥</span>
        <Input type="password" value={draftKey}
          placeholder={setting.hasKey ? '已写入系统钥匙串，重填可覆盖' : 'sk-…'}
          onChange={(e) => setDraftKey(e.target.value)} />
        <Button onClick={() => {
          if (!draftKey.trim()) { toast('先填密钥'); return; }
          setKey(id, draftKey.trim());
          setDraftKey('');
          toast(`${spec.name} 密钥已写入系统钥匙串 —— 前端不保存明文`);
        }}>保存</Button>
        {setting.hasKey && (
          <Button onClick={() => { clearKey(id); toast(`已清除 ${spec.name} 的密钥`); }}>清除</Button>
        )}
      </label>

      <div className="pcard__models">
        <div className="pcard__k" style={{ marginBottom: 6 }}>
          模型 · {models.length}
          {spec.console && (
            <a className="pcard__link" href={spec.console} target="_blank" rel="noreferrer">去控制台拿 key ↗</a>
          )}
        </div>
        {models.length === 0 && (
          <p className="t-cap dim" style={{ margin: 0 }}>
            还没有模型。自定义端点需要自己加 —— 填模型 id 与它的模态。
          </p>
        )}
        <div className="mlist">
          {models.map((m) => <ModelRow key={m.id} providerId={id} m={m}
            custom={setting.extraModels.some((x) => x.id === m.id)} />)}
        </div>
        {adding
          ? <AddModel providerId={id} onDone={() => setAdding(false)} />
          : <Button onClick={() => setAdding(true)}><Icon name="plus" />添加模型</Button>}
      </div>
    </section>
  );
}

function ModelRow({ providerId, m, custom }: { providerId: ProviderId; m: ModelSpec; custom: boolean }) {
  const remove = useSettings((s) => s.removeModel);
  const caps = [
    m.caps.stream && '流式', m.caps.tools && '工具', m.caps.vision && '读图',
    m.caps.reasoning && '推理', m.caps.refImage && '参考图',
  ].filter(Boolean) as string[];
  return (
    <div className="mrow">
      <Chip tone={m.modality === 'text' ? 'a' : m.modality === 'image' ? 'ok' : 'warn'}>
        {MODALITY_LABEL[m.modality]}
      </Chip>
      <span className="mrow__n">{m.name}</span>
      <span className="mono dim mrow__id">{m.id}</span>
      {m.context && <span className="t-cap dim">{Math.round(m.context / 1024)}K</span>}
      <span className="mrow__caps">{caps.map((c) => <Chip key={c}>{c}</Chip>)}</span>
      {m.note && <span className="t-cap dim mrow__note" title={m.note}>{m.note}</span>}
      <div className="spacer" />
      {custom && (
        <button className="tbtn" title="移除这个自加的模型" onClick={() => remove(providerId, m.id)}>
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}

/** 目录跟不上新模型时，自己加一条 */
function AddModel({ providerId, onDone }: { providerId: ProviderId; onDone: () => void }) {
  const add = useSettings((s) => s.addModel);
  const toast = useUi((s) => s.toast);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [modality, setModality] = useState<Modality>('text');

  return (
    <div className="addm">
      <Input value={id} placeholder="模型 id（调接口传的那个）" onChange={(e) => setId(e.target.value)} />
      <Input value={name} placeholder="显示名" onChange={(e) => setName(e.target.value)} />
      <Select ariaLabel="模态" value={modality} onChange={(v) => setModality(v as Modality)}
        options={[{ value: 'text', label: '文本' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }]} />
      <Button variant="primary" onClick={() => {
        const mid = id.trim();
        if (!mid) { toast('模型 id 必填'); return; }
        add(providerId, {
          id: mid, name: name.trim() || mid, provider: providerId, modality,
          protocol: modality === 'text' ? 'openai-chat' : 'async-task',
          caps: modality === 'text' ? { stream: true, tools: true } : { refImage: true },
        });
        toast(`已添加 ${mid}`);
        onDone();
      }}>添加</Button>
      <Button onClick={onDone}>取消</Button>
    </div>
  );
}
