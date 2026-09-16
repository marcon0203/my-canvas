import { useState } from 'react';
import { Button, Chip, Icon, Input, Modal, Segmented, Switch } from '@/ui';
import { PROVIDERS, providerOf } from '@/domain/providers/catalog';
import {
  CAPS_OF, MODALITY_LABEL, defaultCaps, makeModel,
  type Modality, type ModelSpec, type ProviderId,
} from '@/domain/providers/model';
import { baseUrlOf, providerSetting, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

const MODALITIES: Modality[] = ['text', 'image', 'video'];

const TONE: Record<Modality, 'a' | 'ok' | 'warn'> = { text: 'a', image: 'ok', video: 'warn' };

/**
 * 模型设置 · 供应商列表。
 *
 * 卡片只答「这家接没接、有几个模型」—— 端点、密钥、模型清单都进详情页。
 * 七家的表单平铺在一页时，光是找「智谱的密钥填哪」就得滚半天。
 */
export function ProviderList({ onOpen }: { onOpen: (id: ProviderId) => void }) {
  return (
    <div className="agrid">
      {PROVIDERS.map((p) => <ProviderTile key={p.id} id={p.id} onOpen={onOpen} />)}
    </div>
  );
}

function ProviderTile({ id, onOpen }: { id: ProviderId; onOpen: (id: ProviderId) => void }) {
  const spec = providerOf(id)!;
  const setting = useSettings((s) => providerSetting(s, id));
  const toggle = useSettings((s) => s.toggleProvider);

  const models = [...spec.models, ...setting.extraModels];
  const byModality = MODALITIES.map((m) => ({ m, n: models.filter((x) => x.modality === m).length }))
    .filter((x) => x.n > 0);
  const off = setting.disabled;

  return (
    <article className={`atile${off ? ' atile--off' : ''}`}>
      <button className="atile__hit" onClick={() => onOpen(id)} aria-label={`配置${spec.name}`}>
        <header className="atile__h">
          <span className="atile__n">{spec.name}</span>
          <span className="atile__en">{spec.en}</span>
        </header>
        <p className="atile__tag">
          {setting.hasKey ? `已接入 ${setting.keyHint}` : '还没填密钥'}
          {spec.userDefined && ' · 自定义端点'}
        </p>
        <div className="chiprow" style={{ marginTop: 12 }}>
          {byModality.length
            ? byModality.map(({ m, n }) => (
              <Chip key={m} tone={TONE[m]}>{MODALITY_LABEL[m]} {n}</Chip>
            ))
            : <span className="t-cap dim">还没有模型</span>}
        </div>
        <p className={`atile__st${!setting.hasKey && !off ? ' atile__st--bad' : ''}`}>
          {off
            ? '已停用，它的模型不会出现在选择列表里'
            : setting.hasKey
              ? `${models.length} 个模型可用`
              : '没有密钥，它的模型选了也跑不起来'}
        </p>
      </button>
      <div className="atile__sw">
        <Switch on={!off} onChange={(v) => toggle(id, v)} label={`启用${spec.name}`} />
      </div>
    </article>
  );
}

/** 模型设置 · 供应商详情：端点、密钥、模型清单 */
export function ProviderDetail({ id }: { id: ProviderId }) {
  const spec = providerOf(id)!;
  const setting = useSettings((s) => providerSetting(s, id));
  const baseUrl = useSettings((s) => baseUrlOf(s, id));
  const setKey = useSettings((s) => s.setKey);
  const clearKey = useSettings((s) => s.clearKey);
  const setBaseUrl = useSettings((s) => s.setBaseUrl);
  const toast = useUi((s) => s.toast);
  const [draftKey, setDraftKey] = useState('');
  const [adding, setAdding] = useState(false);

  const models = [...spec.models, ...setting.extraModels];

  return (
    <>
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">接入</span>
          {setting.hasKey
            ? <Chip tone="ok">已接入 {setting.keyHint}</Chip>
            : <Chip tone="warn">未配置</Chip>}
          <div className="spacer" />
          {spec.console && (
            <a className="pcard__link" href={spec.console} target="_blank" rel="noreferrer">去控制台拿 key ↗</a>
          )}
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
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">模型 · {models.length}</span>
          <span className="t-cap dim">目录只是种子，跟不上新模型就自己加</span>
          <div className="spacer" />
          <Button onClick={() => setAdding(true)}><Icon name="plus" />新增模型</Button>
        </header>
        {models.length === 0 ? (
          <p className="t-cap dim" style={{ margin: 0 }}>
            还没有模型。{spec.userDefined ? '自定义端点的模型全靠自己加 —— 填模型 id 与它的类型。' : '点右上角新增一个。'}
          </p>
        ) : (
          <div className="mlist">
            {models.map((m) => <ModelRow key={m.id} providerId={id} m={m}
              custom={setting.extraModels.some((x) => x.id === m.id)} />)}
          </div>
        )}
      </section>

      <AddModelModal open={adding} providerId={id} onClose={() => setAdding(false)} />
    </>
  );
}

function ModelRow({ providerId, m, custom }: { providerId: ProviderId; m: ModelSpec; custom: boolean }) {
  const remove = useSettings((s) => s.removeModel);
  const toast = useUi((s) => s.toast);
  const caps = [
    m.caps.stream && '流式', m.caps.tools && '工具', m.caps.vision && '读图',
    m.caps.reasoning && '推理', m.caps.refImage && '参考图',
  ].filter(Boolean) as string[];
  return (
    <div className="mrow">
      <Chip tone={TONE[m.modality]}>{MODALITY_LABEL[m.modality]}</Chip>
      <span className="mrow__n">{m.name}</span>
      <span className="mono dim mrow__id">{m.id}</span>
      {m.context && <span className="t-cap dim">{Math.round(m.context / 1024)}K</span>}
      <span className="mrow__caps">{caps.map((c) => <Chip key={c}>{c}</Chip>)}</span>
      {m.note && <span className="t-cap dim mrow__note" title={m.note}>{m.note}</span>}
      <div className="spacer" />
      {custom && (
        <button className="tbtn" title="移除这个自加的模型"
          onClick={() => { remove(providerId, m.id); toast(`已移除 ${m.id}`); }}>
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}

/**
 * 新增模型。类型必须先选 —— 它决定协议族（文本走 OpenAI 兼容的
 * /chat/completions，出图出视频走各家自有的异步任务接口），也决定能勾哪些能力。
 */
function AddModelModal({ open, providerId, onClose }: {
  open: boolean;
  providerId: ProviderId;
  onClose: () => void;
}) {
  const spec = providerOf(providerId)!;
  const setting = useSettings((s) => providerSetting(s, providerId));
  const add = useSettings((s) => s.addModel);
  const toast = useUi((s) => s.toast);

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [modality, setModality] = useState<Modality>('text');
  const [context, setContext] = useState('');
  const [caps, setCaps] = useState<Record<string, boolean>>(defaultCaps('text'));

  const reset = () => {
    setId(''); setName(''); setModality('text'); setContext('');
    setCaps(defaultCaps('text'));
  };
  const close = () => { reset(); onClose(); };

  const pickModality = (m: Modality) => {
    setModality(m);
    // 换类型时把能力也换成这一类的出厂勾选，免得留着上一类的勾
    setCaps(defaultCaps(m));
  };

  const taken = [...spec.models, ...setting.extraModels].some((m) => m.id === id.trim());

  const submit = () => {
    const mid = id.trim();
    if (!mid) { toast('模型 id 必填 —— 那是调接口真正传的东西'); return; }
    if (taken) { toast(`${mid} 已经在列表里了`); return; }
    add(providerId, makeModel({
      provider: providerId, id: mid, name, modality, contextK: Number(context.trim()), caps,
    }));
    toast(`已添加 ${mid}`);
    close();
  };

  return (
    <Modal open={open} onClose={close} title="新增模型" subtitle={spec.name}
      footer={<>
        <Button onClick={close}>取消</Button>
        <Button variant="primary" onClick={submit}><Icon name="check" />添加</Button>
      </>}>
      <div className="mo__form">
        <div className="mo__field">
          <span className="sec">模型类型</span>
          <Segmented ariaLabel="模型类型"
            items={MODALITIES.map((m) => ({ key: m, label: MODALITY_LABEL[m] }))}
            value={modality}
            onChange={(v) => pickModality(v as Modality)} />
          <span className="t-cap dim">
            {modality === 'text'
              ? '走 OpenAI 兼容的 /chat/completions'
              : '走各家自有的异步任务接口：提交拿 task_id，再轮询'}
          </span>
        </div>

        <div className="mo__field">
          <span className="sec">模型 id</span>
          <Input value={id} placeholder="调接口传的那个，例如 deepseek-chat"
            onChange={(e) => setId(e.target.value)} />
          {taken && <span className="t-cap" style={{ color: 'var(--color-warning)' }}>这个 id 已经在列表里了</span>}
        </div>

        <div className="mo__field">
          <span className="sec">显示名</span>
          <Input value={name} placeholder="不填就用 id" onChange={(e) => setName(e.target.value)} />
        </div>

        {modality === 'text' && (
          <div className="mo__field">
            <span className="sec">上下文窗口</span>
            <Input value={context} placeholder="单位 K，例如 64。不确定就留空"
              onChange={(e) => setContext(e.target.value.replace(/[^\d]/g, ''))} />
          </div>
        )}

        <div className="mo__field">
          <span className="sec">能力</span>
          <div className="chiprow">
            {CAPS_OF[modality].map((c) => (
              <label key={c.k} className="capbox" title={c.hint}>
                <input type="checkbox" checked={!!caps[c.k]}
                  onChange={(e) => setCaps((p) => ({ ...p, [c.k]: e.target.checked }))} />
                {c.n}
              </label>
            ))}
          </div>
          <span className="t-cap dim">勾错了不会报错，但会让 Agent 配置页的检查说谎 —— 照厂商文档来。</span>
        </div>
      </div>
    </Modal>
  );
}
