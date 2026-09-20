// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProvListing, ProvPatch, ProvView } from '@/api/desktop';

/**
 * 供应商配置的真相在磁盘上：一家一个 `<workspace>/providers/<id>.yaml`。
 * store 里那份是它的投影。
 *
 * 这一组盯两件事：
 * 1. **改一项只送那一项**。Rust 侧是读改写 —— 送多了就会把磁盘上没让你动的
 *    东西盖掉。真实症状是「我改了个地址，key 没了」。
 * 2. **读回来的那份能正确投影**，尤其 hasKey：它喂着「哪家能用」，
 *    不对的话明明配好的模型会被当成没配。
 */

/** 每个用例自己摆这次 list 返回什么 */
let listing: ProvListing | null = { items: [], bad: [] };
/** 收到过的写请求 */
const saves: { id: string; patch: ProvPatch }[] = [];
const removes: string[] = [];

vi.mock('@/api/desktop', async (orig) => ({
  ...(await orig<typeof import('@/api/desktop')>()),
  provs: {
    list: vi.fn(async () => listing),
    save: vi.fn(async (id: string, patch: ProvPatch) => {
      saves.push({ id, patch });
      return null;
    }),
    remove: vi.fn(async (id: string) => { removes.push(id); }),
  },
}));

const { useSettings, addedProviders, readyProviders } = await import('./settings');
const { makeModel } = await import('@/domain/providers/model');
const { isBuiltinProvider, specOf } = await import('@/domain/providers/catalog');

const view = (over: Partial<ProvView>): ProvView => ({
  id: 'deepseek', enabled: true, hasKey: false,
  text: [], image: [], video: [], audio: [],
  ...over,
});

beforeEach(() => {
  saves.length = 0;
  removes.length = 0;
  listing = { items: [], bad: [] };
  useSettings.setState({ providers: {}, badProviders: [], workspace: '' });
});

const last = () => saves.at(-1)!;

