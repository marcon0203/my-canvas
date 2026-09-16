//! IPC 绑定。这一层**不放逻辑** —— 每个命令都薄到只做「转发 + 错误透传」，
//! 真正的实现在 studio-core，那边没有 GUI 依赖，能单独测。
//!
//! 命令面刻意与前端 `src/api/` 的接缝对齐：前端换 transport 时不用改调用方。

use std::collections::HashMap;
use studio_core::agent::{self, AgentSpec};
use studio_core::config::{AgentConfig, ModelRef, ProviderSetting};
use studio_core::vault::{self, KeyStatus};
use studio_core::Result;

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

/* ---------------- Agent：解析配置，报错要在建之前发生 ---------------- */

/// 只解析不建 —— 让设置界面能在「还没花钱」的时候就把配置问题暴露出来。
#[tauri::command]
fn agent_resolve(
    cfg: AgentConfig,
    fallback_preamble: String,
    globals: HashMap<String, ModelRef>,
    providers: HashMap<String, ProviderSetting>,
) -> Result<AgentSpec> {
    agent::resolve(&cfg, &fallback_preamble, &globals, &providers)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            vault_set,
            vault_clear,
            vault_status,
            agent_resolve,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
