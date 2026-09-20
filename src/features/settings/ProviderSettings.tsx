import { useState } from 'react';
import { Button, Chip, Icon, Input, Modal, Segmented, Switch, ToggleChip } from '@/ui';
import { PROVIDERS, isBuiltinProvider, specOf } from '@/domain/providers/catalog';
import {
  CAPS_OF, MODALITIES, MODALITY_LABEL, defaultCaps, makeModel,
  type Modality, type ModelSpec, type ProviderId,
} from '@/domain/providers/model';
import { baseUrlOf, providerSetting, useAddedProviders, useSettings } from '@/store/settings';
import { Field, Fields } from './Field';
import { useUi } from '@/store/ui';

const TONE: Record<Modality, 'a' | 'ok' | 'warn'> = { text: 'a', image: 'ok', video: 'warn', audio: 'a' };

/**
 * 读不了的那几份配置文件。
 *
 * **不能默默跳过。** 手写 YAML 缩进差一格是常事，跳过的结果是「我明明配了
 * DeepSeek，设置页里怎么没有」—— 而人根本不会想到是那个文件写坏了。
 * 所以如实说是哪个文件、哪儿坏了，并且说清它在哪个目录。
 */
function BadFiles({ bad }: { bad: readonly [string, string][] }) {
  return (
    <section className="pcard pcard--bad">
      <header className="pcard__h">
        <span className="pcard__n">有 {bad.length} 份配置文件读不了</span>
      </header>
      <p className="t-cap dim">
        它们在工作空间的 providers 目录下。改好之后回到这一页就会重新读。
      </p>
      <ul className="badlist">
        {bad.map(([id, why]) => (
          <li key={id}>
            <code>{id}.yaml</code>
            <span className="t-cap dim">{why}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 模型设置 · 供应商列表。
 *
 * 卡片只答「这家接没接、有几个模型」—— 端点、密钥、模型清单都进详情页。
 * 七家的表单平铺在一页时，光是找「智谱的密钥填哪」就得滚半天。
 */
export function ProviderList({ onOpen }: { onOpen: (id: ProviderId) => void }) {
  const added = useAddedProviders();
  const bad = useSettings((s) => s.badProviders);
  const [adding, setAdding] = useState(false);

  return (
    <>
      {bad.length > 0 && <BadFiles bad={bad} />}
      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">已接入 · {added.length}</span>
          <span className="t-cap dim">
            内置 {PROVIDERS.length} 家；往工作空间 <span className="mono">providers/</span> 里
            丢一份 YAML 就是新接一家
          </span>
          <div className="spacer" />
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />新增供应商
          </Button>
        </header>

        {added.length === 0 ? (
          <div className="empty">
            <Icon name="cube" />
            还没接入任何供应商。点右上角选一家，填上密钥。
            <span className="t-cap dim">接入之后再加要用的模型，模型不预设。</span>
          </div>
        ) : (
          <div className="agrid">
            {added.map((id) => <ProviderTile key={id} id={id} onOpen={onOpen} />)}
          </div>
        )}
      </section>

      <AddProviderModal open={adding} onClose={() => setAdding(false)} onAdded={onOpen} />
    </>
  );
}

/**
 * 一家厂商一张卡：接没接、有几个模型、停用没停用。
 *
 * 模型数全部来自用户添加 —— 目录不预设模型，所以「0 个模型」是
 * 刚接入的正常状态，卡片得把下一步说出来，而不是显示成一个错误。
 */
function ProviderTile({ id, onOpen }: { id: ProviderId; onOpen: (id: ProviderId) => void }) {
  const setting = useSettings((s) => providerSetting(s, id));
  // specOf 而不是 providerOf(id)! —— 自建的那几家（工作空间里丢进去的 YAML）
  // 在目录里查不到，那个非空断言会让详情页直接崩
  const spec = specOf(id, setting);
  const toggle = useSettings((s) => s.toggleProvider);

  const models = setting.extraModels;
  const byModality = MODALITIES.map((m) => ({ m, n: models.filter((x) => x.modality === m).length }))
    .filter((x) => x.n > 0);
  const off = setting.disabled;

  return (
    <article className={`atile${off ? ' atile--off' : ''}`}>
      <button className="atile__hit" onClick={() => onOpen(id)} aria-label={`配置${spec.name}`}>
        <header className="atile__h">
          <span className="atile__n">{spec.name}</span>
          <span className="atile__en">{spec.en}</span>
          {/* 内置与自建要分得开：自建的名字、端点、模型全来自那份 YAML，
              出问题该去看文件，而不是以为产品漏配了 */}
          {!isBuiltinProvider(id) && <Chip>自建</Chip>}
        </header>
        <p className="atile__tag">
          {setting.hasKey ? `已接入 ${setting.keyHint}` : '还没填密钥'}
          {spec.userDefined && ' · 自定义端点'}
        </p>
        {!isBuiltinProvider(id) && (
          <p className="t-cap dim" style={{ margin: '4px 0 0' }}>
            来自 <span className="mono">providers/{id}.yaml</span> · 文本可用；
            出图出视频要各家自有的异步接口，自建的那条还没适配
          </p>
        )}
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
            : !setting.hasKey
              ? '未填写密钥，即使选了模型也无法调用'
              : !spec.baseUrl
                ? '这份 YAML 里没写 baseUrl —— 没有端点发不出请求'
                : models.length
                  ? `${models.length} 个模型可用`
                  : '还没加模型，点进去加'}
        </p>
      </button>
      <div className="atile__sw">
        <Switch on={!off} onChange={(v) => toggle(id, v)} label={`启用${spec.name}`} />
      </div>
    </article>
  );
}

/**
 * 新增供应商：选一家 → 填端点与密钥。
 *
 * 密钥在这里就写进那家的 YAML —— 接入一家和给它密钥是同一件事，
 * 分两步做会留下一堆「接入了但没法用」的空壳。
 */
function AddProviderModal({ open, onClose, onAdded }: {
  open: boolean;
  onClose: () => void;
  onAdded: (id: ProviderId) => void;
}) {
  const settings = useSettings((s) => s.providers);
  const addProvider = useSettings((s) => s.addProvider);
  const setKey = useSettings((s) => s.setKey);
  const setBaseUrl = useSettings((s) => s.setBaseUrl);
  const toast = useUi((s) => s.toast);

  const avail = PROVIDERS.filter((p) => !settings[p.id]);
  const [pick, setPick] = useState<ProviderId | ''>('');
  const [url, setUrl] = useState('');
  const [key, setK] = useState('');
  const [busy, setBusy] = useState(false);

  const spec = pick ? specOf(pick) : undefined;
  // 自定义端点必须自己填；其余家留空就用默认
  const needUrl = !!spec?.userDefined;
  const ready = !!pick && (!needUrl || url.trim().length > 0);

  const close = () => { setPick(''); setUrl(''); setK(''); onClose(); };

  const submit = async () => {
    if (!pick || !ready) return;
    setBusy(true);
    try {
      addProvider(pick, url.trim() || undefined);
      if (needUrl && url.trim()) setBaseUrl(pick, url.trim());
      if (key.trim()) {
        await setKey(pick, key.trim());
        toast(`${spec?.name} 已接入`);
      } else {
        toast(`${spec?.name} 已接入。尚未填写密钥，暂时无法调用`);
      }
      const id = pick;
      close();
      onAdded(id);
    } catch (e) {
      toast(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="新增供应商"
      footer={<>
        <Button onClick={close}>取消</Button>
        <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
          <Icon name="check" />{busy ? '接入中' : '接入'}
        </Button>
      </>}>
      <div className="mo__form">
        <div className="mo__field">
          <span className="sec">选一家</span>
          {avail.length === 0 ? (
            <span className="t-cap dim">支持的几家都已经接入了。</span>
          ) : (
            <div className="chipwall">
              {avail.map((p) => (
                <ToggleChip key={p.id} on={pick === p.id}
                  onClick={() => { setPick(p.id); setUrl(p.userDefined ? '' : ''); }}
                  title={p.userDefined ? '自建网关、Ollama、公司内网代理都走这条' : p.baseUrl}>
                  {p.name}
                </ToggleChip>
              ))}
            </div>
          )}
        </div>

        {spec && (
          <>
            <div className="mo__field">
              <span className="sec">端点{needUrl ? '（必填）' : ''}</span>
              <Input value={url}
                placeholder={needUrl ? '例如 http://localhost:11434/v1' : spec.baseUrl}
                onChange={(e) => setUrl(e.target.value)} />
              <span className="t-cap dim">
                {needUrl
                  ? '自定义端点没有默认值，必须填'
                  : '留空就用默认；企业版或自建网关在这儿改'}
              </span>
            </div>

            <div className="mo__field">
              <span className="sec">密钥</span>
              <Input type="password" value={key} placeholder="sk-…"
                onChange={(e) => setK(e.target.value)} />
              <span className="t-cap dim">
                只显示尾号。
                {spec.console && <> 没有 key 就去 <a className="pcard__link" href={spec.console} target="_blank" rel="noreferrer">控制台拿 ↗</a></>}
              </span>
            </div>

          </>
        )}
      </div>
    </Modal>
  );
}

/** 模型设置 · 供应商详情：端点、密钥、模型清单 */
export function ProviderDetail({ id, onBack }: { id: ProviderId; onBack: () => void }) {
  const setting = useSettings((s) => providerSetting(s, id));
  const spec = specOf(id, setting);
  const baseUrl = useSettings((s) => baseUrlOf(s, id));
  const setKey = useSettings((s) => s.setKey);
  const clearKey = useSettings((s) => s.clearKey);
  const setBaseUrl = useSettings((s) => s.setBaseUrl);
  const removeProvider = useSettings((s) => s.removeProvider);
  const toast = useUi((s) => s.toast);
  const [draftKey, setDraftKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState(false);

  const models = setting.extraModels;

  // 移除一家 = 删那个文件，key 和模型清单跟着一起没了 —— 不会留下个没人管的 key
  const drop = () => {
    clearKey(id);
    removeProvider(id);
    toast(`已移除 ${spec.name}，密钥一起清掉了`);
    onBack();
  };

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
          {dropping ? (
            <>
              <span className="t-cap" style={{ color: 'var(--color-warning)' }}>
                {models.length
                  ? `连它下面的 ${models.length} 个模型一起删，密钥也一起清掉？`
                  : '移除它，密钥也一起清掉？'}
              </span>
              <Button onClick={() => setDropping(false)}>取消</Button>
              <Button className="tbtn--bad" onClick={drop}><Icon name="trash" />确认移除</Button>
            </>
          ) : (
            <Button onClick={() => setDropping(true)}><Icon name="trash" />移除</Button>
          )}
        </header>

        <Fields>
          <Field label="端点"
            hint={spec.userDefined ? '自定义端点必须填，否则请求发不出去' : `留空就用默认：${spec.baseUrl}`}>
            <Input value={baseUrl} placeholder={spec.userDefined ? '必填，例如 http://localhost:11434/v1' : spec.baseUrl}
              onChange={(e) => setBaseUrl(id, e.target.value)} />
          </Field>

          <Field label="密钥"
            hint={setting.hasKey ? `只显示尾号 ${setting.keyHint}` : undefined}>
            <Input type="password" value={draftKey}
              placeholder={setting.hasKey ? '重填可覆盖' : 'sk-…'}
              onChange={(e) => setDraftKey(e.target.value)} />
            <Button onClick={() => {
              if (!draftKey.trim()) { toast('先填密钥'); return; }
              setKey(id, draftKey.trim());
              setDraftKey('');
              toast(`${spec.name} 的密钥已保存`);
            }}>保存</Button>
            {setting.hasKey && (
              <Button onClick={() => { clearKey(id); toast(`已清除 ${spec.name} 的密钥`); }}>清除</Button>
            )}
          </Field>
        </Fields>
      </section>

      <section className="pcard">
        <header className="pcard__h">
          <span className="pcard__n">模型 · {models.length}</span>
          <span className="t-cap dim">照厂商文档填</span>
          <div className="spacer" />
          <Button onClick={() => setAdding(true)}><Icon name="plus" />新增模型</Button>
        </header>
        {models.length === 0 ? (
          <p className="t-cap dim" style={{ margin: 0 }}>
还没有模型。点右上角加一个，模型 id 照厂商文档填。
          </p>
        ) : (
          <div className="mtable">
            <div className="mhead">
              <span>类型</span><span>名称</span><span>模型 id</span><span>上下文</span><span>能力</span><span />
            </div>
            {models.map((m) => <ModelRow key={m.id} providerId={id} m={m} />)}
          </div>
        )}
      </section>

      <AddModelModal open={adding} providerId={id} onClose={() => setAdding(false)} />
    </>
  );
}

function ModelRow({ providerId, m }: { providerId: ProviderId; m: ModelSpec }) {
  const remove = useSettings((s) => s.removeModel);
  const toast = useUi((s) => s.toast);
  const caps = [
    m.caps.stream && '流式', m.caps.tools && '工具', m.caps.vision && '读图',
    m.caps.reasoning && '推理', m.caps.refImage && '参考图',
  ].filter(Boolean) as string[];
  return (
    <div className="mrow" title={m.note}>
      <Chip tone={TONE[m.modality]}>{MODALITY_LABEL[m.modality]}</Chip>
      <span className="mrow__n">{m.name}</span>
      <span className="mono dim mrow__id">{m.id}</span>
      <span className="mrow__ctx">{m.context ? `${Math.round(m.context / 1024)}K` : '—'}</span>
      <span className="mrow__caps">{caps.map((c) => <Chip key={c}>{c}</Chip>)}</span>
      <button className="tbtn mrow__del" title="移除这个模型"
        onClick={() => { remove(providerId, m.id); toast(`已移除 ${m.id}`); }}>
        <Icon name="trash" />
      </button>
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
  const setting = useSettings((s) => providerSetting(s, providerId));
  const spec = specOf(providerId, setting);
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

  const taken = setting.extraModels.some((m) => m.id === id.trim());

  const submit = () => {
    const mid = id.trim();
    if (!mid) { toast('模型 id 必填'); return; }
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
          <span className="t-cap dim">照厂商文档勾。勾错了不报错，但 Agent 配置页的检查会跟着错。</span>
        </div>
      </div>
    </Modal>
  );
}
