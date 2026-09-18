import { describe, expect, it } from 'vitest';
import { capsOf, groupOf, groupsOf, toSpec, toYaml } from './yaml';
import { makeModel } from './model';
import type { ModelSpec } from './model';

/**
 * `<workspace>/providers/<id>.yaml` ↔ ModelSpec 的换算。
 *
 * 这份东西是**人手写的**，所以「没写」和「写成空的」必须是两件事，
 * 而且写错了类型的字段不能被放过去让 Agent 配置页说谎。
 */

describe('caps：没写和写成空列表不是一件事', () => {
  it('没写 → 按类型给默认值', () => {
    // 文本模型默认支持流式和工具调用
    expect(capsOf('text', undefined)).toEqual({ stream: true, tools: true });
    expect(capsOf('image', undefined)).toEqual({ refImage: true });
  });

  it('写成空列表 → 明确都不支持', () => {
    expect(capsOf('text', [])).toEqual({});
    expect(capsOf('image', [])).toEqual({});
  });

  /**
   * 混成一件事的后果：手写一份最简的文件（不写 caps）就等于把所有能力关掉，
   * 而 Agent 配置页会说这个模型不支持 function calling —— 那是假的，
   * 而且人根本不会想到是文件里少写了一行。
   */
  it('这个区别是有后果的，不是洁癖', () => {
    expect(capsOf('text', undefined)).not.toEqual(capsOf('text', []));
  });

  it('写错类型的能力被过滤掉，不让配置页说谎', () => {
    // 给文本模型写 refImage（出图才有的能力）
    expect(capsOf('text', ['refImage', 'tools'])).toEqual({ tools: true });
    // 给出图模型写 tools
    expect(capsOf('image', ['tools', 'refImage'])).toEqual({ refImage: true });
    // 完全不认识的键也一样
    expect(capsOf('text', ['乱写的'])).toEqual({});
  });
});

describe('YAML 一项 → ModelSpec', () => {
  it('协议由类型决定，不从文件里读', () => {
    expect(toSpec('deepseek', 'text', { id: 'deepseek-chat' }).protocol).toBe('openai-chat');
    expect(toSpec('volcengine', 'image', { id: 'seedream' }).protocol).toBe('async-task');
    expect(toSpec('volcengine', 'video', { id: 'seedance' }).protocol).toBe('async-task');
  });

  it('名字没写就拿 id 顶上 —— 界面上不能是空的', () => {
    expect(toSpec('deepseek', 'text', { id: 'm1' }).name).toBe('m1');
    expect(toSpec('deepseek', 'text', { id: 'm1', name: '  ' }).name).toBe('m1');
    expect(toSpec('deepseek', 'text', { id: 'm1', name: '一号' }).name).toBe('一号');
  });

  it('没写的可选项不留 undefined 键', () => {
    const s = toSpec('deepseek', 'text', { id: 'm1' });
    expect('context' in s).toBe(false);
    expect('note' in s).toBe(false);
  });

  it('写了的可选项带过来', () => {
    const s = toSpec('deepseek', 'text', { id: 'm1', context: 65536, note: '便宜' });
    expect(s.context).toBe(65536);
    expect(s.note).toBe('便宜');
  });
});

describe('ModelSpec → YAML 一项', () => {
  it('名字和 id 一样就不写 —— 那等于没写，Rust 侧会存成简写', () => {
    const m = makeModel({ provider: 'deepseek', id: 'm1', modality: 'text', caps: {} });
    expect(m.name).toBe('m1');
    expect('name' in toYaml(m)).toBe(false);
  });

  /**
   * caps **明确写出来，哪怕是空列表**。
   *
   * 不写的话下次读回来会被当成「没说」，按默认值填上几个用户刚取消掉的能力 ——
   * 症状是「我在界面上取消了流式，重开设置它又勾上了」。
   */
  it('caps 一定写出来，取消掉的能力不会自己回来', () => {
    const m = makeModel({ provider: 'deepseek', id: 'm1', modality: 'text', caps: {} });
    const y = toYaml(m);
    expect(y.caps).toEqual([]);
    // 读回来还是「都不支持」，不是默认那两个
    expect(capsOf('text', y.caps)).toEqual({});
  });

  it('勾了的写出来', () => {
    const m = makeModel({
      provider: 'deepseek', id: 'm1', modality: 'text', caps: { tools: true },
    });
    expect(toYaml(m).caps).toEqual(['tools']);
  });
});

describe('往返', () => {
  const round = (m: ModelSpec) => toSpec(m.provider, m.modality, toYaml(m));

  it('存下去再读回来，一模一样', () => {
    const models = [
      makeModel({ provider: 'deepseek', id: 'deepseek-chat', modality: 'text', contextK: 64, caps: { stream: true, tools: true } }),
      makeModel({ provider: 'deepseek', id: 'r1', name: 'R1（思考）', modality: 'text', caps: { reasoning: true } }),
      makeModel({ provider: 'volcengine', id: 'seedream', modality: 'image', caps: { refImage: true } }),
      makeModel({ provider: 'volcengine', id: 'tts-1', modality: 'audio', caps: {} }),
    ];
    for (const m of models) expect(round(m)).toEqual(m);
  });
});

describe('按类型分组', () => {
  const list = [
    makeModel({ provider: 'volcengine', id: 't1', modality: 'text', caps: {} }),
    makeModel({ provider: 'volcengine', id: 'i1', modality: 'image', caps: {} }),
    makeModel({ provider: 'volcengine', id: 'i2', modality: 'image', caps: {} }),
  ];

  it('只挑那一类', () => {
    expect(groupOf(list, 'image').map((y) => y.id)).toEqual(['i1', 'i2']);
    expect(groupOf(list, 'video')).toEqual([]);
  });

  it('四类都在，一类都不漏', () => {
    const g = groupsOf(list);
    expect(Object.keys(g).sort()).toEqual(['audio', 'image', 'text', 'video']);
    expect(g.text.map((y) => y.id)).toEqual(['t1']);
    expect(g.audio).toEqual([]);
  });
});
