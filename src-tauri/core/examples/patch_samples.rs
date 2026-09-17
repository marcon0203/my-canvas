//! 生成前端要拿来对答案的几份 fixture：
//!
//! - `src/store/__fixtures__/rust-patches.json` —— 每个写类工具算出的真补丁
//! - `src/domain/prompt/__fixtures__/rust-prompts.json` —— 提示词合成结果
//! - `src/domain/agent/__fixtures__/rust-gate.json` —— 闸门判定表
//!
//! 为什么要有这个：补丁的形状两侧各有一份定义（Rust 的 json! 与 TS 的
//! `ProposalPatch`）。对不上的那天，界面会「采纳成功」但项目里什么都没变 ——
//! 不报错、不留日志。所以前端那个 store 测试不手写 JSON，喂的是这份真货。
//!
//! 改了补丁形状之后重新生成：
//!
//! ```sh
//! npm run fixtures     # = cargo run -p studio-core --example patch_samples
//! ```
//!
//! Rust 侧有 `patch::tests::样本文件与当前实现一致` 盯着：忘了重新生成，
//! `cargo test` 会失败并告诉你跑哪条命令 —— 不会静静地过。
//!
//! 只读一个临时项目，不碰用户数据。

use studio_core::{patch, prompt, tools};

fn main() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    for (rel, v) in [
        (patch::SAMPLES_PATH, patch::samples()),
        (prompt::SAMPLES_PATH, prompt::samples()),
        (tools::GATE_TABLE_PATH, tools::gate_table()),
    ] {
        let path = dir.join(rel);
        std::fs::write(&path, studio_core::store::pretty_json(&v)).expect("写 fixture");
        eprintln!("已写入 {}", path.display());
    }
}
