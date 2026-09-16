import { describe, expect, it } from 'vitest';
import { PERSONAS, personaById } from './roster';
import { TOOLS_FOR_INTENT, canRun, defaultTools } from './tools';
import {
  canHandleConfigured, checkConfig, defaultConfig, defaultConfigs,
  neededModalities, ownerOfConfigured, preambleOf,
} from './config';
import type { ModelRef } from '@/domain/providers/model';

const TEXT: ModelRef = { provider: 'deepseek', model: 'deepseek-chat' };
const IMAGE: ModelRef = { provider: 'zhipu', model: 'cogview-3-plus' };
const VIDEO: ModelRef = { provider: 'volcengine', model: 'doubao-seedance' };
const ALL = { text: TEXT, image: IMAGE, video: VIDEO };

describe('agent/config · 默认配置自洽', () => {
  it('出厂默认下每位都能接自己认领的全部活儿', () => {
    for (const p of PERSONAS) {
      const c = defaultConfig(p);
      for (const k of p.owns) {
        expect(canRun(c.tools, k), `${p.name} 接不了 ${k}`).toBe(true);
      }
    }
  });

  it('默认配置 + 三个模态都配了模型 → 零问题', () => {
    const cfgs = defaultConfigs();
    for (const p of PERSONAS) {
      expect(checkConfig(cfgs[p.id], ALL).filter((i) => i.level === 'error'), p.name).toEqual([]);
    }
  });

  it('只要文本模型：剪辑不该被要求配文生图', () => {
    const editor = defaultConfig(personaById('editor'));
    expect(neededModalities(editor)).toEqual(['text']);
    expect(checkConfig(editor, { text: TEXT }).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('模态顺序恒为 文本 → 图片 → 视频，不随勾工具的先后变', () => {
    const dp = defaultConfig(personaById('dp'));
    // 反着勾一遍：先视频工具再图片工具，顺序也不该跟着倒过来
    const flipped = { ...dp, tools: ['video.generate', 'image.generate', ...dp.tools] as const };
    expect(neededModalities(flipped)).toEqual(['text', 'image', 'video']);
  });

  it('摄影指导要视频模型 —— 没配就报错，不静默跑不动', () => {
    const dp = defaultConfig(personaById('dp'));
    expect(neededModalities(dp)).toContain('video');
    const issues = checkConfig(dp, { text: TEXT });
    expect(issues.some((i) => i.level === 'error' && i.text.includes('视频'))).toBe(true);
  });
});

describe('agent/config · 报问题而不是偷偷改', () => {
  it('接了活却勾掉工具 → 明确报缺哪几件', () => {
    const dp = defaultConfig(personaById('dp'));
    const crippled = { ...dp, tools: dp.tools.filter((t) => t !== 'video.generate') };
    const issues = checkConfig(crippled, ALL);
    expect(issues.some((i) => i.level === 'error' && i.text.includes('video.generate'))).toBe(true);
  });

  it('模型配错模态 → 报错', () => {
    const dp = defaultConfig(personaById('dp'));
    const wrong = { ...dp, models: { video: IMAGE } };
    expect(checkConfig(wrong, ALL).some((i) => i.level === 'error' && i.text.includes('用不了'))).toBe(true);
  });

  it('模型在目录里找不到 → 报错（厂商改了 id 的情况）', () => {
    const w = defaultConfig(personaById('writer'));
    const gone = { ...w, models: { text: { provider: 'deepseek' as const, model: 'deepseek-v0-不存在' } } };
    expect(checkConfig(gone, ALL).some((i) => i.text.includes('找不到'))).toBe(true);
  });

  it('模型不支持工具调用 → 只是 warn，不拦着用', () => {
    const w = defaultConfig(personaById('writer'));
    const noTools = { ...w, models: { text: { provider: 'deepseek' as const, model: 'deepseek-reasoner' } } };
    const issues = checkConfig(noTools, ALL);
    expect(issues.some((i) => i.level === 'warn' && i.text.includes('工具调用'))).toBe(true);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('agent/config · 配置真的改变分工', () => {
  it('把活儿挪给别人，转交跟着走', () => {
    const cfgs = defaultConfigs();
    expect(ownerOfConfigured('video.batch', cfgs)).toBe('dp');

    // 摄影指导不接了，交给制片
    cfgs.dp = { ...cfgs.dp, skills: cfgs.dp.skills.filter((k) => k !== 'video.batch') };
    cfgs.producer = {
      ...cfgs.producer,
      skills: [...cfgs.producer.skills, 'video.batch'],
      tools: [...new Set([...cfgs.producer.tools, ...TOOLS_FOR_INTENT['video.batch']])],
    };
    expect(ownerOfConfigured('video.batch', cfgs)).toBe('producer');
    expect(canHandleConfigured('dp', 'video.batch', cfgs)).toBe(false);
    expect(canHandleConfigured('producer', 'video.batch', cfgs)).toBe(true);
  });

  it('停用的 Agent 不接活，也不会被转交过去', () => {
    const cfgs = defaultConfigs();
    cfgs.dp = { ...cfgs.dp, enabled: false };
    expect(canHandleConfigured('dp', 'shots.generate', cfgs)).toBe(false);
    expect(ownerOfConfigured('shots.generate', cfgs)).toBeUndefined();
  });

  it('勾掉工具后，即使还挂着技能也接不了 —— 界面上那个 ⚠ 是真的', () => {
    const cfgs = defaultConfigs();
    cfgs.art = { ...cfgs.art, tools: cfgs.art.tools.filter((t) => t !== 'image.generate') };
    expect(canHandleConfigured('art', 'assets.views', cfgs)).toBe(false);
  });

  it('闲聊谁都能接，不受配置影响', () => {
    const cfgs = defaultConfigs();
    cfgs.writer = { ...cfgs.writer, skills: [], tools: [] };
    expect(canHandleConfigured('writer', 'chat', cfgs)).toBe(true);
  });

  it('defaultTools 只给该给的 —— 剪辑拿不到出图工具', () => {
    expect(defaultTools(personaById('editor').owns)).not.toContain('image.generate');
    expect(defaultTools(personaById('dp').owns)).toContain('video.generate');
  });
});

describe('agent/config · 侧重方向与自主度', () => {
  it('每位都有自己的系统提示词，不是同一段套话', () => {
    const texts = PERSONAS.map((p) => p.preamble);
    expect(new Set(texts).size).toBe(PERSONAS.length);
    for (const p of PERSONAS) {
      expect(p.preamble.length, p.name).toBeGreaterThan(80);
      // 每段都要写清「拿不准时偏向哪边」—— 自主规划下这句最影响行为
      expect(p.preamble, p.name).toContain('拿不准时');
    }
  });

  it('默认先出方案，不自作主张', () => {
    for (const p of PERSONAS) expect(defaultConfig(p).autonomy).toBe('propose');
  });

  it('改写后用改写的，清空回落出厂默认', () => {
    const p = personaById('dp');
    const base = defaultConfig(p);
    expect(preambleOf(base, p)).toBe(p.preamble);
    expect(preambleOf({ ...base, preamble: '只拍特写' }, p)).toBe('只拍特写');
    // 空白不算改写 —— 免得误存一个空提示词把 Agent 变哑巴
    expect(preambleOf({ ...base, preamble: '   ' }, p)).toBe(p.preamble);
  });
});
