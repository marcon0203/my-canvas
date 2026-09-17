//! Skill 加载：磁盘上的一个目录 = 一个 Skill。
//!
//! 三级渐进披露（名字与说明常驻 → 正文用到才读 → 附件正文指到哪个读哪个）
//! 全在这一个模块里。单独成包是因为它的输入是**用户往目录里放的文件** ——
//! 路径穿越那道防线值得有个自己的边界。
//!
//! 一个 Skill 是一个目录：
//!
//! ```text
//! skill-name/
//! ├── SKILL.md          必需。YAML frontmatter（name / description）+ Markdown 正文
//! ├── scripts/          可执行代码，不进上下文
//! ├── references/       按需读进上下文的文档
//! └── assets/           产出里要用的模板
//! ```
//!
//! **三级加载是这套东西的全部要点**，别把它做成「一次性全读进来」：
//!
//! | 级别 | 内容 | 什么时候进上下文 |
//! |---|---|---|
//! | 1 | name + description | 始终常驻，几十个 skill 也只占一小段 |
//! | 2 | SKILL.md 正文 | 这一轮真的要用它时才读 |
//! | 3 | references / assets | 正文里指到哪个才读哪个 |
//!
//! 所以 `SkillStore` 扫描时**只解析 frontmatter**，正文与附件都留在磁盘上，
//! 由 `body()` / `resource()` 按需取。

use studio_error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 第 1 级：常驻的那点元信息。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    /// 目录名兜底；frontmatter 的 name 优先
    pub name: String,
    /// 触发靠它 —— 模型读这一句决定要不要展开正文
    pub description: String,
    /// 这个 skill 的目录
    pub dir: PathBuf,
    /// 来自哪个根目录（内置 / 用户 / 项目），界面上要说清楚
    pub source: String,
    /// 有哪些附件目录，界面上展示用
    pub has_scripts: bool,
    pub has_references: bool,
    pub has_assets: bool,
}

/// frontmatter 只认这两个字段。多写的忽略，缺 name 时用目录名兜底。
#[derive(Debug, Deserialize)]
struct FrontMatter {
    name: Option<String>,
    description: Option<String>,
}

/// 扫描时跳过了什么，为什么。**不静默吞掉** —— 用户放了个坏 skill 得能看见。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillWarning {
    pub dir: PathBuf,
    pub reason: String,
}

/// 一个待扫描的根目录。`name` 是给人看的来源标签。
#[derive(Debug, Clone)]
pub struct Root {
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Default)]
pub struct SkillStore {
    skills: Vec<SkillMeta>,
    warnings: Vec<SkillWarning>,
}

/// 只读 frontmatter，正文原样留在磁盘上 —— 这就是第 1 级。
fn parse_meta(dir: &Path, source: &str, text: &str) -> std::result::Result<SkillMeta, String> {
    let (front, _) = studio_doc::md::split_front(text).ok_or("SKILL.md 开头没有 --- 围起来的 frontmatter")?;
    let fm: FrontMatter = serde_yaml_ng::from_str(front)
        .map_err(|e| format!("frontmatter 不是合法 YAML：{e}"))?;

    let fallback = dir.file_name().and_then(|s| s.to_str()).unwrap_or_default().to_string();
    let name = fm.name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or(fallback);
    if name.is_empty() {
        return Err("skill 没有名字，目录名也取不到".into());
    }
    let description = fm
        .description
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or("frontmatter 里没有 description —— 模型就是靠它决定要不要用这个 skill 的")?;

    Ok(SkillMeta {
        name,
        description,
        dir: dir.to_path_buf(),
        source: source.to_string(),
        has_scripts: dir.join("scripts").is_dir(),
        has_references: dir.join("references").is_dir(),
        has_assets: dir.join("assets").is_dir(),
    })
}

