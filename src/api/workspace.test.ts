import { describe, expect, it } from 'vitest';
import { defaultMeta, newProjectId } from './workspace';

describe('api/workspace · 项目 id', () => {
  it('用名字加日期，不用 uuid —— 打开 projects/ 要认得出是哪个项目', () => {
    const id = newProjectId('猫的梦', []);
    expect(id).toMatch(/^猫的梦-\d{8}$/);
  });

  it('同名同一天会加序号，不覆盖已有项目', () => {
    const a = newProjectId('猫', []);
    const b = newProjectId('猫', [a]);
    const c = newProjectId('猫', [a, b]);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(b).toMatch(/-2$/);
    expect(c).toMatch(/-3$/);
  });

  it('路径分隔符被换掉 —— id 要能直接当目录名', () => {
    expect(newProjectId('a/b\\c:d*e?f"g<h>i|j', [])).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('首尾的点和空格去掉 —— Windows 上以点结尾的目录名建不了', () => {
    expect(newProjectId('  ..名字..  ', [])).toMatch(/^名字-\d{8}$/);
  });

  it('名字全是非法字符时不产生空 id', () => {
    expect(newProjectId('///', [])).toMatch(/^未命名-\d{8}$/);
    expect(newProjectId('   ', [])).toMatch(/^未命名-\d{8}$/);
  });

  it('新项目的默认值是完整的 —— 缺字段会让项目页崩', () => {
    const m = defaultMeta('p1', '猫');
    expect(m.id).toBe('p1');
    expect(m.proj).toBe('猫');
    expect(m.styles.length).toBeGreaterThan(0);
    expect(m.styles).toContain(m.style);
    expect(m.credits).toBe(m.budget);
    expect(() => new Date(m.updatedAt).toISOString()).not.toThrow();
  });
});