describe('改一项只送那一项', () => {
  it('改端点不带上 key 和模型清单', () => {
    useSettings.getState().setBaseUrl('deepseek', ' https://gw.internal ');
    expect(last()).toEqual({ id: 'deepseek', patch: { baseUrl: 'https://gw.internal' } });
    // 送多了就会把磁盘上的 key 盖掉 —— 这是这条测试的全部意义
    expect('apikey' in last().patch).toBe(false);
    expect('text' in last().patch).toBe(false);
  });

  it('端点清空送空串 —— Rust 侧的意思是「用回内置默认」', () => {
    useSettings.getState().setBaseUrl('deepseek', '   ');
    expect(last().patch).toEqual({ baseUrl: '' });
    expect(useSettings.getState().providers.deepseek?.baseUrl).toBeUndefined();
  });

  it('填 key 只送 key，界面上立刻显示尾号', () => {
    useSettings.getState().setKey('deepseek', 'sk-1234567890ab');
    expect(last()).toEqual({ id: 'deepseek', patch: { apikey: 'sk-1234567890ab' } });
    const p = useSettings.getState().providers.deepseek!;
    expect(p.hasKey).toBe(true);
    expect(p.keyHint).toBe('••••90ab');
  });

  it('删 key 送空串，不是删整家', () => {
    useSettings.getState().setKey('deepseek', 'sk-1234567890ab');
    useSettings.getState().clearKey('deepseek');
    expect(last().patch).toEqual({ apikey: '' });
    expect(removes, '清 key 不该去删文件').toEqual([]);
    expect(useSettings.getState().providers.deepseek?.hasKey).toBe(false);
  });

  it('停用只送 enabled，key 留着', () => {
    useSettings.getState().setKey('deepseek', 'sk-1234567890ab');
    useSettings.getState().toggleProvider('deepseek', false);
    expect(last().patch).toEqual({ enabled: false });
    expect(useSettings.getState().providers.deepseek?.hasKey, '停用不是删 key').toBe(true);
  });

  it('加模型只送它那一类的整组', () => {
    const t = makeModel({ provider: 'deepseek', id: 'deepseek-chat', modality: 'text', caps: { tools: true } });
    const i = makeModel({ provider: 'deepseek', id: 'img-1', modality: 'image', caps: { refImage: true } });
    useSettings.getState().addModel('deepseek', t);
    expect(last().patch).toEqual({ text: [{ id: 'deepseek-chat', caps: ['tools'] }] });

    useSettings.getState().addModel('deepseek', i);
    // 只送 image 这一组 —— text 那组不在 patch 里，磁盘上原样不动
    expect(Object.keys(last().patch)).toEqual(['image']);
    expect(last().patch.image).toEqual([{ id: 'img-1', caps: ['refImage'] }]);
  });

  it('删模型送删完之后那一组，另一类不动', () => {
    const a = makeModel({ provider: 'deepseek', id: 'a', modality: 'text', caps: {} });
    const b = makeModel({ provider: 'deepseek', id: 'b', modality: 'text', caps: {} });
    const i = makeModel({ provider: 'deepseek', id: 'i', modality: 'image', caps: {} });
    for (const m of [a, b, i]) useSettings.getState().addModel('deepseek', m);

    useSettings.getState().removeModel('deepseek', 'a');
    expect(Object.keys(last().patch)).toEqual(['text']);
    expect(last().patch.text?.map((y) => y.id)).toEqual(['b']);
  });

  it('同一个模型 id 加两次不重复，也不白写一次文件', () => {
    const m = makeModel({ provider: 'deepseek', id: 'm1', modality: 'text', caps: {} });
    useSettings.getState().addModel('deepseek', m);
    const n = saves.length;
    useSettings.getState().addModel('deepseek', m);
    expect(saves.length, '第二次不该再写').toBe(n);
    expect(useSettings.getState().providers.deepseek?.extraModels).toHaveLength(1);
  });

  it('删一家就是删那个文件', () => {
    useSettings.getState().addProvider('deepseek');
    useSettings.getState().removeProvider('deepseek');
    expect(removes).toEqual(['deepseek']);
    expect(useSettings.getState().providers.deepseek).toBeUndefined();
  });

  it('接入过的一家再接一次不覆盖用户填的东西', () => {
    useSettings.getState().addProvider('deepseek', 'https://mine');
    useSettings.getState().setKey('deepseek', 'sk-1234567890ab');
    const n = saves.length;
    useSettings.getState().addProvider('deepseek', 'https://别的');
    expect(saves.length, '已经接入过就该直接返回').toBe(n);
    expect(useSettings.getState().providers.deepseek?.baseUrl).toBe('https://mine');
  });
});

