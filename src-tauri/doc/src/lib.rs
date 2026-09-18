//! 文档与落盘：项目在磁盘上长什么样。
//!
//! | 模块 | 管什么 |
//! |---|---|
//! | `md` | Markdown 与 frontmatter：人要直接读改的东西走这条 |
//! | `store` | 原子写、读缺省、配置文件名白名单 |
//! | `project` | 一个项目 = 一个目录下的一组文件 |
//! | `timeline` | 成片顺序与字幕（结构化记录，走 JSON） |
//! | `render` | 拼片：时间线 + 片段文件 → 一个 mp4（shell 出去调 ffmpeg） |
//! | `workspace` | 数据放哪儿（`~/.hitv` 或用户指定） |
//!
//! 这一层**只管存取**，不知道模型、不知道工具。所以它编译得快、测得动，
//! 上面几层出问题时也能单独验证「磁盘上那份对不对」。

pub mod md;
pub mod project;
pub mod render;
pub mod store;
pub mod timeline;
pub mod workspace;
