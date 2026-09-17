//! 厂商端点解析。
//!
//! 内置默认端点与前端 `domain/providers/catalog.ts` 保持一致，
//! 但**用户在设置里改过的优先** —— 目录只是种子，端点会变。

use crate::config::ProviderSetting;
use studio_error::{Error, Result};

/// 内置默认端点。与前端目录同源；改一边要改另一边（有测试盯着字段齐全）。
pub const DEFAULT_BASE_URL: &[(&str, &str)] = &[
    ("volcengine", "https://ark.cn-beijing.volces.com/api/v3"),
    ("deepseek", "https://api.deepseek.com"),
    ("zhipu", "https://open.bigmodel.cn/api/paas/v4"),
    ("bailian", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    ("hunyuan", "https://api.hunyuan.cloud.tencent.com/v1"),
    ("moonshot", "https://api.moonshot.cn/v1"),
    // 自定义端点没有默认值，必须用户填
    ("custom", ""),
];

pub fn default_base_url(provider: &str) -> Option<&'static str> {
    DEFAULT_BASE_URL
        .iter()
        .find(|(id, _)| *id == provider)
        .map(|(_, url)| *url)
}

/// 实际要用的端点：用户改过的优先，否则内置默认。空端点是错误 —— 别拿空串去发请求。
pub fn resolve_base_url(provider: &str, setting: Option<&ProviderSetting>) -> Result<String> {
    if let Some(s) = setting
        && let Some(u) = s.base_url.as_deref().map(str::trim)
        && !u.is_empty()
    {
        return Ok(u.trim_end_matches('/').to_string());
    }
    let d = default_base_url(provider).ok_or_else(|| Error::UnknownProvider(provider.into()))?;
    if d.is_empty() {
        return Err(Error::NoBaseUrl { provider: provider.into() });
    }
    Ok(d.trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setting(url: Option<&str>) -> ProviderSetting {
        ProviderSetting {
            id: "custom".into(),
            base_url: url.map(Into::into),
            disabled: false,
        }
    }

    #[test]
    fn 六家国内厂商加自定义端点都在目录里() {
        for id in ["volcengine", "deepseek", "zhipu", "bailian", "hunyuan", "moonshot", "custom"] {
            assert!(default_base_url(id).is_some(), "缺 {id}");
        }
    }

    #[test]
    fn 除自定义外都有_https_默认端点() {
        for (id, url) in DEFAULT_BASE_URL {
            if *id == "custom" {
                assert!(url.is_empty());
            } else {
                assert!(url.starts_with("https://"), "{id} 的端点不是 https");
            }
        }
    }

    #[test]
    fn 用户改过的端点优先_且去掉尾部斜杠() {
        let s = setting(Some("http://localhost:11434/v1/"));
        assert_eq!(resolve_base_url("deepseek", Some(&s)).unwrap(), "http://localhost:11434/v1");
    }

    #[test]
    fn 空白端点当没填_回落到内置默认() {
        let s = setting(Some("   "));
        assert_eq!(
            resolve_base_url("deepseek", Some(&s)).unwrap(),
            "https://api.deepseek.com"
        );
    }

    #[test]
    fn 自定义端点没填就报错_不拿空串去发请求() {
        let e = resolve_base_url("custom", None).unwrap_err();
        assert_eq!(e.code(), "no_base_url");
    }

    #[test]
    fn 不认识的厂商报错() {
        assert_eq!(resolve_base_url("不存在", None).unwrap_err().code(), "unknown_provider");
    }
}
