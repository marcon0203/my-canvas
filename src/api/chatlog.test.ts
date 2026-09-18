import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/domain/agent/types';
import {
  MAX_ARCHIVE, MAX_MESSAGES, archive, dropArchive, listArchive, loadLive, saveLive,
  takeArchive, titleOf, trim, type Store,
} from './chatlog';

/** 假存储：不碰真 localStorage，也能造「配额满」「存的东西坏了」这两种情况 */
function fake(opts: { full?: boolean } = {}): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.full) throw new DOMException('quota', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => { data.delete(k); },
  };
}

const msg = (id: number, who: 'me' | 'ai', text = 't'): AgentMessage => ({ id, who, text });
const session = (messages: AgentMessage[]) => ({
  messages, queue: [], planTotal: 0, brief: '', kind: '短剧' as const, agentId: 'writer' as const,
});

describe('会话存档', () => {
  let store: ReturnType<typeof fake>;
  beforeEach(() => { store = fake(); });

  it('存了能读回来，按项目分开', () => {
    saveLive('p1', session([msg(1, 'me', '做个宣传片')]), store);
    saveLive('p2', session([msg(1, 'me', '另一个项目')]), store);

    expect(loadLive('p1', store)!.messages[0]!.text).toBe('做个宣传片');
    expect(loadLive('p2', store)!.messages[0]!.text).toBe('另一个项目');
    expect(loadLive('p3', store)).toBeNull();
  });

  it('空会话不占地方 —— 新建项目后什么都没说是最常见的情况', () => {
    saveLive('p1', session([msg(1, 'me', 'x')]), store);
    expect(store.data.size).toBe(1);
    saveLive('p1', session([]), store);
    expect(loadLive('p1', store)).toBeNull();
    expect(store.data.size).toBe(0);
  });

  it('消息超上限只留最近的 —— 不设上限会把本地存储配额撑爆', () => {
    const many = Array.from({ length: MAX_MESSAGES + 50 }, (_, i) => msg(i, 'ai', `第${i}条`));
    expect(trim(many)).toHaveLength(MAX_MESSAGES);
    expect(trim(many)[0]!.text).toBe(`第50条`);
    expect(trim(many).at(-1)!.text).toBe(`第${MAX_MESSAGES + 49}条`);
  });

  it('配额满时不炸 —— 记录丢了可以接受，把界面搞崩不行', () => {
    const full = fake({ full: true });
    expect(() => saveLive('p1', session([msg(1, 'me', 'x')]), full)).not.toThrow();
    expect(loadLive('p1', full)).toBeNull();
  });

  it('存的东西坏了当成没有，不让面板崩', () => {
    store.data.set('studio.chat.live.p1', '{不是合法 JSON');
    expect(loadLive('p1', store)).toBeNull();
    store.data.set('studio.chat.archive.p1', 'xxx');
    expect(listArchive('p1', store)).toEqual([]);
  });

  it('没有项目 id 时什么都不做 —— 首页没有项目可归属', () => {
    saveLive('', session([msg(1, 'me', 'x')]), store);
    expect(store.data.size).toBe(0);
    expect(listArchive('', store)).toEqual([]);
  });
});

describe('存档列表', () => {
  let store: ReturnType<typeof fake>;
  beforeEach(() => { store = fake(); });

  it('新的排前面', () => {
    archive('p1', session([msg(1, 'me', '第一条会话')]), store);
    archive('p1', session([msg(2, 'me', '第二条会话')]), store);
    expect(listArchive('p1', store).map((s) => s.title)).toEqual(['第二条会话', '第一条会话']);
  });

  it('空会话不存 —— 否则点一下「新会话」就多一条空记录', () => {
    archive('p1', session([]), store);
    expect(listArchive('p1', store)).toEqual([]);
  });

  it('超过上限把最旧的挤掉', () => {
    for (let i = 0; i < MAX_ARCHIVE + 5; i++) {
      archive('p1', session([msg(i, 'me', `会话${i}`)]), store);
    }
    const all = listArchive('p1', store);
    expect(all).toHaveLength(MAX_ARCHIVE);
    expect(all[0]!.title).toBe(`会话${MAX_ARCHIVE + 4}`);
  });

  it('取出一份就从列表里移掉 —— 恢复之后它是当前会话，不该同时还在历史里', () => {
    archive('p1', session([msg(1, 'me', 'A')]), store);
    archive('p1', session([msg(2, 'me', 'B')]), store);
    const id = listArchive('p1', store).find((s) => s.title === 'A')!.id;

    const { session: got, rest } = takeArchive('p1', id, store);
    expect(got!.title).toBe('A');
    expect(rest.map((s) => s.title)).toEqual(['B']);
    expect(listArchive('p1', store).map((s) => s.title)).toEqual(['B']);
  });

  it('取一个不存在的 id 不动列表', () => {
    archive('p1', session([msg(1, 'me', 'A')]), store);
    const { session: got } = takeArchive('p1', '不存在', store);
    expect(got).toBeUndefined();
    expect(listArchive('p1', store)).toHaveLength(1);
  });

  it('能删掉某一条', () => {
    archive('p1', session([msg(1, 'me', 'A')]), store);
    const id = listArchive('p1', store)[0]!.id;
    expect(dropArchive('p1', id, store)).toEqual([]);
  });
});

describe('存档标题', () => {
  it('取第一句用户说的话', () => {
    expect(titleOf({ messages: [msg(1, 'ai', '我先说的'), msg(2, 'me', '我要做个宣传片')], brief: '' }))
      .toBe('我要做个宣传片');
  });

  it('太长就截断', () => {
    const long = '做一支洗发水的宣传片，重点是洗完第二天头发还蓬松，不要油';
    expect(titleOf({ messages: [msg(1, 'me', long)], brief: '' })).toBe(`${long.slice(0, 24)}…`);
  });

  it('用户一句话都没说时用那条需求', () => {
    expect(titleOf({ messages: [msg(1, 'ai', 'x')], brief: '做个 MV' })).toBe('做个 MV');
  });

  it('什么都没有时也给个能认的名字，不是空白', () => {
    expect(titleOf({ messages: [], brief: '' })).toBe('没说话的一次');
  });
});