describe('从磁盘读回来', () => {
  it('投影出端点、key 状态、停用、模型清单', async () => {
    listing = {
      items: [view({
        id: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        hasKey: true,
        keyHint: '••••90ab',
        text: [{ id: 'deepseek-chat', context: 65536, caps: ['tools'] }],
      })],
      bad: [],
    };
    await useSettings.getState().syncProviders();

    const p = useSettings.getState().providers.deepseek!;
    expect(p.baseUrl).toBe('https://api.deepseek.com');
    expect(p.hasKey).toBe(true);
    expect(p.keyHint).toBe('••••90ab');
    expect(p.disabled).toBeUndefined();
    expect(p.extraModels).toHaveLength(1);
    expect(p.extraModels[0]).toMatchObject({
      id: 'deepseek-chat', modality: 'text', protocol: 'openai-chat', context: 65536,
    });
  });

  it('停用的那家投影成 disabled', async () => {
    listing = { items: [view({ enabled: false })], bad: [] };
    await useSettings.getState().syncProviders();
    expect(useSettings.getState().providers.deepseek?.disabled).toBe(true);
  });

  /**
   * **读回来是覆盖，不是合并。**
   *
   * 磁盘上删掉一个文件之后再打开设置，那一家就该消失。合并的话它会一直留着，
   * 而点进去是个没有 key 的空壳 —— 人会以为程序坏了。
   */
  it('磁盘上没有的那家会从 store 里消失', async () => {
    useSettings.getState().addProvider('moonshot');
    listing = { items: [view({ id: 'deepseek' })], bad: [] };
    await useSettings.getState().syncProviders();

    expect(useSettings.getState().providers.deepseek).toBeTruthy();
    expect(useSettings.getState().providers.moonshot).toBeUndefined();
  });

  /**
   * 一份写坏的 YAML 不该让设置页打不开 —— 手写时缩进差一格是常事。
   * 坏的那几家单独留着，界面上如实说是哪个文件。
   */
  it('写坏的那份单独报出来，好的照常投影', async () => {
    listing = {
      items: [view({ id: 'deepseek' })],
      bad: [['moonshot', 'moonshot.yaml 格式不对：缩进错了']],
    };
    await useSettings.getState().syncProviders();

    expect(useSettings.getState().providers.deepseek).toBeTruthy();
    expect(useSettings.getState().badProviders).toEqual([
      ['moonshot', 'moonshot.yaml 格式不对：缩进错了'],
    ]);
  });

  /**
   * 丢一份 YAML 进去就是新接一家 —— 这本来就是「一家一个 YAML」的意思。
   *
   * 原来这儿是跳过：界面遍历的是内置目录、`providerOf(id)!` 是非空断言，
   * 收进来会让详情页拿到 undefined 然后崩。于是用户丢进去的文件不生效，
   * 而且**没有任何反馈**。现在界面走 specOf，自建的照 YAML 显示。
   */
  it('内置目录里没有的 id 也收进来，名字与端点照 YAML 里写的', async () => {
    listing = {
      items: [view({ id: 'myvendor', name: '我自己那家', baseUrl: 'https://api.mine.test/v1' })],
      bad: [],
    };
    await useSettings.getState().syncProviders();
    const p = useSettings.getState().providers.myvendor;
    expect(p, '自建的那家该收进来').toBeTruthy();
    expect(p!.name).toBe('我自己那家');
    expect(p!.baseUrl).toBe('https://api.mine.test/v1');
    expect(addedProviders(useSettings.getState())).toContain('myvendor');
    // 界面查得到它，且标成自建
    expect(isBuiltinProvider('myvendor')).toBe(false);
    expect(specOf('myvendor', p).name).toBe('我自己那家');
    expect(specOf('myvendor', p).userDefined).toBe(true);
  });

  it('自建的没写名字就用 id —— 不替用户编一个', async () => {
    listing = { items: [view({ id: 'myvendor', baseUrl: 'https://x.test/v1' })], bad: [] };
    await useSettings.getState().syncProviders();
    expect(specOf('myvendor', useSettings.getState().providers.myvendor).name).toBe('myvendor');
  });

  it('自建的没写 baseUrl 就不算可用 —— 没有端点发不出请求', async () => {
    listing = { items: [view({ id: 'myvendor', hasKey: true })], bad: [] };
    await useSettings.getState().syncProviders();
    expect(readyProviders(useSettings.getState())).not.toContain('myvendor');

    listing = {
      items: [view({ id: 'myvendor', hasKey: true, baseUrl: 'https://x.test/v1' })],
      bad: [],
    };
    await useSettings.getState().syncProviders();
    expect(readyProviders(useSettings.getState())).toContain('myvendor');
  });

  it('浏览器里没有那些文件，本地那份不该被清空', async () => {
    useSettings.getState().setKey('deepseek', 'sk-1234567890ab');
    listing = null;                       // provs.list 在浏览器里返回 null
    await useSettings.getState().syncProviders();
    expect(useSettings.getState().providers.deepseek?.hasKey, '不该被一个空结果冲掉').toBe(true);
  });
});
