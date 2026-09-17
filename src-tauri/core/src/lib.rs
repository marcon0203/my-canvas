//! AI 短视频工厂 · 桌面端门面。
//!
//! 功能都在下面几个包里（见 `src-tauri/Cargo.toml` 那张图）。这一层做两件事：
//!
//! 1. **把它们按原来的模块名再导出一遍** —— `studio_core::project::…` 这类
//!    路径不用跟着分包动，IPC 层一行都不改。
//! 2. **看住密钥**：`vault` 只住在这儿，`vault::load` 不 pub 出去，
//!    `run::Keys` 的系统钥匙串实现也在这儿。分包不能把「明文不过 IPC」
//!    从编译器保证降级成约定。
//!
//! 这个 crate 仍然**不依赖 tauri**：没有 GUI 的环境（CI、容器）里照样编译。

// 文件名叫 keychain，公开面叫 vault（下面那个 pub mod）——
// 这样 `load` 能留在私有模块里，而 IPC 层用的那几个照旧从 `vault::` 拿。
mod keychain;

pub use studio_error::{Error, Result};

// 按功能包再导出。名字与分包前一致 —— 换成 studio_doc::project 那种写法
// 会让调用方跟着知道「它现在住哪个包」，而那件事调用方不需要知道。
pub use studio_conf::{config, policy, providers};
pub use studio_doc::{md, project, store, timeline, workspace};
pub use studio_net::{generate, web};
pub use studio_skill as skills;
pub use studio_tools::{patch, tools};
pub use studio_agent::{agent, outline, prompt, shotprompt};

/// 跑一轮：编排在 `studio_agent::run`，**取密钥的真实现在这儿**。
///
/// 拆成两处是为了让 `vault::load` 能一直是私有的 —— 见 `run::Keys` 上的注释。
pub mod run {
    pub use studio_agent::run::*;

    /// 真实现：系统钥匙串。
    ///
    /// 它在门面 crate 里，紧挨着 `vault` —— 这样 `vault::load` 不必为了被
    /// `studio_agent` 调用而变成公开的。
    pub struct SystemKeys;

    impl Keys for SystemKeys {
        fn get(&self, provider: &str) -> crate::Result<String> {
            crate::keychain::load(provider)
        }
    }
}

/// 密钥：状态与读写。
///
/// **`load` 刻意不在这儿。** 公开面上只有「配没配、尾号是什么、写入、清除」——
/// 明文的唯一出口是 `vault_key`，它在「马上要发请求」的地方调，调用点一眼可数。
pub mod vault {
    pub use crate::keychain::{KeyStatus, clear, hint_of, set, status};
}

/// 取密钥明文的**唯一**出口，给 IPC 层发请求用。
///
/// 刻意不叫 `get_key` 也不放进 `vault` 的公开面：
/// 它只在「马上要发请求」的地方调，调用点一眼可数。
/// 没有任何 IPC 命令直接暴露它 —— 明文不过 IPC 是这套设计的底线。
pub fn vault_key(provider: &str) -> Result<String> {
    keychain::load(provider)
}
