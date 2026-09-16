//! AI 短视频工厂 · 桌面端核心。
//!
//! **不依赖 tauri**：这个 crate 能在没有 GUI 的环境里编译和测试（CI、容器），
//! 将来也能被 CLI 复用。tauri 那一层只做 IPC 绑定与窗口，薄到几乎没有逻辑。

pub mod agent;
pub mod config;
pub mod error;
pub mod providers;
pub mod vault;

pub use error::{Error, Result};
