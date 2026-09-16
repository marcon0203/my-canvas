import { beforeEach, describe, expect, it } from 'vitest';
import { hasLocalTool, registerLocalTool, runLocalTool } from './toolhost';

describe('api/toolhost · 浏览器侧工具', () => {
  beforeEach(() => {
    // 每条测试自己注册，注销函数保证不串味
  });

  it('没注册时如实说干不了，不返回假结果', async () => {
    const r = await runLocalTool('stage.render', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('布光台');
  });

  it('注册后能执行并拿回结果', async () => {
    const off = registerLocalTool('stage.render', async (a) => `img:${a.shotId}`);
    expect(hasLocalTool('stage.render')).toBe(true);
    const r = await runLocalTool('stage.render', { shotId: 's1-1' });
    expect(r).toEqual({ ok: true, value: 'img:s1-1' });
    off();
  });

  it('注销之后就不再提供了 —— 布光台关掉就渲不了', async () => {
    const off = registerLocalTool('stage.render', async () => 'x');
    off();
    expect(hasLocalTool('stage.render')).toBe(false);
    expect((await runLocalTool('stage.render', {})).ok).toBe(false);
  });

  it('执行抛错时把原因带出来，不吞掉', async () => {
    const off = registerLocalTool('stage.render', async () => { throw new Error('WebGL 上下文丢了'); });
    const r = await runLocalTool('stage.render', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('WebGL');
    off();
  });

  it('重复注册以后一个为准，注销旧的不会误删新的', async () => {
    const offA = registerLocalTool('stage.render', async () => 'A');
    registerLocalTool('stage.render', async () => 'B');
    offA();   // 旧的注销不该把新的带走
    expect(hasLocalTool('stage.render')).toBe(true);
    expect((await runLocalTool('stage.render', {})).value).toBe('B');
  });
});