impl SkillStore {
    /// 扫描若干根目录。**后面的根覆盖前面的同名 skill** ——
    /// 用户自己放的那份应该盖过内置的，这是「能改内置行为」的唯一手段。
    pub fn scan(roots: &[Root]) -> Self {
        let mut out = SkillStore::default();
        for root in roots {
            let Ok(entries) = fs::read_dir(&root.path) else { continue };
            let mut dirs: Vec<PathBuf> =
                entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
            dirs.sort();          // 目录顺序因平台而异，排一下让结果可复现
            for dir in dirs {
                let md = dir.join("SKILL.md");
                if !md.is_file() {
                    out.warnings.push(SkillWarning {
                        dir: dir.clone(),
                        reason: "目录里没有 SKILL.md".into(),
                    });
                    continue;
                }
                match fs::read_to_string(&md).map_err(|e| e.to_string())
                    .and_then(|t| parse_meta(&dir, &root.name, &t))
                {
                    Ok(meta) => {
                        out.skills.retain(|s| s.name != meta.name);
                        out.skills.push(meta);
                    }
                    Err(reason) => out.warnings.push(SkillWarning { dir, reason }),
                }
            }
        }
        out.skills.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    pub fn all(&self) -> &[SkillMeta] {
        &self.skills
    }

    pub fn warnings(&self) -> &[SkillWarning] {
        &self.warnings
    }

    pub fn get(&self, name: &str) -> Option<&SkillMeta> {
        self.skills.iter().find(|s| s.name == name)
    }

    /// 第 1 级拼给模型的清单：**只有名字和描述**。
    ///
    /// 这是渐进披露的第一层，装一百个 skill 也只多这一小段；
    /// 模型看着这张单子决定要不要展开某一个。
    pub fn catalog(&self, allowed: &[String]) -> String {
        let list: Vec<&SkillMeta> = self
            .skills
            .iter()
            .filter(|s| allowed.is_empty() || allowed.iter().any(|a| a == &s.name))
            .collect();
        if list.is_empty() {
            return String::new();
        }
        let mut s = String::from("你可以调用以下 skill。先只看名字和说明，判断哪个对得上；\n\
                                  需要时再要它的正文，别一上来就全展开：\n");
        for m in list {
            s.push_str(&format!("- {}：{}\n", m.name, m.description));
        }
        s
    }

    /// 第 2 级：某个 skill 的正文，用到才读。
    pub fn body(&self, name: &str) -> Result<String> {
        let meta = self.get(name).ok_or_else(|| Error::UnknownSkill(name.into()))?;
        let text = fs::read_to_string(meta.dir.join("SKILL.md"))
            .map_err(|e| Error::Skill(format!("读 {name} 的 SKILL.md 失败：{e}")))?;
        let (_, body) = studio_doc::md::split_front(&text)
            .ok_or_else(|| Error::Skill(format!("{name} 的 SKILL.md 没有 frontmatter")))?;
        Ok(body.trim().to_string())
    }

    /// 第 3 级：正文里指到的附件，指到哪个读哪个。
    ///
    /// `rel` 必须落在这个 skill 的目录里。skill 是用户往目录里放的东西，
    /// 一个 `../../../.ssh/id_rsa` 就能把无关文件读进上下文再发给模型 ——
    /// 所以这里按 canonicalize 之后的真实路径核前缀，不是简单地拒绝 `..`。
    pub fn resource(&self, name: &str, rel: &str) -> Result<String> {
        let meta = self.get(name).ok_or_else(|| Error::UnknownSkill(name.into()))?;
        let root = meta
            .dir
            .canonicalize()
            .map_err(|e| Error::Skill(format!("{name} 的目录读不到：{e}")))?;
        let target = root.join(rel);
        let target = target
            .canonicalize()
            .map_err(|_| Error::Skill(format!("{name} 里没有 {rel}")))?;
        if !target.starts_with(&root) {
            return Err(Error::Skill(format!("{rel} 不在 {name} 的目录里，拒绝读取")));
        }
        fs::read_to_string(&target).map_err(|e| Error::Skill(format!("读 {rel} 失败：{e}")))
    }
}

/* ---------------- 导入 ---------------- */

/// 一次导入最多带多少个文件、多大。
///
/// 不是为了省磁盘，是为了挡住「选错了目录」：用户很容易把整个项目文件夹、
/// 甚至家目录选进来。超了就停下来问，而不是默默复制两万个文件。
pub const MAX_FILES: usize = 200;
pub const MAX_BYTES: u64 = 8 * 1024 * 1024;

/// 把一个目录导入成用户 Skill：校验 → 复制到 `<workspace>/skills/<名字>`。
///
/// 为什么要复制而不是记一个路径：Skill 的正文和附件在每次运行时都要读，
/// 指向用户桌面上某个临时文件夹的话，文件夹一挪、一删，Agent 就少一段指令，
/// 而且没人知道是什么时候开始少的。
///
/// 名字取 frontmatter 的 `name`，不是源目录名 —— 目录叫什么无所谓，
/// 加载时认的是 `name`（同名会盖掉内置的那个，这一点要在界面上说清）。
pub fn import_dir(skills_dir: &Path, src: &Path) -> Result<SkillMeta> {
    if !src.is_dir() {
        return Err(Error::Skill(format!("{} 不是一个目录", src.display())));
    }
    let md = src.join("SKILL.md");
    if !md.is_file() {
        return Err(Error::Skill(
            "这个目录里没有 SKILL.md。一个 Skill 至少要有这个文件，里面写清它叫什么、什么时候用".into(),
        ));
    }
    let text = fs::read_to_string(&md).map_err(|e| Error::Skill(format!("读 SKILL.md 失败：{e}")))?;
    let meta = parse_meta(src, "用户", &text).map_err(Error::Skill)?;

    // 先数一遍再复制：复制到一半发现太大，留下的是半个 skill
    let (files, bytes) = measure(src)?;
    if files > MAX_FILES || bytes > MAX_BYTES {
        return Err(Error::Skill(format!(
            "这个目录有 {files} 个文件、{:.1} MB，超出单个 Skill 的上限（{MAX_FILES} 个文件、{} MB）。是不是选错了目录？",
            bytes as f64 / 1024.0 / 1024.0,
            MAX_BYTES / 1024 / 1024
        )));
    }

    let name = studio_doc::md::safe_name(&meta.name);
    if name.is_empty() {
        return Err(Error::Skill(format!("名字「{}」不能当目录名", meta.name)));
    }
    let dest = skills_dir.join(&name);

    // 源在目标里面（比如直接选了 skills/xxx 自己）：复制会无限套娃
    if let (Ok(s), Ok(d)) = (src.canonicalize(), skills_dir.canonicalize())
        && s.starts_with(&d)
    {
        return Err(Error::Skill(
            "这个目录已经在 skills 里了，不用导入。改完文件直接刷新就生效".into(),
        ));
    }
    if dest.exists() {
        return Err(Error::Skill(format!(
            "已经有一个叫「{}」的 Skill 了。先把它删掉或改个名字，再导入",
            meta.name
        )));
    }

    copy_tree(src, &dest).map_err(|e| {
        // 复制失败就把半个目录清掉，别留下一个坏 skill
        let _ = fs::remove_dir_all(&dest);
        Error::Skill(format!("复制失败：{e}"))
    })?;

    let mut out = meta;
    out.dir = dest;
    Ok(out)
}

/// 数文件个数与总字节。跟随子目录，不跟随符号链接
fn measure(dir: &Path) -> Result<(usize, u64)> {
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let entries = fs::read_dir(&d).map_err(|e| Error::Skill(format!("读 {} 失败：{e}", d.display())))?;
        for e in entries.flatten() {
            let p = e.path();
            let Ok(md) = e.metadata() else { continue };
            if md.is_symlink() {
                continue;
            }
            if md.is_dir() {
                stack.push(p);
            } else {
                files += 1;
                bytes += md.len();
                if files > MAX_FILES || bytes > MAX_BYTES {
                    return Ok((files, bytes));   // 超了就不用数完
                }
            }
        }
    }
    Ok((files, bytes))
}

