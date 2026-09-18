// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@/api/desktop';

/**
 * 写剧本 / 提取资产 / 拆镜头这三条真模型链路的**前端那半**。
 *
 * Rust 那半（提示词怎么拼、产物怎么收拾）在各自模块里测过了。这儿测的是
 * 「程序兜底」的部分 —— 那些刻意不让模型碰的东西：
 *
 * - 正文块的 id、资产的 aid、镜头的镜号，全由程序分配
 * - Rust 侧核对时丢掉的条数（dropped）要如实上到产物卡，不能悄悄消失
 * - 正文里的结构标记（`**场景3**`）用 Rust 拼好那份，前端不再实现一遍
 */

let script: RunEvent[] = [];

vi.mock('@/api/desktop', async (orig) => {
  const real = await orig<typeof import('@/api/desktop')>();
  const run = async (_a: unknown, onEvent: (e: RunEvent) => void) => {
    for (const e of script) onEvent(e);
  };
  return { ...real, isDesktop: () => true, scriptDraft: run, assetsExtract: run, shotsGenerate: run };
});

const { useAgent } = await import('./agent');
const { useProject } = await import('./project');
const { useUi } = await import('./ui');
const { MOCK_PROJECTS } = await import('@/mock/project');
const { MOCK_CONFIG } = await import('@/mock/config');

