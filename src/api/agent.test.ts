import { describe, expect, it } from 'vitest';
import { MOCK_PROJECT } from '@/mock/project';
import { defaultRig } from '@/domain/assets/model';
import { defaultConfigs } from '@/domain/agent/config';
import type { AgentContext } from '@/domain/agent/context';
import { allBeats, actOfBeat } from '@/domain/story/model';
import { plan } from '@/domain/agent/plans';
import {
  altsProposal, expandInput, failureText, promptProposal, selectedBeat, shotBriefs,
} from './agent';

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  const p = structuredClone(MOCK_PROJECT);
  for (const group of Object.values(p.assets)) {
    for (const a of group) for (const v of a.views) v.rig ??= defaultRig(v.name);
  }
  for (const s of p.shots) s.rig ??= defaultRig(s.size);
  return {
    proj: p.proj, projectId: 'test-proj', style: p.style, stylePrompt: p.stylePrompt, styles: p.styles,
    ratio: p.ratio, credits: p.credits, budget: p.budget,
    acts: p.acts, blocks: p.blocks, assets: p.assets, shots: p.shots,
    sel: { step: 'storyboard', beatId: 'b3', assetId: 'c1', shotId: 's1-1', blockId: null },
    input: '', agentId: 'dp', agents: defaultConfigs(), globalModels: {},
    ...over,
  };
}

describe('api/agent · 补写提示词送给模型的简报', () => {
  it('引用展开成「名字：描述」—— Rust 侧不认识资产库', () => {
    const c = ctx();
    const shot = c.shots.find((s) => s.refs.length > 0)!;
    const [brief] = shotBriefs(c, [shot]);
    expect(brief!.refs.length).toBe(shot.refs.length);
    // 送过去的不是 aid，而是人能读、模型能用的描述
    for (const r of brief!.refs) {
      expect(shot.refs.some((aid) => r.includes(aid))).toBe(false);
      expect(r).toContain('：');
    }
  });

  it('景别带上词表里的英文术语，不让模型自己翻', () => {
    const c = ctx();
    const shot = { ...c.shots[0]!, size: '特写' as const };
    expect(shotBriefs(c, [shot])[0]!.sizeEn).toBe('extreme close-up');
  });

  it('遇到词表外的景别回落到 medium shot，而不是送个 undefined 过去', () => {
    const c = ctx();
    const shot = { ...c.shots[0]!, size: '斜四十五度' as unknown as (typeof c.shots)[0]['size'] };
    expect(shotBriefs(c, [shot])[0]!.sizeEn).toBe('medium shot');
  });
});

describe('api/agent · 提示词产物卡', () => {
  const draft = (n: number) => ({
    reply: 'x',
    prompts: Array.from({ length: n }, (_, i) => ({ id: `s1-${i + 1}`, own: `full shot ${i}` })),
  });

  it('全补齐时标题只报镜数', () => {
    expect(promptProposal(draft(3), 3).title).toBe('补写提示词 · 3 镜');
  });

  it('模型漏写时标题如实报 n/总数，不假装全补上了', () => {
    expect(promptProposal(draft(2), 5).title).toBe('补写提示词 · 2/5 镜');
  });

  it('产物是 shotPrompts 补丁，采纳后直接落回分镜', () => {
    const p = promptProposal(draft(2), 2);
    expect(p.patch.t).toBe('shotPrompts');
    expect(p.patch.t === 'shotPrompts' && p.patch.edits.map((e) => e.id)).toEqual(['s1-1', 's1-2']);
    expect(p.goto).toBe('storyboard');
  });
});

