import { describe, expect, it } from 'vitest';
import { PROVIDERS, defaultModel, findModel, modelsOfModality, providerOf } from './catalog';
import { makeModel, modelKey, parseModelKey, type ModelSpec } from './model';

/** 用户自己加的两个模型 —— 目录里一个模型都没有，所以测试得自带样本 */
const MINE: ModelSpec[] = [
  makeModel({ provider: 'deepseek', id: 'deepseek-chat', name: 'DS Chat', modality: 'text', caps: {} }),
  makeModel({ provider: 'moonshot', id: 'kimi-k2', name: 'Kimi', modality: 'text', caps: {} }),
  makeModel({ provider: 'volcengine', id: 'seedream-4', modality: 'image', caps: {} }),
];

describe('providers/catalog', () => {
  it('六家国内厂商 + 自定义端点都在', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['volcengine', 'deepseek', 'zhipu', 'bailian', 'hunyuan', 'moonshot', 'custom']));
  });

  it('除自定义外都带默认端点，且是 https', () => {
    for (const p of PROVIDERS) {
      if (p.userDefined) { expect(p.baseUrl).toBe(''); continue; }
      expect(p.baseUrl, p.name).toMatch(/^https:\/\//);
    }
  });

  it('**一个模型都不预设** —— 目录只答「支持哪几家」', () => {
    for (const p of PROVIDERS) {
      // 连字段都不该有：留着它，迟早有人往里塞一份会过期的清单
      expect('models' in p, p.name).toBe(false);
    }
    for (const m of ['text', 'image', 'video'] as const) {
      expect(modelsOfModality(m), m).toEqual([]);
    }
  });

  it('没接入任何厂商时没有默认模型 —— 界面要说「还没有可用模型」，而不是编一个', () => {
    for (const m of ['text', 'image', 'video'] as const) {
      expect(defaultModel(m), m).toBeUndefined();
      expect(defaultModel(m, ['deepseek']), m).toBeUndefined();
    }
  });

  it('模型只从用户加的那份里查', () => {
    expect(findModel({ provider: 'deepseek', model: 'deepseek-chat' })).toBeUndefined();
    expect(findModel({ provider: 'deepseek', model: 'deepseek-chat' }, MINE)!.name).toBe('DS Chat');
    // 厂商对不上就不算命中，否则同名 id 会跨厂串台
    expect(findModel({ provider: 'zhipu', model: 'deepseek-chat' }, MINE)).toBeUndefined();
  });

  it('按模态过滤用户加的模型', () => {
    expect(modelsOfModality('text', MINE).map((m) => m.id)).toEqual(['deepseek-chat', 'kimi-k2']);
    expect(modelsOfModality('image', MINE).map((m) => m.id)).toEqual(['seedream-4']);
    expect(modelsOfModality('video', MINE)).toEqual([]);
  });

  it('优先挑已接入厂商的模型', () => {
    expect(defaultModel('text', ['moonshot'], MINE)?.provider).toBe('moonshot');
    expect(defaultModel('text', ['deepseek'], MINE)?.provider).toBe('deepseek');
    // 已接入的一家都没有该模态的模型时，退回列表第一个，而不是返回空
    expect(defaultModel('text', ['zhipu'], MINE)?.model).toBe('deepseek-chat');
  });

  it('modelKey 与 parseModelKey 可往返，模型 id 里带斜杠也不炸', () => {
    const ref = { provider: 'custom' as const, model: 'org/llama-3.3-70b' };
    expect(parseModelKey(modelKey(ref))).toEqual(ref);
  });

  it('查不到就是 undefined，不给假数据', () => {
    expect(findModel(undefined, MINE)).toBeUndefined();
    expect(parseModelKey('没有斜杠')).toBeUndefined();
    expect(providerOf('custom')!.userDefined).toBe(true);
  });
});

describe('providers · 新增模型：表单 → ModelSpec', () => {
  const caps = { stream: true, tools: true, refImage: true, vision: true };

  it('类型决定协议族，不让用户选 —— 选错只会在发请求时才炸', () => {
    expect(makeModel({ provider: 'deepseek', id: 'x', modality: 'text', caps }).protocol)
      .toBe('openai-chat');
    for (const m of ['image', 'video'] as const) {
      expect(makeModel({ provider: 'deepseek', id: 'x', modality: m, caps }).protocol)
        .toBe('async-task');
    }
  });

  it('能力按类型过滤 —— 切过类型的表单里留着的上一类勾不能混进去', () => {
    // 表单勾着文本那套，却按图片提交
    const img = makeModel({ provider: 'volcengine', id: 'x', modality: 'image', caps });
    expect(img.caps).toEqual({ refImage: true });
    expect(img.caps.tools).toBeUndefined();

    const txt = makeModel({ provider: 'volcengine', id: 'x', modality: 'text', caps });
    expect(txt.caps).toEqual({ stream: true, tools: true, vision: true });
    expect(txt.caps.refImage).toBeUndefined();
  });

  it('没勾的能力不写成 false，而是不出现 —— 与目录里的种子同形', () => {
    const m = makeModel({ provider: 'deepseek', id: 'x', modality: 'text', caps: {} });
    expect(m.caps).toEqual({});
    expect('stream' in m.caps).toBe(false);
  });

  it('上下文按 K 换算，只有文本模型有', () => {
    expect(makeModel({ provider: 'deepseek', id: 'x', modality: 'text', contextK: 64, caps }).context)
      .toBe(65536);
    expect(makeModel({ provider: 'deepseek', id: 'x', modality: 'image', contextK: 64, caps }).context)
      .toBeUndefined();
  });

  it('上下文留空或填了非数字就不写这个字段，而不是写个 0 或 NaN', () => {
    for (const v of [undefined, NaN, 0, -3]) {
      expect(makeModel({ provider: 'deepseek', id: 'x', modality: 'text', contextK: v, caps }).context)
        .toBeUndefined();
    }
  });

  it('显示名留空就用 id；id 两边的空白修掉', () => {
    const m = makeModel({ provider: 'deepseek', id: '  deepseek-chat  ', name: '  ', modality: 'text', caps });
    expect(m.id).toBe('deepseek-chat');
    expect(m.name).toBe('deepseek-chat');
  });

  it('自加的模型能被 findModel 查到', () => {
    const mine = makeModel({ provider: 'deepseek', id: 'deepseek-chat', name: '我起的名', modality: 'text', caps: {} });
    const hit = findModel({ provider: 'deepseek', model: 'deepseek-chat' }, [mine]);
    expect(hit?.name).toBe('我起的名');
  });
});
