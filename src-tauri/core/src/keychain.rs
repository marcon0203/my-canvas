//! 密钥保管：只进系统钥匙串，明文既不落盘也不过 IPC。
//!
//! 前端能拿到的只有两样：这家配没配、尾号是什么。
//! 请求由 Rust 发出。
//!
//! **这个模块整体是私有的。** 对外的那一小半在 lib.rs 的 `pub mod vault` 里
//! 逐个点名（状态、写入、清除），`load` 不在其中 —— 明文的唯一出口是
//! `vault_key`。分包时这一点是刻意保住的：把 vault 放进任何一个功能包，
//! `load` 就得变成 pub，而那句「没有任何 IPC 命令能读出明文」就从编译器
//! 保证降级成了约定。

use studio_error::{Error, Result};

const SERVICE: &str = "ai-video-studio";

/// 前端可见的密钥状态。注意没有 key 字段 —— 这是刻意的。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub provider: String,
    pub has_key: bool,
    /// 脱敏尾号，给人确认「是不是那把 key」
    pub hint: Option<String>,
}

/// 尾号提示。短 key 全遮 —— 否则等于把 key 印在界面上
pub fn hint_of(key: &str) -> String {
    let n = key.chars().count();
    if n <= 8 {
        "••••".into()
    } else {
        format!("••••{}", key.chars().skip(n - 4).collect::<String>())
    }
}

fn entry(provider: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, provider).map_err(|e| Error::Vault(e.to_string()))
}

pub fn set(provider: &str, key: &str) -> Result<KeyStatus> {
    entry(provider)?
        .set_password(key)
        .map_err(|e| Error::Vault(e.to_string()))?;
    Ok(KeyStatus {
        provider: provider.into(),
        has_key: true,
        hint: Some(hint_of(key)),
    })
}

pub fn clear(provider: &str) -> Result<KeyStatus> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(KeyStatus {
            provider: provider.into(),
            has_key: false,
            hint: None,
        }),
        Err(e) => Err(Error::Vault(e.to_string())),
    }
}

pub fn status(provider: &str) -> Result<KeyStatus> {
    match entry(provider)?.get_password() {
        Ok(k) => Ok(KeyStatus {
            provider: provider.into(),
            has_key: true,
            hint: Some(hint_of(&k)),
        }),
        Err(keyring::Error::NoEntry) => Ok(KeyStatus {
            provider: provider.into(),
            has_key: false,
            hint: None,
        }),
        Err(e) => Err(Error::Vault(e.to_string())),
    }
}

/// 取明文。**crate 内部可见**：只有发请求的地方用得到，没有 IPC 命令能调到它。
pub(crate) fn load(provider: &str) -> Result<String> {
    entry(provider)?
        .get_password()
        .map_err(|_| Error::NoKey(provider.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 尾号只露最后四位_短密钥全遮() {
        assert_eq!(hint_of("sk-1234567890ab"), "••••90ab");
        assert_eq!(hint_of("short"), "••••");
        assert_eq!(hint_of(""), "••••");
    }

    #[test]
    fn 状态结构里没有明文字段() {
        let s = KeyStatus { provider: "deepseek".into(), has_key: true, hint: Some("••••1234".into()) };
        let v = serde_json::to_value(&s).unwrap();
        assert!(v.get("key").is_none(), "KeyStatus 绝不能带明文");
        assert_eq!(v["hasKey"], true);
        assert_eq!(v["hint"], "••••1234");
    }
}
