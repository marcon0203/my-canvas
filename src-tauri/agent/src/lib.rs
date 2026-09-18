//! 跑模型：把配置装配成 Rig agent，再按链路编排一轮。
//!
//! | 模块 | 管什么 |
//! |---|---|
//! | `agent` | 配置 → AgentSpec → Rig agent |
//! | `run` | 一轮运行的公共骨架（解析、取密钥、拼 preamble、发事件） |
//! | `outline` | 起草大纲那条链路 |
//! | `script` | 写剧本那条链路 |
//! | `assets` | 提取资产那条链路 |
//! | `shots` | 拆镜头那条链路 |
//! | `shotprompt` | 补写提示词那条链路 |
//! | `prompt` | 提示词合成与中译英 |
//! | `structured` | 让模型填一个有 schema 的结构（两条路 + 换路判定） |
//! | `stream` | 从没写完的 JSON 里一边生成一边刨出 `reply` |
//!
//! 取密钥只有 trait（`run::Keys`）在这儿，**真实现不在** —— 见那段注释。
pub mod agent;
pub mod assets;
pub mod expand;
pub mod outline;
pub mod prompt;
pub mod script;
pub mod run;
pub mod shotprompt;
pub mod shots;
pub mod stream;
pub mod structured;
