import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS, PROVIDERS, defaultModel, findModel, modelsOfModality, providerOf } from './catalog';
import { makeModel, modelKey, parseModelKey } from './model';

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
      expect(p.models.length, p.name).toBeGreaterThan(0);
    }
  });

  it('模型的 provider 字段与它所属的厂商一致 —— 否则查找会错位', () => {
    for (const p of PROVIDERS) {
      for (const m of p.models) expect(m.provider, `${p.name}/${m.id}`).toBe(p.id);
    }
  });

  it('文本走 OpenAI 兼容，图片视频走异步任务 —— 决定 Rust 侧用哪个适配器', () => {
    for (const m of BUILTIN_MODELS) {
      expect(m.protocol, m.id).toBe(m.modality === 'text' ? 'openai-chat' : 'async-task');
    }
  });

  it('三个模态都有可选模型', () => {
    for (const m of ['text', 'image', 'video'] as const) {
      expect(modelsOfModality(m).length, m).toBeGreaterThan(0);
    }
  });

  it('用户自加的模型压过内置同 id —— 目录跟不上时以用户填的为准', () => {
    const custom = {
      id: 'deepseek-chat', name: '我改过的', provider: 'deepseek' as const,
      modality: 'text' as const, protocol: 'openai-chat' as const, caps: {},
    };
    expect(findModel({ provider: 'deepseek', model: 'deepseek-chat' })!.name).toBe('DeepSeek Chat');
    expect(findModel({ provider: 'deepseek', model: 'deepseek-chat' }, [custom])!.name).toBe('我改过的');
  });

  it('优先挑已接入厂商的模型', () => {
    const ref = defaultModel('text', ['moonshot']);
    expect(ref?.provider).toBe('moonshot');
  });

  it('modelKey 与 parseModelKey 可往返，模型 id 里带斜杠也不炸', () => {
    const ref = { provider: 'custom' as const, model: 'org/llama-3.3-70b' };
    expect(parseModelKey(modelKey(ref))).toEqual(ref);
  });

  it('查不到就是 undefined，不给假数据', () => {
    expect(findModel({ provider: 'deepseek', model: '不存在' })).toBeUndefined();
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

  it('自加的模型能被 findModel 查到，且盖过同 id 的内置项', () => {
    const mine = makeModel({ provider: 'deepseek', id: 'deepseek-chat', name: '我改的名', modality: 'text', caps: {} });
    const hit = findModel({ provider: 'deepseek', model: 'deepseek-chat' }, [mine]);
    expect(hit?.name).toBe('我改的名');
  });
});
