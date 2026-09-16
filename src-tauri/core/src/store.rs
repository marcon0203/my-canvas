//! 落盘：配置与项目都是工作空间里的文件，没有数据库。
//!
//! ```text
//! <workspace>/
//! ├── config/
//! │   ├── providers.json   厂商端点、启用状态、自加的模型
//! │   ├── agents.json      每个 Agent 的配置
//! │   └── app.json         全局默认模型这类
//! └── projects/<id>/
//!     ├── project.json     元信息
//!     ├── outline.md       大纲（人能改）
//!     ├── script/*.md      剧本块，一场一个文件
//!     ├── assets.json
//!     └── shots.json
//! ```
//!
//! **密钥不在这里**。它写在系统钥匙串里，工作空间整个复制走也带不走密钥 ——
//! 这是刻意的：用户会把这个目录放进网盘同步。
//!
//! 为什么不上 SQLite：这些数据的规模是「一个人手上的几十个项目」，
//! 文件读起来够快，而且**出问题时能用编辑器打开看**。
//! 数据库换来的并发与事务，单机单人的场景里用不上。

use crate::error::{Error, Result};
use serde::{Serialize, de::DeserializeOwned};
use std::path::{Path, PathBuf};

/// 写文件：先写同目录下的临时文件再 rename。
///
/// **不要直接覆盖写**：写到一半断电/崩溃会留下一个半截的 JSON，
/// 下次启动就是「项目打不开」。rename 在同一文件系统上是原子的，
/// 要么是旧的完整内容，要么是新的完整内容。
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().ok_or_else(|| Error::Store(format!("{} 没有父目录", path.display())))?;
    std::fs::create_dir_all(dir)
        .map_err(|e| Error::Store(format!("建不了 {}：{e}", dir.display())))?;
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|s| s.to_str()).unwrap_or("")
    ));
    std::fs::write(&tmp, bytes)
        .map_err(|e| Error::Store(format!("写不了 {}：{e}", tmp.display())))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        Error::Store(format!("落盘 {} 失败：{e}", path.display()))
    })
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let s = serde_json::to_vec_pretty(value)
        .map_err(|e| Error::Store(format!("序列化 {} 失败：{e}", path.display())))?;
    write_atomic(path, &s)
}

pub fn write_text(path: &Path, text: &str) -> Result<()> {
    write_atomic(path, text.as_bytes())
}

/// 读 JSON。**文件不存在返回默认值**（第一次跑就是这样，不是错误）；
/// 存在但坏了就报错 —— 那种情况下拿默认值顶上会把用户的数据悄悄覆盖掉。
pub fn read_json<T: DeserializeOwned + Default>(path: &Path) -> Result<T> {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(T::default()),
        Err(e) => return Err(Error::Store(format!("读不了 {}：{e}", path.display()))),
    };
    if raw.trim().is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(&raw)
        .map_err(|e| Error::Store(format!("{} 内容坏了：{e}", path.display())))
}

pub fn read_text(path: &Path) -> Result<String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(Error::Store(format!("读不了 {}：{e}", path.display()))),
    }
}

/// 配置分几个文件而不是一个大 JSON：改 Agent 配置不该动到厂商那份，
/// 一个文件坏了也只坏一块。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigFile {
    Providers,
    Agents,
    App,
}

impl ConfigFile {
    pub fn name(self) -> &'static str {
        match self {
            ConfigFile::Providers => "providers.json",
            ConfigFile::Agents => "agents.json",
            ConfigFile::App => "app.json",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "providers" => Some(ConfigFile::Providers),
            "agents" => Some(ConfigFile::Agents),
            "app" => Some(ConfigFile::App),
            _ => None,
        }
    }
}

pub fn config_dir(root: &Path) -> PathBuf {
    root.join("config")
}

pub fn config_path(root: &Path, which: ConfigFile) -> PathBuf {
    config_dir(root).join(which.name())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[derive(Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
    struct Cfg {
        a: String,
        n: u32,
    }

    #[test]
    fn 文件不存在时给默认值_第一次跑不该报错() {
        let tmp = TempDir::new().unwrap();
        let v: Cfg = read_json(&tmp.path().join("没有.json")).unwrap();
        assert_eq!(v, Cfg::default());
    }

    #[test]
    fn 内容坏了要报错_而不是拿默认值把用户数据顶掉() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("坏.json");
        std::fs::write(&p, "{ 这不是 json").unwrap();
        let e = read_json::<Cfg>(&p).unwrap_err();
        assert_eq!(e.code(), "store");
        assert!(e.to_string().contains("坏了"));
    }

    #[test]
    fn 空文件当成默认值_编辑器存了个空文件不算坏() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("空.json");
        std::fs::write(&p, "   \n").unwrap();
        assert_eq!(read_json::<Cfg>(&p).unwrap(), Cfg::default());
    }

    #[test]
    fn 写了能读回来_父目录自动建() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("深/一点/的/cfg.json");
        let v = Cfg { a: "中文也行".into(), n: 7 };
        write_json(&p, &v).unwrap();
        assert_eq!(read_json::<Cfg>(&p).unwrap(), v);
    }

    #[test]
    fn 原子写不留临时文件() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("cfg.json");
        write_json(&p, &Cfg { a: "x".into(), n: 1 }).unwrap();
        let left: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(left, ["cfg.json"], "临时文件不该留下来");
    }

    #[test]
    fn 覆盖写不会读到半截内容() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("cfg.json");
        write_json(&p, &Cfg { a: "第一版".into(), n: 1 }).unwrap();
        write_json(&p, &Cfg { a: "第二版".into(), n: 2 }).unwrap();
        assert_eq!(read_json::<Cfg>(&p).unwrap(), Cfg { a: "第二版".into(), n: 2 });
    }

    #[test]
    fn 文本文件不存在时给空串_不是错误() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(read_text(&tmp.path().join("没有.md")).unwrap(), "");
    }

    #[test]
    fn 配置分成三个文件_改一块不动另一块() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write_json(&config_path(root, ConfigFile::Providers), &Cfg { a: "厂商".into(), n: 1 }).unwrap();
        write_json(&config_path(root, ConfigFile::Agents), &Cfg { a: "智能体".into(), n: 2 }).unwrap();
        // 再写一次厂商，智能体那份不受影响
        write_json(&config_path(root, ConfigFile::Providers), &Cfg { a: "改过".into(), n: 9 }).unwrap();
        let ag: Cfg = read_json(&config_path(root, ConfigFile::Agents)).unwrap();
        assert_eq!(ag.a, "智能体");
    }

    #[test]
    fn 配置名只认这三个_乱填的挡住() {
        assert!(ConfigFile::parse("providers").is_some());
        for bad in ["", "secrets", "../../etc/passwd", "Providers"] {
            assert!(ConfigFile::parse(bad).is_none(), "{bad} 不该被接受");
        }
    }
}
