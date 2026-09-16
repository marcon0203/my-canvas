import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS, PROVIDERS, defaultModel, findModel, modelsOfModality, providerOf } from './catalog';
import { modelKey, parseModelKey } from './model';

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
