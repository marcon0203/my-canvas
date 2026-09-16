//! Skill 加载：磁盘上的文件夹 → 三级渐进披露。
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

use crate::error::{Error, Result};
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

/// 把 SKILL.md 切成 frontmatter 与正文。
///
/// 只认开头的 `---` 围栏。没有围栏就是整篇都是正文 —— 那样没有 description，
/// 调用方会把它当成坏 skill 跳过，而不是拿正文去猜。
pub(crate) fn split_front(text: &str) -> Option<(&str, &str)> {
    split(text)
}

fn split(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix("---")?.trim_start_matches(['\r']).strip_prefix('\n')?;
    let end = rest.find("\n---")?;
    let body = rest[end + 4..].trim_start_matches(['\r', '\n']);
    Some((&rest[..end], body))
}

/// 只读 frontmatter，正文原样留在磁盘上 —— 这就是第 1 级。
fn parse_meta(dir: &Path, source: &str, text: &str) -> std::result::Result<SkillMeta, String> {
    let (front, _) = split(text).ok_or("SKILL.md 开头没有 --- 围起来的 frontmatter")?;
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
        let (_, body) = split(&text)
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
