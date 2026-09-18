//! AI 短视频工厂 · 桌面端门面。
//!
//! 功能都在下面几个包里（见 `src-tauri/Cargo.toml` 那张图）。这一层做两件事：
//!
//! 1. **把它们按原来的模块名再导出一遍** —— `studio_core::project::…` 这类
//!    路径不用跟着分包动，IPC 层一行都不改。
//! 2. **看住密钥**：明文的唯一出口是 `vault_key`，`run::Keys` 的真实现也在
//!    这儿。分包不能把「明文不过 IPC」从编译器保证降级成约定。
//!
//! 这个 crate 仍然**不依赖 tauri**：没有 GUI 的环境（CI、容器）里照样编译。

pub use studio_error::{Error, Result};

// 按功能包再导出。名字与分包前一致 —— 换成 studio_doc::project 那种写法
// 会让调用方跟着知道「它现在住哪个包」，而那件事调用方不需要知道。
pub use studio_conf::{config, policy, providers, provfile};
pub use studio_doc::{md, project, store, timeline, workspace};
pub use studio_net::{generate, web};
pub use studio_skill as skills;
pub use studio_tools::{patch, tools};
pub use studio_agent::{agent, expand, outline, prompt, shotprompt};

/// 跑一轮：编排在 `studio_agent::run`，**取密钥的真实现在这儿**。
pub mod run {
    pub use studio_agent::run::*;

    /// 真实现：读 `<workspace>/providers/<id>.yaml` 里的 `apikey`。
    ///
    /// 它在门面 crate 里而不是 `studio_agent` 里 —— 这样「取明文」这件事的
    /// 实现只有一处，`studio_agent` 只认识那个 trait。
    ///
    /// 带着工作空间根目录：密钥跟工作空间走，换机器把目录拷过去就能用。
    pub struct SystemKeys(pub std::path::PathBuf);

    impl Keys for SystemKeys {
        fn get(&self, provider: &str) -> crate::Result<String> {
            crate::vault_key(&self.0, provider)
        }
    }
}

/// 取密钥明文的**唯一**出口，给 IPC 层发请求用。
///
/// 刻意单独放一个函数、名字也不叫 `get_key`：它只在「马上要发请求」的地方调，
/// 调用点一眼可数。没有任何 IPC 命令直接暴露它 —— 明文不过 IPC 是这套设计的底线。
///
/// **出去的那一半由类型保证**：`provfile::View`（送去前端的形状）没有 apikey
/// 字段，有测试钉着。所以这条底线不靠「记得别带出去」，靠的是那个结构里
/// 根本没有那个字段。
pub fn vault_key(root: &std::path::Path, provider: &str) -> Result<String> {
    provfile::apikey(root, provider)
}
