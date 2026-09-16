//! IPC 绑定。这一层**不放逻辑** —— 每个命令都薄到只做「转发 + 错误透传」，
//! 真正的实现在 studio-core，那边没有 GUI 依赖，能单独测。
//!
//! 命令面刻意与前端 `src/api/` 的接缝对齐：前端换 transport 时不用改调用方。

use std::collections::HashMap;
use studio_core::Result;
use studio_core::agent::{self, AgentSpec};
use studio_core::config::{AgentConfig, ModelRef, ProviderSetting};
use studio_core::outline::OutlineInput;
use studio_core::run::{self, RunEvent};
use studio_core::shotprompt::PromptInput;
use studio_core::vault::{self, KeyStatus};

/* ---------------- 密钥：明文只进钥匙串，出不来 ---------------- */

#[tauri::command]
fn vault_set(provider: String, key: String) -> Result<KeyStatus> {
    vault::set(&provider, &key)
}

#[tauri::command]
fn vault_clear(provider: String) -> Result<KeyStatus> {
    vault::clear(&provider)
}

#[tauri::command]
fn vault_status(providers: Vec<String>) -> Result<Vec<KeyStatus>> {
    providers.iter().map(|p| vault::status(p)).collect()
}

/* ---------------- Agent ---------------- */

/// 只解析不跑 —— 让设置界面能在「还没花钱」的时候就把配置问题暴露出来。
#[tauri::command]
fn agent_resolve(
    cfg: AgentConfig,
    fallback_preamble: String,
    globals: HashMap<String, ModelRef>,
    providers: HashMap<String, ProviderSetting>,
) -> Result<AgentSpec> {
    agent::resolve(&cfg, &fallback_preamble, &globals, &providers)
}

/// 起草大纲。
///
/// 这里**只做转发**：事件类型与编排都在 studio_core::run —— 那边能编译能测，
/// 而这一层在没有 GUI 系统库的机器上编译不了，放逻辑等于没被检查过。
#[tauri::command]
async fn agent_outline_draft(
    cfg: AgentConfig,
    fallback_preamble: String,
    globals: HashMap<String, ModelRef>,
    providers: HashMap<String, ProviderSetting>,
    input: OutlineInput,
    on_event: tauri::ipc::Channel<RunEvent>,
) {
    run::outline_draft(
        run::OutlineRun {
            cfg: &cfg,
            fallback_preamble: &fallback_preamble,
            globals: &globals,
            providers: &providers,
            input: &input,
        },
        move |e: RunEvent| {
            let _ = on_event.send(e);
        },
        run::SystemKeys,
    )
    .await;
}

/// 补写提示词。与起草大纲同一套编排，只换输入与产物。
#[tauri::command]
async fn agent_shots_prompt(
    cfg: AgentConfig,
    fallback_preamble: String,
    globals: HashMap<String, ModelRef>,
    providers: HashMap<String, ProviderSetting>,
    input: PromptInput,
    on_event: tauri::ipc::Channel<RunEvent>,
) {
    run::shots_prompt(
        run::PromptRun {
            cfg: &cfg,
            fallback_preamble: &fallback_preamble,
            globals: &globals,
            providers: &providers,
            input: &input,
        },
        move |e: RunEvent| {
            let _ = on_event.send(e);
        },
        run::SystemKeys,
    )
    .await;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            vault_set,
            vault_clear,
            vault_status,
            agent_resolve,
            agent_outline_draft,
            agent_shots_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
