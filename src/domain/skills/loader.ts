/**
 * SKILL.md 的解析与装载。
 *
 * **规则必须与 Rust 侧 `core/src/skills.rs` 一致** —— 桌面端由 Rust 扫磁盘，
 * 浏览器里没有文件系统，只能在构建期把内置 skill 的内容嵌进来。两边对同一个
 * 文件必须解析出同样的结果，否则同一个 skill 在两个环境里显示的说明会不一样。
 *
 * 三级加载在前端同样成立：列表只用 meta，正文点进详情才读，附件再往下一层。
 */

export interface SkillMeta {
  name: string;
  description: string;
  /** 来自哪个根：内置 / 用户 / 项目 */
  source: string;
  dir: string;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}

export interface SkillWarning {
  dir: string;
  reason: string;
}

/**
 * 切出 frontmatter 与正文。只认开头的 `---` 围栏 ——
 * 正文里再出现 `---` 不会被误切，因为只找第一段。
 */
export function split(text: string): { front: string; body: string } | null {
  if (!text.startsWith('---')) return null;
  const rest = text.slice(3).replace(/^\r?\n/, '');
  const end = rest.indexOf('\n---');
  if (end < 0) return null;
  return { front: rest.slice(0, end), body: rest.slice(end + 4).replace(/^[\r\n]+/, '') };
}

/**
 * frontmatter 只取 name / description 两个标量。
 *
 * 这是**受限的 YAML**，不是完整实现：够用，而且与 Rust 侧对同一份文件结果一致。
 * 真要写复杂 YAML 的 skill，桌面端 Rust 那边是完整解析，这里会退化成取不到值 ——
 * 所以内置 skill 的 frontmatter 一律写成简单的一行一个键。
 */
export function parseFront(front: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of front.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && v) out[k] = v;
  }
  return out;
}

export interface Parsed {
  meta: Omit<SkillMeta, 'source' | 'hasScripts' | 'hasReferences' | 'hasAssets'>;
  body: string;
}

/** 解析一份 SKILL.md。`dir` 用来在缺 name 时兜底，与 Rust 侧同规则 */
export function parseSkill(dir: string, text: string): Parsed | { error: string } {
  const cut = split(text);
  if (!cut) return { error: 'SKILL.md 开头没有 --- 围起来的 frontmatter' };
  const fm = parseFront(cut.front);
  const name = fm.name?.trim() || dir.split('/').filter(Boolean).pop() || '';
  if (!name) return { error: 'skill 没有名字，目录名也取不到' };
  const description = fm.description?.trim();
  if (!description) {
    return { error: 'frontmatter 里没有 description —— 模型就是靠它决定要不要用这个 skill 的' };
  }
  return { meta: { name, description, dir }, body: cut.body.trim() };
}