/// 递归复制。**跳过符号链接**：一个指向家目录的链接会把无关文件复制进来
fn copy_tree(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for e in fs::read_dir(src)?.flatten() {
        let from = e.path();
        let md = e.metadata()?;
        if md.is_symlink() {
            continue;
        }
        let Some(name) = from.file_name() else { continue };
        let to = dest.join(name);
        if md.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    fn skill(root: &Path, name: &str, front: &str, body: &str) {
        write(root, &format!("{name}/SKILL.md"), &format!("---\n{front}\n---\n\n{body}\n"));
    }

    fn store_of(tmp: &TempDir) -> SkillStore {
        SkillStore::scan(&[Root { name: "内置".into(), path: tmp.path().to_path_buf() }])
    }

    #[test]
    fn 扫描只读_frontmatter_正文留在磁盘上() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "draft-outline", "name: draft-outline\ndescription: 起草大纲", "正文很长很长");
        let st = store_of(&tmp);

        let m = &st.all()[0];
        assert_eq!(m.name, "draft-outline");
        assert_eq!(m.description, "起草大纲");
        // 元信息里没有正文字段 —— 这就是第 1 级与第 2 级的分界
        assert_eq!(st.body("draft-outline").unwrap(), "正文很长很长");
    }

    #[test]
    fn 清单只给名字和说明_不含正文() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "a", "name: a\ndescription: 甲做的事", "甲的正文机密");
        skill(tmp.path(), "b", "name: b\ndescription: 乙做的事", "乙的正文机密");
        let cat = store_of(&tmp).catalog(&[]);

        assert!(cat.contains("甲做的事") && cat.contains("乙做的事"));
        assert!(!cat.contains("机密"), "正文不该出现在第 1 级清单里");
    }

    #[test]
    fn 清单能按配置过滤_没授权的_skill_模型看都看不到() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "a", "name: a\ndescription: 甲", "x");
        skill(tmp.path(), "b", "name: b\ndescription: 乙", "x");
        let cat = store_of(&tmp).catalog(&["a".to_string()]);
        assert!(cat.contains("甲"));
        assert!(!cat.contains("乙"));
    }

    #[test]
    fn 没有_description_的_skill_被跳过并说明原因() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "bad", "name: bad", "正文");
        let st = store_of(&tmp);
        assert!(st.all().is_empty());
        assert!(st.warnings()[0].reason.contains("description"));
    }

    #[test]
    fn 缺_name_时用目录名兜底() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "my-skill", "description: 有说明就够", "正文");
        assert_eq!(store_of(&tmp).all()[0].name, "my-skill");
    }

    #[test]
    fn 没有_frontmatter_的不当成_skill_而不是拿正文去猜() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "plain/SKILL.md", "# 就是一篇普通文档\n没有围栏");
        let st = store_of(&tmp);
        assert!(st.all().is_empty());
        assert!(st.warnings()[0].reason.contains("frontmatter"));
    }

    #[test]
    fn 目录里没有_skill_文件时报出来_不静默跳过() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("空目录")).unwrap();
        let st = store_of(&tmp);
        assert_eq!(st.warnings().len(), 1);
        assert!(st.warnings()[0].reason.contains("没有 SKILL.md"));
    }

    #[test]
    fn 用户的同名_skill_盖过内置的() {
        let builtin = TempDir::new().unwrap();
        let user = TempDir::new().unwrap();
        skill(builtin.path(), "draft", "name: draft\ndescription: 内置版", "内置正文");
        skill(user.path(), "draft", "name: draft\ndescription: 我改的", "我的正文");

        let st = SkillStore::scan(&[
            Root { name: "内置".into(), path: builtin.path().to_path_buf() },
            Root { name: "用户".into(), path: user.path().to_path_buf() },
        ]);
        assert_eq!(st.all().len(), 1, "同名只留一个");
        assert_eq!(st.all()[0].description, "我改的");
        assert_eq!(st.all()[0].source, "用户");
        assert_eq!(st.body("draft").unwrap(), "我的正文");
    }

    #[test]
    fn 附件按需读_这是第三级() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "s", "name: s\ndescription: d", "细节见 references/detail.md");
        write(tmp.path(), "s/references/detail.md", "很长的参考资料");
        let st = store_of(&tmp);
        assert!(st.all()[0].has_references);
        assert_eq!(st.resource("s", "references/detail.md").unwrap(), "很长的参考资料");
    }

    #[test]
    fn 附件路径穿不出_skill_目录_挡住把无关文件读进上下文() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "s", "name: s\ndescription: d", "x");
        write(tmp.path(), "secret.txt", "不该被读到");

        let st = store_of(&tmp);
        let err = st.resource("s", "../secret.txt").unwrap_err();
        assert_eq!(err.code(), "skill");
        // 报错信息里不能把文件内容带出来
        assert!(!err.to_string().contains("不该被读到"));
    }

    #[test]
    fn 读不存在的_skill_报_unknown_skill() {
        let tmp = TempDir::new().unwrap();
        let st = store_of(&tmp);
        assert_eq!(st.body("查无此人").unwrap_err().code(), "unknown_skill");
    }

    #[test]
    fn 根目录不存在时当成没有_skill_不炸() {
        let st = SkillStore::scan(&[Root { name: "没有".into(), path: "/nope/nope".into() }]);
        assert!(st.all().is_empty());
    }

    #[test]
    fn 正文里的_frontmatter_样子的内容不会被误切() {
        let tmp = TempDir::new().unwrap();
        skill(tmp.path(), "s", "name: s\ndescription: d", "示例：\n---\nkey: 这是正文里的例子\n---\n结束");
        assert!(store_of(&tmp).body("s").unwrap().contains("这是正文里的例子"));
    }
}

