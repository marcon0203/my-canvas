import { describe, expect, it } from 'vitest';
import { parseFront, parseSkill, split } from './loader';
import { BUILTIN_SKILLS, builtinSkill } from './builtin';

const md = (front: string, body: string) => `---\n${front}\n---\n\n${body}\n`;

describe('skills/loader · 与 Rust 侧同规则', () => {
  it('切出 frontmatter 与正文', () => {
    const cut = split(md('name: a\ndescription: d', '正文'))!;
    expect(parseFront(cut.front)).toEqual({ name: 'a', description: 'd' });
    expect(cut.body.trim()).toBe('正文');
  });

  it('正文里的 --- 不会被误切 —— 只认开头那一段', () => {
    const p = parseSkill('x', md('name: a\ndescription: d', '例子：\n---\nk: v\n---\n结束'));
    expect('error' in p).toBe(false);
    if (!('error' in p)) expect(p.body).toContain('k: v');
  });

  it('没有围栏的不当成 skill，而不是拿正文去猜', () => {
    const p = parseSkill('x', '# 普通文档\n没有围栏');
    expect('error' in p && p.error).toContain('frontmatter');
  });

  it('缺 description 就跳过 —— 模型靠它决定用不用', () => {
    const p = parseSkill('x', md('name: a', '正文'));
    expect('error' in p && p.error).toContain('description');
  });

  it('缺 name 时用目录名兜底', () => {
    const p = parseSkill('/src-tauri/skills/my-skill', md('description: d', '正文'));
    expect('error' in p ? '' : p.meta.name).toBe('my-skill');
  });

  it('引号会被脱掉，注释与空行跳过', () => {
    expect(parseFront('# 注释\n\nname: "a"\ndescription: \'d\'')).toEqual({ name: 'a', description: 'd' });
  });
});

describe('skills/builtin · 真读了磁盘上的文件', () => {
  it('内置 skill 是从 src-tauri/skills 读出来的，不是手抄的清单', () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);
    for (const s of BUILTIN_SKILLS) {
      expect(s.meta.dir).toMatch(/^\/src-tauri\/skills\//);
      expect(s.meta.description.length).toBeGreaterThan(10);
      expect(s.body.length).toBeGreaterThan(50);
    }
  });

  it('起草大纲与补写提示词都在，且正文带着真实指令', () => {
    expect(builtinSkill('draft-outline')?.body).toContain('三幕');
    expect(builtinSkill('write-shot-prompts')?.body).toContain('镜号');
  });

  it('附件目录被认出来 —— 第 3 级确实存在', () => {
    expect(builtinSkill('write-shot-prompts')?.meta.hasReferences).toBe(true);
    expect(builtinSkill('draft-outline')?.meta.hasReferences).toBe(false);
  });
});
