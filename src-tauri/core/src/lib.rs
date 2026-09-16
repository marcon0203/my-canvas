//! AI 短视频工厂 · 桌面端核心。
//!
//! **不依赖 tauri**：这个 crate 能在没有 GUI 的环境里编译和测试（CI、容器），
//! 将来也能被 CLI 复用。tauri 那一层只做 IPC 绑定与窗口，薄到几乎没有逻辑。

pub mod agent;
pub mod config;
pub mod error;
pub mod outline;
pub mod providers;
pub mod run;
pub mod shotprompt;
pub mod skills;
pub mod vault;
pub mod workspace;

pub use error::{Error, Result};

/// 取密钥明文的**唯一**出口，给 IPC 层发请求用。
///
/// 刻意不叫 `get_key` 也不放进 `vault` 的公开面：
/// 它只在「马上要发请求」的地方调，调用点一眼可数。
/// 没有任何 IPC 命令直接暴露它 —— 明文不过 IPC 是这套设计的底线。
pub fn vault_key(provider: &str) -> Result<String> {
    vault::load(provider)
}