/// 把 skill 接进一次运行的 preamble。
///
/// 这里体现三级加载：`catalog` 是第 1 级（常驻的名字+说明），`body` 是第 2 级
/// （这一轮真要用它才读）。两者拼法不同 —— 清单是「你有这些东西可用」，
/// 正文是「现在照这份指令干」。
pub fn compose_preamble(persona: &str, catalog: &str, body: Option<&str>) -> String {
    let mut out = persona.trim().to_string();
    if !catalog.trim().is_empty() {
        out.push_str("\n\n");
        out.push_str(catalog.trim());
    }
    if let Some(b) = body.filter(|b| !b.trim().is_empty()) {
        out.push_str("\n\n---\n现在执行下面这个 skill 的指令：\n\n");
        out.push_str(b.trim());
    }
    out
}

#[cfg(test)]
mod compose_tests {
    use super::*;

    #[test]
    fn 只有清单时不出现执行指令那段() {
        let p = compose_preamble("你是编剧。", "- a：甲\n", None);
        assert!(p.contains("你是编剧。"));
        assert!(p.contains("- a：甲"));
        assert!(!p.contains("现在执行"));
    }

    #[test]
    fn 展开正文时人格在前_清单居中_正文在后() {
        let p = compose_preamble("你是编剧。", "- a：甲\n", Some("照这样写大纲"));
        let persona = p.find("你是编剧").unwrap();
        let cat = p.find("- a：甲").unwrap();
        let body = p.find("照这样写大纲").unwrap();
        assert!(persona < cat && cat < body, "顺序错了，正文必须压在最后");
    }

