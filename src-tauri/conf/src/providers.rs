//! 厂商端点解析。
//!
//! **支持哪几家**这份清单不写在代码里，而是 `resources/models/providers.json`：
//! 前端打包时读它，这里编译期 `include_str!` 读它。以前两边各抄一份，注释写着
//! 「改一边要改另一边」—— 那种约定迟早失守，而端点对不上时报的错指不到原因。
//!
//! 编译期嵌入而不是运行时读文件：这份清单是程序的一部分，跟着版本走，
//! 运行时找不到文件就没有端点可用，那不是一个能在界面上处理的错误。
//!
//! **用户在设置里改过的端点优先** —— 清单只是种子，端点会变（企业版、自建网关）。

use crate::config::ProviderSetting;
use studio_error::{Error, Result};
use std::sync::LazyLock;

/// 与前端同源的那份清单原文
const CATALOG_JSON: &str = include_str!("../../../resources/models/providers.json");

/// 一家供应商。字段与前端 `domain/providers/model.ts` 的 `ProviderSpec` 对齐；
/// 这边只用到 id 和 base_url，其余留着是为了「多一个字段前端有、这边没有」时
/// 解析不会静默丢掉 —— serde 默认忽略未知字段，那种丢失查起来很费劲。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub en: String,
    /// 默认端点。自定义端点这里是空串，必须用户填
    pub base_url: String,
    #[serde(default)]
    pub console: Option<String>,
    #[serde(default)]
    pub docs: Option<String>,
    /// 端点和模型全靠用户填的那种（自建网关、Ollama、公司内网代理）
    #[serde(default)]
    pub user_defined: bool,
}

#[derive(serde::Deserialize)]
struct Catalog {
    /// 文件开头给人看的一段话，解析时用不上，但 `deny_unknown_fields` 要认它
    #[allow(dead_code)]
    #[serde(default)]
    note: String,
    providers: Vec<Provider>,
}

/// 系统支持哪几家。解析失败直接 panic：这是编译进来的自家文件，
/// 格式不对是发布前就该炸的事，不是运行时要处理的错误（有测试盯着）。
pub static PROVIDERS: LazyLock<Vec<Provider>> = LazyLock::new(|| {
    serde_json::from_str::<Catalog>(CATALOG_JSON)
        .expect("resources/models/providers.json 格式不对")
        .providers
});

pub fn provider_of(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

pub fn default_base_url(provider: &str) -> Option<&'static str> {
    provider_of(provider).map(|p| p.base_url.as_str())
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
    fn 六家国内厂商加自定义端点都在清单里() {
        for id in ["volcengine", "deepseek", "zhipu", "bailian", "hunyuan", "moonshot", "custom"] {
            assert!(default_base_url(id).is_some(), "缺 {id}");
        }
        assert_eq!(PROVIDERS.len(), 7, "加减了一家就来改这个数，顺手看一眼前端还认不认");
    }

    #[test]
    fn 清单能解析_且每家字段齐全() {
        for p in PROVIDERS.iter() {
            assert!(!p.id.is_empty());
            assert!(!p.name.is_empty(), "{} 没有中文名，界面上会是空的", p.id);
            assert!(!p.en.is_empty(), "{} 没有英文名", p.id);
        }
    }

    #[test]
    fn 只有自定义端点是用户自己填的() {
        for p in PROVIDERS.iter() {
            assert_eq!(p.user_defined, p.id == "custom", "{} 的 userDefined 不对", p.id);
            // 要用户填端点的那家不该带控制台链接 —— 那链接指不到任何地方
            if p.user_defined {
                assert!(p.console.is_none(), "{} 不该有控制台链接", p.id);
            } else {
                assert!(p.console.is_some(), "{} 缺控制台链接，用户不知道去哪儿拿 key", p.id);
            }
        }
    }

    #[test]
    fn 除自定义外都有_https_默认端点() {
        for p in PROVIDERS.iter() {
            if p.user_defined {
                assert!(p.base_url.is_empty());
            } else {
                assert!(p.base_url.starts_with("https://"), "{} 的端点不是 https", p.id);
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