describe('api/agent · 延展走向送给模型的上下文', () => {
  const c = () => ctx({ agentId: 'writer', sel: {
    step: 'outline', beatId: 'b3', assetId: 'c1', shotId: 's1-1', blockId: null,
  } });

  it('这一场、所在幕都送过去', () => {
    const cc = c();
    const beat = allBeats(cc.acts).find((b) => b.id === 'b3')!;
    const act = actOfBeat(cc.acts, 'b3')!;
    const i = expandInput(cc, 'b3');
    expect(i.beatKey).toBe(beat.k);
    expect(i.beatT).toBe(beat.t);
    expect(i.actTitle).toBe(act.t);
    expect(i.actSpan).toBe(act.span);
  });

  /**
   * 这条是整件事的要点。上一版只把这一场的标题套进三个固定句式，
   * 三条走向和项目里别的东西完全无关。前后场次不送过去的话，
   * 模型给的三条同样接不上后面，等于换了个更贵的模板。
   */
  it('前后各两场跟着送 —— 走向要接得上已经定了的那几场', () => {
    const cc = c();
    const beats = allBeats(cc.acts);
    const at = beats.findIndex((b) => b.id === 'b3');
    const i = expandInput(cc, 'b3');

    expect(i.before.map((b) => b.k)).toEqual(beats.slice(at - 2, at).map((b) => b.k));
    expect(i.after.map((b) => b.k)).toEqual(beats.slice(at + 1, at + 3).map((b) => b.k));
    // 送的是功能，不是正文
    for (const b of [...i.before, ...i.after]) expect(b.t.length).toBeGreaterThan(0);
  });

  it('第一场没有前文、最后一场没有后文 —— 不报错，送空数组', () => {
    const cc = c();
    const beats = allBeats(cc.acts);
    const first = expandInput(cc, beats[0]!.id);
    expect(first.before).toEqual([]);
    expect(first.after.length).toBeGreaterThan(0);

    const last = expandInput(cc, beats[beats.length - 1]!.id);
    expect(last.after).toEqual([]);
    expect(last.before.length).toBeGreaterThan(0);
  });

  it('只送定稿的角色 —— 草稿资产随时会改，围着它写走向没意义', () => {
    const cc = c();
    const locked = cc.assets.角色.filter((a) => a.status === 'locked');
    const draft = cc.assets.角色.filter((a) => a.status !== 'locked');
    expect(locked.length, '样例项目里得有定稿角色，否则这条测试什么都没验').toBeGreaterThan(0);

    const i = expandInput(cc, 'b3');
    expect(i.leads).toHaveLength(locked.length);
    for (const a of locked) expect(i.leads.some((l) => l.startsWith(`${a.name}：`))).toBe(true);
    for (const a of draft) expect(i.leads.some((l) => l.startsWith(`${a.name}：`))).toBe(false);
  });

  it('用户那句话原样带上，不在这儿加工', () => {
    expect(expandInput(ctx({ input: '要更黑暗一点' }), 'b3').idea).toBe('要更黑暗一点');
    expect(expandInput(ctx({ input: '' }), 'b3').idea).toBe('');
  });

  it('选中的那一场不存在时取第一场；一场都没有时返回 undefined，由本地那条路去说前置条件', () => {
    // beatId 是必填的，但它可能指着一个已经被删掉的场次
    const none = ctx({ sel: {
      step: 'outline', beatId: '早就删了', assetId: 'c1', shotId: 's1-1', blockId: null,
    } });
    expect(selectedBeat(none)?.id).toBe(allBeats(none.acts)[0]!.id);
    expect(selectedBeat(ctx({ acts: [] }))).toBeUndefined();
  });
});

describe('api/agent · 延展走向的产物卡', () => {
  it('几条就写几条，不写死 3 —— Rust 可能收拾掉重复的', () => {
    const p = altsProposal({ reply: 'x', alts: ['甲', '乙'] }, { id: 'b3', k: '场景3' });
    expect(p.title).toBe('场景3 · 2 条备选走向');
    expect(p.rows).toEqual([{ k: '走向 1', v: '甲' }, { k: '走向 2', v: '乙' }]);
    expect(p.patch).toEqual({ t: 'alts', beatId: 'b3', alts: ['甲', '乙'] });
    expect(p.goto).toBe('outline');
  });

  it('消耗与本地那条路一致 —— 同一件事两条路记不同的账，对不上', () => {
    const local = plan('outline.expand', ctx({ agentId: 'writer' })).proposal!;
    const remote = altsProposal({ reply: 'x', alts: ['甲', '乙', '丙'] }, { id: 'b3', k: '场景3' });
    expect(remote.cost).toBe(local.cost);
  });
});

describe('api/agent · 失败给人话', () => {
  it('不重复 message 已经说过的事 —— 那会叠成一句自相矛盾的长话', () => {
    // 真实场景：供应商 400 说「思考模式不支持这个 tool_choice」。
    // 旧版会输出「模型没按要求的结构返回，重试几次都没成：模型返回无法解析：…」
    // —— 两层前缀叠起来，而且第一句还是错的（不是模型不听话）
    const msg = '请求失败：CompletionError: ProviderResponseError: status 400';
    const out = failureText('http', msg);
    expect(out.startsWith(msg), out).toBe(true);
    expect(out).not.toContain('模型没按要求的结构返回');
    // 只补下一步
    expect(out).toContain('核对模型名和密钥');
  });

  it('每种码都只补一句「接下来干什么」', () => {
    for (const [code, must] of [
      ['no_key', '模型设置'],
      ['no_model', '智能体管理'],
      ['no_base_url', 'baseURL'],
      ['decode', '换一个支持工具调用的模型'],
    ] as const) {
      const out = failureText(code, 'X');
      expect(out.startsWith('X。'), `${code}: ${out}`).toBe(true);
      expect(out, code).toContain(must);
    }
  });

  it('不认识的码原样给出，不编一句安慰', () => {
    expect(failureText('某个新码', '出了点问题')).toBe('出了点问题');
  });
});
