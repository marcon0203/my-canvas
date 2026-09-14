import { describe, expect, it } from 'vitest';
import { route, routeKind } from './router';

describe('agent/router', () => {
  it('把自由输入落到具体意图上', () => {
    expect(routeKind('帮我起草一个大纲')).toBe('outline.draft');
    expect(routeKind('这一场还有别的走向吗')).toBe('outline.expand');
    expect(routeKind('把这段润色一下')).toBe('script.polish');
    expect(routeKind('从剧本里提取角色')).toBe('assets.extract');
    expect(routeKind('按大纲拆镜')).toBe('shots.generate');
    expect(routeKind('这片子花了多少积分')).toBe('cost.report');
  });

  it('认不出来就是闲聊，不乱动项目', () => {
    expect(routeKind('你好')).toBe('chat');
    expect(routeKind('')).toBe('chat');
    expect(route('今天天气不错').matched).toEqual([]);
  });

  it('长关键词优先：「生成分镜」不该被「生成」勾到视频上', () => {
    expect(routeKind('生成分镜')).toBe('shots.generate');
    expect(routeKind('批量转视频')).toBe('video.batch');
  });

  it('回传命中的词，界面可以解释为什么这么理解', () => {
    const r = route('润色一下这段台词');
    expect(r.kind).toBe('script.polish');
    expect(r.matched).toContain('润色');
  });
});
