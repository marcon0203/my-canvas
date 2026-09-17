import { parseSkill, type SkillMeta } from './loader';

/**
 * 内置 skill：构建期把 `resources/skills/` 下的 SKILL.md 原文嵌进来。
 *
 * 桌面端不走这里 —— 那边由 Rust 扫真实目录，还能看到用户自己放的。
 * 这份只是为了浏览器里也能看见真实内容，而不是一份手抄的假清单：
 * 改了磁盘上的 SKILL.md，这里跟着变。
 */
const FILES = import.meta.glob('/resources/skills/*/SKILL.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

// 附件只要知道**存不存在**，所以必须带 `?url`：不带的话打包器会把这些
// .md/.py 当模块处理，拿 JS 解析器去啃 Markdown，然后在 `vite build` 里报
// 「Invalid Character」。惰性 glob 骗不过它 —— dev 下不解析，build 时照样解析。
// `?url` 只产出一条资源路径，内容一个字节都不进包。
// 注意：选项必须是**字面量**。抽成一个 `const G = {...}` 传进来，打包器的静态
// 分析看不到 query，会退回成普通模块 glob —— 同一个报错换个地方出现。
const REFS = import.meta.glob('/resources/skills/*/references/*', { query: '?url', import: 'default', eager: true });
const SCRIPTS = import.meta.glob('/resources/skills/*/scripts/*', { query: '?url', import: 'default', eager: true });
const ASSETS = import.meta.glob('/resources/skills/*/assets/*', { query: '?url', import: 'default', eager: true });

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
