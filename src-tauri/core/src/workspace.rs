//! 工作空间：用户数据的**唯一**落脚点。
//!
//! ```text
//! ~/.hitv/                 ← 默认；用户可以改到任意目录
//! ├── skills/              用户自己放的 skill，盖过内置同名的
//! └── projects/            项目数据
//! ```
//!
//! 为什么要有这个东西：Agent 跑起来时要读 skill、要读写项目，这些路径原来散在
//! 各处（skill 在 app_data_dir，项目还没落盘）。收成一个根目录之后，
//! 「我的数据在哪」有一个能回答的答案，备份、换机器、放进网盘同步都成立。
//!
//! **工作空间路径本身不存在工作空间里** —— 那是先有鸡还是先有蛋。
//! 它由前端持久化，每次调用时传进来，与 providers / globals 的处理方式一致；
//! 这一层只负责解析与校验，不碰存储。

use crate::error::{Error, Result};
use std::path::{Path, PathBuf};

/// 默认目录名，挂在用户 home 下
pub const DEFAULT_DIR: &str = ".hitv";

/// 工作空间下的子目录。列在这里是为了界面能如实说明「这个目录里会有什么」，
/// 以及 `ensure` 知道要建哪些。
pub const SUBDIRS: &[(&str, &str, bool)] = &[
    // (目录名, 说明, 现在是否真的在用)
    ("skills", "用户自己放的 skill，与内置同名时盖过内置", true),
    ("projects", "项目数据", false),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// 用户没指定，用的 ~/.hitv
    Default,
    /// 用户在设置里指定的
    User,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub root: PathBuf,
    pub source: Source,
}

/// 展开开头的 `~`。只认开头那一个 —— 路径中间的 `~` 是合法文件名。
pub fn expand(raw: &str, home: &Path) -> PathBuf {
    let t = raw.trim();
    if t == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = t.strip_prefix("~/").or_else(|| t.strip_prefix("~\\")) {
        return home.join(rest);
    }
    PathBuf::from(t)
}

/// 校验一个用户填的路径能不能当工作空间。
///
/// 只做**不碰磁盘就能判**的检查，加上「是不是已经被一个文件占了」。
/// 目录不存在不算错 —— 那是 `ensure` 的活儿，用户填一个还没建的目录很正常。
pub fn validate(raw: &str, home: &Path) -> Result<PathBuf> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(Error::Workspace("工作空间路径不能为空".into()));
    }
    let p = expand(t, home);
    if !p.is_absolute() {
        return Err(Error::Workspace(format!(
            "要填绝对路径，{t} 是相对的 —— 相对谁取决于应用从哪儿启动，换个方式打开就指到别处了"
        )));
    }
    if p.is_file() {
        return Err(Error::Workspace(format!("{} 是个文件，不是目录", p.display())));
    }
    Ok(p)
}

/// 解析当前工作空间。`configured` 为空（或全是空白）时用默认的。
pub fn resolve(configured: Option<&str>, home: &Path) -> Result<Workspace> {
    match configured.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => Ok(Workspace { root: validate(raw, home)?, source: Source::User }),
        None => Ok(Workspace { root: home.join(DEFAULT_DIR), source: Source::Default }),
    }
}

/// 取当前用户的 home。拿不到时说清楚，不要瞎猜一个路径。
pub fn home() -> Result<PathBuf> {
    std::env::home_dir().ok_or_else(|| Error::Workspace("读不到当前用户的 home 目录".into()))
}

impl Workspace {
    pub fn skills(&self) -> PathBuf {
        self.root.join("skills")
    }

    pub fn projects(&self) -> PathBuf {
        self.root.join("projects")
    }

    /// 把目录建出来。**只建，不动已有内容** —— 换工作空间不会搬数据，
    /// 也不会删旧的；那种事得用户自己决定，替他搬是在拿他的东西冒险。
    pub fn ensure(&self) -> Result<()> {
        std::fs::create_dir_all(&self.root)
            .map_err(|e| Error::Workspace(format!("建不了 {}：{e}", self.root.display())))?;
        for (name, _, used) in SUBDIRS {
            if !used {
                continue;       // 还没用上的目录先不建，免得目录里一堆空壳
            }
            let p = self.root.join(name);
            std::fs::create_dir_all(&p)
                .map_err(|e| Error::Workspace(format!("建不了 {}：{e}", p.display())))?;
        }
        Ok(())
    }

