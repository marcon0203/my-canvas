import { describe, expect, it } from 'vitest';
import { KINDS, detectKind, nameFromBrief, pipelineFor, skippedFor } from './pipeline';
import { INTENT_META } from './roster';

describe('agent/pipeline · 需求 → 执行计划', () => {
  it('每个类型的每一步都是真实存在的活儿', () => {
    for (const k of KINDS) {
      for (const s of pipelineFor(k)) {
        expect(INTENT_META[s.kind], `${k}/${s.kind}`).toBeDefined();
        expect(s.why.length).toBeGreaterThan(4);
      }
    }
  });

  it('主干顺序是结构 → 文字 → 资产 → 分镜 → 提示词 → 视频 → 成片', () => {
    expect(pipelineFor('短剧').map((s) => s.kind)).toEqual([
      'outline.draft', 'script.draft', 'assets.extract',
      'shots.generate', 'shots.prompt', 'video.batch', 'edit.autocut',
    ]);
  });

  it('MV 跳过写正文，并说得出为什么', () => {
    expect(pipelineFor('MV').map((s) => s.kind)).not.toContain('script.draft');
    const sk = skippedFor('MV');
    expect(sk).toHaveLength(1);
    expect(sk[0]!.why).toContain('对白');
  });

  it('其余类型不乱编差异 —— 跳过表为空就是走全套', () => {
    for (const k of ['短剧', '广告', '动画'] as const) {
      expect(skippedFor(k)).toEqual([]);
      expect(pipelineFor(k)).toHaveLength(7);
    }
  });

  it('每条流水线都以起草大纲开头 —— 空项目只能从这儿进', () => {
    for (const k of KINDS) expect(pipelineFor(k)[0]!.kind).toBe('outline.draft');
  });

  it('认得出广告、MV、动画，认不出时落到短剧', () => {
    expect(detectKind('帮我做个洗发水的宣传片').kind).toBe('广告');
    expect(detectKind('给这首歌做个 MV').kind).toBe('MV');
    expect(detectKind('做个二次元动画短片').kind).toBe('动画');
    expect(detectKind('一只猫在雨夜生病').kind).toBe('短剧');
  });

  it('命中的词要报出来 —— 猜错时人能看懂它为什么这么猜', () => {
    const r = detectKind('这个产品的卖点是省电');
    expect(r.kind).toBe('广告');
    expect(r.matched).toContain('卖点');
  });

  it('大小写不影响识别', () => {
    expect(detectKind('做个 TVC').kind).toBe('广告');
    expect(detectKind('一支 Mv').kind).toBe('MV');
  });

  it('项目名取第一个短句，不把整段需求当标题', () => {
    expect(nameFromBrief('猫的梦。讲一只猫在雨夜生病，小女孩抱着它跑去医院。')).toBe('猫的梦');
    // 逗号也断句 —— 它还要当目录名
    expect(nameFromBrief('做一支洗发水宣传片，突出洗完第二天还蓬松')).toBe('做一支洗发水宣传片');
    expect(nameFromBrief('一'.repeat(40))).toBe('一'.repeat(14));
  });

  it('项目名里不留省略号 —— 目录名带省略号很难看也难敲', () => {
    expect(nameFromBrief('一'.repeat(40))).not.toContain('…');
  });

  it('空需求也给得出名字，不产生空字符串', () => {
    for (const b of ['', '   ', '。。。']) expect(nameFromBrief(b)).toBe('未命名项目');
  });
});
