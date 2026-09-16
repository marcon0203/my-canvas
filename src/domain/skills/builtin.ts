import { parseSkill, type SkillMeta } from './loader';

/**
 * 内置 skill：构建期把 `src-tauri/skills/` 下的 SKILL.md 原文嵌进来。
 *
 * 桌面端不走这里 —— 那边由 Rust 扫真实目录，还能看到用户自己放的。
 * 这份只是为了浏览器里也能看见真实内容，而不是一份手抄的假清单：
 * 改了磁盘上的 SKILL.md，这里跟着变。
 */
const FILES = import.meta.glob('/src-tauri/skills/*/SKILL.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

// 附件只要知道**存不存在**，所以不能用 eager —— 那会真的去 import 这些
// .md/.py，Rolldown 会拿 JS 解析器去啃 Markdown 然后报语法错。
// 惰性 glob 只产出「路径 → 加载函数」的表，不碰文件内容。
const REFS = import.meta.glob('/src-tauri/skills/*/references/*');
const SCRIPTS = import.meta.glob('/src-tauri/skills/*/scripts/*');
const ASSETS = import.meta.glob('/src-tauri/skills/*/assets/*');

const dirOf = (path: string) => path.replace(/\/SKILL\.md$/, '');
const has = (map: Record<string, unknown>, dir: string) =>
  Object.keys(map).some((p) => p.startsWith(`${dir}/`));

export interface BuiltinSkill {
  meta: SkillMeta;
  body: string;
}

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = Object.entries(FILES)
  .map(([path, text]) => {
    const dir = dirOf(path);
    const parsed = parseSkill(dir, text);
    if ('error' in parsed) return null;
    return {
      meta: {
        ...parsed.meta,
        source: '内置',
        hasScripts: has(SCRIPTS, dir),
        hasReferences: has(REFS, dir),
        hasAssets: has(ASSETS, dir),
      },
      body: parsed.body,
    };
  })
  .filter((x): x is BuiltinSkill => !!x)
  .sort((a, b) => a.meta.name.localeCompare(b.meta.name));

export const builtinSkill = (name: string): BuiltinSkill | undefined =>
  BUILTIN_SKILLS.find((s) => s.meta.name === name);