    /// 这个目录现在能不能写。界面要在用户改路径之前就告诉他。
    pub fn writable(&self) -> bool {
        let probe = self.root.join(".hitv-write-probe");
        if std::fs::create_dir_all(&self.root).is_err() {
            return false;
        }
        match std::fs::write(&probe, b"") {
            Ok(_) => {
                let _ = std::fs::remove_file(&probe);
                true
            }
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const HOME: &str = "/home/someone";

    fn h() -> &'static Path {
        Path::new(HOME)
    }

    #[test]
    fn 没指定时落在_home_下的_hitv() {
        let w = resolve(None, h()).unwrap();
        assert_eq!(w.root, Path::new("/home/someone/.hitv"));
        assert_eq!(w.source, Source::Default);
    }

    #[test]
    fn 空串和全空白都当成没指定_而不是当成根目录() {
        for raw in ["", "   ", "\t\n"] {
            let w = resolve(Some(raw), h()).unwrap();
            assert_eq!(w.source, Source::Default, "{raw:?} 该走默认");
        }
    }

    #[test]
    fn 波浪号展开到_home() {
        assert_eq!(expand("~/片子", h()), Path::new("/home/someone/片子"));
        assert_eq!(expand("~", h()), Path::new(HOME));
    }

    #[test]
    fn 路径中间的波浪号不动_那是合法文件名() {
        assert_eq!(expand("/data/~backup", h()), Path::new("/data/~backup"));
    }

    #[test]
    fn 相对路径被拒_并说清为什么() {
        let e = validate("./data", h()).unwrap_err();
        assert_eq!(e.code(), "workspace");
        assert!(e.to_string().contains("绝对路径"));
    }

    #[test]
    fn 指到一个已存在的文件时报错() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("不是目录.txt");
        std::fs::write(&f, b"x").unwrap();
        let e = validate(f.to_str().unwrap(), h()).unwrap_err();
        assert!(e.to_string().contains("文件"));
    }

    #[test]
    fn 目录还不存在不算错_那是_ensure_的活儿() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("还没建");
        assert!(validate(p.to_str().unwrap(), h()).is_ok());
    }

    #[test]
    fn ensure_只建在用的子目录_不留一堆空壳() {
        let tmp = TempDir::new().unwrap();
        let w = Workspace { root: tmp.path().join("ws"), source: Source::User };
        w.ensure().unwrap();
        assert!(w.skills().is_dir(), "skills 现在真的在用，要建出来");
        assert!(!w.projects().exists(), "projects 还没用上，先别建");
    }

    #[test]
    fn ensure_可以重复跑_不动已有内容() {
        let tmp = TempDir::new().unwrap();
        let w = Workspace { root: tmp.path().to_path_buf(), source: Source::User };
        w.ensure().unwrap();
        std::fs::write(w.skills().join("我的东西.txt"), "别动我").unwrap();
        w.ensure().unwrap();
        assert_eq!(std::fs::read_to_string(w.skills().join("我的东西.txt")).unwrap(), "别动我");
    }

    #[test]
    fn 子目录挂在根下_换根整套跟着走() {
        let w = resolve(Some("/data/hitv"), h()).unwrap();
        assert_eq!(w.skills(), Path::new("/data/hitv/skills"));
        assert_eq!(w.projects(), Path::new("/data/hitv/projects"));
        assert_eq!(w.source, Source::User);
    }

    #[test]
    fn 可写探测_建得出来就是可写() {
        let tmp = TempDir::new().unwrap();
        let w = Workspace { root: tmp.path().join("ws"), source: Source::User };
        assert!(w.writable());
        // 探针文件不留下
        assert!(!w.root.join(".hitv-write-probe").exists());
    }
}
