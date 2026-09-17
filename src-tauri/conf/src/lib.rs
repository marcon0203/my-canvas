//! 配置与权限：**谁能用什么、能做到哪一档**。
//!
//! | 模块 | 管什么 |
//! |---|---|
//! | `config` | Agent 配置、模型引用、厂商设置（与前端 store 同形） |
//! | `policy` | 工具的风险档与自主上限 —— 闸门的判据 |
//! | `providers` | 厂商默认端点的解析 |
//!
//! `policy` 在这儿而不是在 tools 里：`config` 要用它（autoMax 是一个 Risk），
//! 而 config 不该依赖工具层。
pub mod config;
pub mod policy;
pub mod providers;
