import { describe, expect, it } from 'vitest';
import { defaultMeta, newProjectId } from './workspace';
import { nameFromBrief } from '@/domain/agent/pipeline';

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

describe('id 与标题是两件事', () => {
  /**
   * 「目录名可读」和「URL 短」这两件事是冲突的：中文一个字 URL 编码成
   * 九个字符。这里选的是**目录名可读** —— 用户会去 projects/ 里翻，
   * 而 URL 没人手打。所以只卡住那截名字的字数，不承诺 URL 有多短。
   */
  it('id 里那截名字有上限，不再把一整句需求塞进目录名', () => {
    const long = '一个修钟表的老人在拆开一只怀表时发现里面住着一只会说话的猫';
    const id = newProjectId(long, []);
    expect(id).toMatch(/^.{1,8}-\d{8}$/);
    // 标题仍然是完整那句（截到 14 字），id 更短 —— 两者不是一回事
    expect(id.replace(/-\d{8}$/, '').length).toBeLessThan(nameFromBrief(long).length);
  });

  it('改标题不动 id：链接、目录、媒体文件路径都挂在 id 上', () => {
    const id = newProjectId('猫的梦', []);
    const meta = defaultMeta(id, '猫的梦');
    const renamed = { ...meta, proj: '换了个完全不一样的名字' };
    expect(renamed.id).toBe(id);
    // 也不该有谁从 id 反推标题
    expect(renamed.proj).not.toBe(renamed.id);
  });

  it('同一天同一句话建两次能共存', () => {
    const a = newProjectId('猫的梦', []);
    const b = newProjectId('猫的梦', [a]);
    expect(b).not.toBe(a);
    expect(b.startsWith(a)).toBe(true);   // 尾号区分，前缀仍认得出
  });
});