    #[test]
    fn 没有_skill_时就是原来的人格_一个字不多() {
        assert_eq!(compose_preamble("你是编剧。", "", None), "你是编剧。");
        assert_eq!(compose_preamble("你是编剧。", "  \n ", Some("  ")), "你是编剧。");
    }
}

#[cfg(test)]
mod import_tests {
    use super::*;
    use tempfile::TempDir;

    fn skill_src(root: &Path, dirname: &str, front: &str) -> PathBuf {
        let d = root.join(dirname);
        fs::create_dir_all(d.join("references")).unwrap();
        fs::write(d.join("SKILL.md"), format!("---\n{front}\n---\n\n正文\n")).unwrap();
        fs::write(d.join("references/词表.md"), "# 词表").unwrap();
        d
    }

    #[test]
    fn 导入后按_frontmatter_的名字落地_不是源目录名() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let src = skill_src(tmp.path(), "随便起的文件夹名", "name: write-ad-copy\ndescription: 写广告文案");

        let meta = import_dir(&skills, &src).unwrap();
        assert_eq!(meta.name, "write-ad-copy");
        assert!(skills.join("write-ad-copy/SKILL.md").is_file());
        assert!(skills.join("write-ad-copy/references/词表.md").is_file(), "附件要一起带过来");
        assert_eq!(meta.source, "用户");
        assert!(meta.has_references);
    }

    #[test]
    fn 导入之后扫得到_这才叫真的生效() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let src = skill_src(tmp.path(), "src", "name: my-skill\ndescription: 我的");
        import_dir(&skills, &src).unwrap();

        let store = SkillStore::scan(&[Root { name: "用户".into(), path: skills }]);
        assert!(store.get("my-skill").is_some(), "导入完却扫不到，等于没导入");
    }

    #[test]
    fn 没有_skill_md_的目录说清缺什么() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let bare = tmp.path().join("空目录");
        fs::create_dir_all(&bare).unwrap();
        let e = import_dir(&skills, &bare).unwrap_err();
        assert!(e.to_string().contains("SKILL.md"), "{e}");
    }

    #[test]
    fn frontmatter_坏了不导入_而不是导入一个坏的() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let src = skill_src(tmp.path(), "src", "name: x");          // 没有 description
        let e = import_dir(&skills, &src).unwrap_err();
        assert!(e.to_string().contains("description"), "{e}");
        assert!(!skills.join("x").exists(), "校验没过就不该留下目录");
    }

    #[test]
    fn 同名的不覆盖_先让人自己处理() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let src = skill_src(tmp.path(), "a", "name: dup\ndescription: 第一个");
        import_dir(&skills, &src).unwrap();

        let src2 = skill_src(tmp.path(), "b", "name: dup\ndescription: 第二个");
        let e = import_dir(&skills, &src2).unwrap_err();
        assert!(e.to_string().contains("已经有"), "{e}");
        // 原来那个不能被动过
        let text = fs::read_to_string(skills.join("dup/SKILL.md")).unwrap();
        assert!(text.contains("第一个"));
    }

    #[test]
    fn 选了_skills_里面的目录时说不用导入() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let inside = skill_src(&skills, "已经在里面", "name: inner\ndescription: d");
        let e = import_dir(&skills, &inside).unwrap_err();
        assert!(e.to_string().contains("已经在 skills 里"), "{e}");
    }

    #[test]
    fn 文件太多时停下来问_是不是选错了目录() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let src = skill_src(tmp.path(), "巨大目录", "name: big\ndescription: d");
        for i in 0..(MAX_FILES + 5) {
            fs::write(src.join(format!("f{i}.txt")), "x").unwrap();
        }
        let e = import_dir(&skills, &src).unwrap_err();
        assert!(e.to_string().contains("选错了目录"), "{e}");
        assert!(!skills.join("big").exists());
    }

    #[test]
    fn 符号链接不跟随_否则一个指向家目录的链接会把无关文件带进来() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let src = skill_src(tmp.path(), "src", "name: lnk\ndescription: d");
        let outside = tmp.path().join("别的地方");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("秘密.txt"), "不该被复制").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, src.join("链接")).unwrap();

        import_dir(&skills, &src).unwrap();
        assert!(!skills.join("lnk/链接").exists(), "跟着链接复制了");
    }

    #[test]
    fn 名字里有路径分隔符时不落地() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        let src = skill_src(tmp.path(), "src", "name: ../../跑出去\ndescription: d");
        let meta = import_dir(&skills, &src).unwrap();
        // safe_name 把分隔符换掉，落点仍在 skills 里面
        assert!(meta.dir.starts_with(&skills), "{:?}", meta.dir);
    }
}