async function settle(): Promise<void> {
  for (let i = 0; i < 400 && useAgent.getState().runningId !== null; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

const lastAi = () => [...useAgent.getState().messages].reverse().find((m) => m.who === 'ai')!;

beforeEach(() => {
  const t = useProject.temporal.getState();
  t.pause();
  useProject.getState().hydrate({
    project: structuredClone(MOCK_PROJECTS['p1']!),
    config: structuredClone(MOCK_CONFIG),
  });
  t.clear();
  t.resume();
  useUi.setState({ step: 'outline' });
  useAgent.getState().reset();
});

/** 跑一轮并把产物卡拿出来 */
async function run(input: string, kind: string) {
  useAgent.getState().send(input, kind as never);
  await settle();
  return lastAi();
}

describe('写剧本', () => {
  it('正文用 Rust 拼好那份，块 id 由前端分配', async () => {
    const body = '# 失衡\n\n**场景3**\n旧公寓客厅 · 深夜\n\n他推开门。\n';
    script = [
      { t: 'step', index: 1 },
      { t: 'delta', text: '这一场接着上一场的钞票往下走。' },
      { t: 'script', draft: { reply: 'x', place: '旧公寓客厅', time: '深夜', lines: ['他推开门。'] }, body },
      { t: 'done' },
    ];
    const m = await run('写这一场', 'script.draft');
    const p = m.proposal!;
    expect(p.patch.t).toBe('blocks');
    const blocks = (p.patch as { t: 'blocks'; blocks: { id: string; body: string }[] }).blocks;
    // **正文原样用 Rust 那份** —— 结构标记不在前端拼第二遍
    expect(blocks[0]!.body).toBe(body);
    expect(blocks[0]!.id, '块 id 由程序分配').toMatch(/^bk\d+$/);
    // 已有的块 id 不能撞
    const used = new Set(useProject.getState().blocks.map((b) => b.id));
    expect(used.has(blocks[0]!.id)).toBe(false);
  });

  it('产物卡上摆出地点时间和前几行 —— 采纳前要看得见写了什么', async () => {
    script = [
      { t: 'step', index: 1 },
      { t: 'script', draft: { reply: 'x', place: '客厅', time: '深夜', lines: ['甲', '乙', '丙'] }, body: 'b' },
      { t: 'done' },
    ];
    const rows = (await run('写这一场', 'script.draft')).proposal!.rows;
    const flat = rows.map((r) => `${r.k}=${r.v}`).join('|');
    expect(flat).toContain('客厅 · 深夜');
    expect(flat).toContain('3 行');
    expect(flat).toContain('甲');
  });
});

describe('提取资产', () => {
  /**
   * **aid 由前端编号，不让模型碰。** 模型编号会重复、会和库里已有的撞，
   * 而撞号的后果是分镜引用到另一个资产上 —— 那种错很难看出来。
   */
  it('aid 接着库里已有的编，不撞号', async () => {
    const before = [
      ...useProject.getState().assets.角色,
      ...useProject.getState().assets.场景,
      ...useProject.getState().assets.道具,
    ].map((a) => a.aid);

    script = [
      { t: 'step', index: 1 },
      {
        t: 'assets',
        draft: {
          reply: 'x',
          assets: [
            { group: '角色', name: '王姐', desc: '四十岁女性，短发' },
            { group: '角色', name: '老陈', desc: '六十岁男性，驼背' },
            { group: '道具', name: '铜钥匙', desc: '磨亮的铜色，齿口有缺' },
          ],
        },
      },
      { t: 'done' },
    ];
    const p = (await run('提取资产', 'assets.extract')).proposal!;
    const add = (p.patch as { t: 'assets'; add: { group: string; asset: { aid: string; name: string; desc: string } }[] }).add;

    expect(add).toHaveLength(3);
    const aids = add.map((x) => x.asset.aid);
    expect(new Set(aids).size, '新建的之间不能撞').toBe(3);
    for (const a of aids) expect(before, '不能和库里已有的撞').not.toContain(a);
    // 分组各自一套号
    expect(add[0]!.asset.aid).toMatch(/^CHAR-\d{3}$/);
    expect(add[2]!.asset.aid).toMatch(/^PROP-\d{3}$/);
    // 描述原样带过来 —— 它会进出图提示词
    expect(add[0]!.asset.desc).toBe('四十岁女性，短发');
  });

  it('分组不认识的整条丢掉，不猜一个默认分组', async () => {
    script = [
      { t: 'step', index: 1 },
      {
        t: 'assets',
        draft: {
          reply: 'x',
          assets: [
            { group: '角色', name: '王姐', desc: '四十岁' },
            { group: '人物', name: '老陈', desc: '六十岁' },
          ],
        },
      },
      { t: 'done' },
    ];
    const p = (await run('提取资产', 'assets.extract')).proposal!;
    const add = (p.patch as { t: 'assets'; add: unknown[] }).add;
    expect(add).toHaveLength(1);
  });
});

describe('拆镜头', () => {
  /** 镜号由前端分配，不能和已有的撞 */
  it('镜号接着已有的编，景别与时长照模型给的', async () => {
    const before = useProject.getState().shots.map((s) => s.id);
    script = [
      { t: 'step', index: 1 },
      {
        t: 'shots',
        draft: {
          reply: 'x',
          shots: [
            { sceneKey: '场景1', size: '全景', desc: '他推开门，屋里没人', dur: 5 },
            { sceneKey: '场景1', size: '近景', desc: '桌上那杯水还温着', dur: 3 },
          ],
        },
        dropped: 0,
      },
      { t: 'done' },
    ];
    const p = (await run('拆镜', 'shots.generate')).proposal!;
    const shots = (p.patch as { t: 'shots'; shots: { id: string; size: string; dur: number; desc: string; refs: string[] }[] }).shots;

    expect(shots).toHaveLength(2);
    expect(new Set(shots.map((s) => s.id)).size).toBe(2);
    for (const s of shots) expect(before).not.toContain(s.id);
    expect(shots[0]!.size).toBe('全景');
    expect(shots[0]!.dur).toBe(5);
    expect(shots[0]!.desc).toBe('他推开门，屋里没人');
  });

  /** 全景交代环境不挂人；近了才把人挂上 —— 引用错了提示词就写歪 */
  it('远景只挂场景，近景把人也挂上', async () => {
    script = [
      { t: 'step', index: 1 },
      {
        t: 'shots',
        draft: {
          reply: 'x',
          shots: [
            { sceneKey: '场景1', size: '全景', desc: '甲', dur: 4 },
            { sceneKey: '场景1', size: '近景', desc: '乙', dur: 3 },
          ],
        },
        dropped: 0,
      },
      { t: 'done' },
    ];
    const p = (await run('拆镜', 'shots.generate')).proposal!;
    const shots = (p.patch as { t: 'shots'; shots: { refs: string[] }[] }).shots;
    expect(shots[1]!.refs.length).toBeGreaterThanOrEqual(shots[0]!.refs.length);
  });

  /**
   * **丢掉的条数要如实上到产物卡。**
   *
   * Rust 侧核对时会把模型编的场次键、不认识的景别整条丢掉。悄悄消失的话，
   * 「20 镜里收了 17 镜」看起来像模型只给了 17 镜 —— 而那是两件事：
   * 后者说明提示词要改，前者说明模型没照约束来。
   */
  it('丢了几条如实写在产物卡上，并说清为什么', async () => {
    script = [
      { t: 'step', index: 1 },
      {
        t: 'shots',
        draft: { reply: 'x', shots: [{ sceneKey: '场景1', size: '全景', desc: '甲', dur: 4 }] },
        dropped: 3,
      },
      { t: 'done' },
    ];
    const p = (await run('拆镜', 'shots.generate')).proposal!;
    expect(p.title).toContain('丢了 3 条');
    const flat = p.rows.map((r) => `${r.k}=${r.v}`).join('|');
    expect(flat, '要说清丢的原因').toContain('场次键');
  });

  it('一条都没丢时标题上不提这件事', async () => {
    script = [
      { t: 'step', index: 1 },
      {
        t: 'shots',
        draft: { reply: 'x', shots: [{ sceneKey: '场景1', size: '全景', desc: '甲', dur: 4 }] },
        dropped: 0,
      },
      { t: 'done' },
    ];
    const p = (await run('拆镜', 'shots.generate')).proposal!;
    expect(p.title).not.toContain('丢');
  });
});

/**
 * **桌面端这几步必须走真模型，不能悄悄回落到本地模板。**
 *
 * 这条是这次改动的守卫。本地那版（`domain/agent/drafts.ts`）在界面上和真模型
 * 完全同构 —— 步骤卡会走、正文会流式、产物卡会出来。所以「有没有走真模型」
 * 在界面上看不出来，只能靠这条钉住：分派表里漏掉一条，它就回落，而没人会发现。
 */
describe('桌面端不回落到本地模板', () => {
  /** 真链路的产物是 Rust 事件里那份；本地模板那版内容完全不同，据此分辨 */
  const REAL = '这一行只有真链路会出现';

  it('写剧本走的是 IPC 那条，不是本地模板', async () => {
    script = [
      { t: 'step', index: 1 },
      { t: 'script', draft: { reply: 'x', place: 'p', time: 't', lines: [REAL] }, body: REAL },
      { t: 'done' },
    ];
    const m = await run('写这一场', 'script.draft');
    const blocks = (m.proposal!.patch as { t: 'blocks'; blocks: { body: string }[] }).blocks;
    expect(blocks[0]!.body, '回落到本地模板了').toBe(REAL);
  });

  it('提取资产走的是 IPC 那条', async () => {
    script = [
      { t: 'step', index: 1 },
      { t: 'assets', draft: { reply: 'x', assets: [{ group: '角色', name: REAL, desc: 'd' }] } },
      { t: 'done' },
    ];
    const m = await run('提取资产', 'assets.extract');
    const add = (m.proposal!.patch as { t: 'assets'; add: { asset: { name: string } }[] }).add;
    expect(add[0]!.asset.name, '回落到本地模板了').toBe(REAL);
  });

  it('拆镜头走的是 IPC 那条', async () => {
    script = [
      { t: 'step', index: 1 },
      {
        t: 'shots',
        draft: { reply: 'x', shots: [{ sceneKey: '场景1', size: '特写', desc: REAL, dur: 7 }] },
        dropped: 0,
      },
      { t: 'done' },
    ];
    const m = await run('拆镜', 'shots.generate');
    const shots = (m.proposal!.patch as { t: 'shots'; shots: { desc: string; dur: number }[] }).shots;
    expect(shots[0]!.desc, '回落到本地模板了').toBe(REAL);
    // 本地那版是固定 4/3/3 秒；真链路照模型给的
    expect(shots[0]!.dur).toBe(7);
  });
});
