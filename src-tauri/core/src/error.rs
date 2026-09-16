use serde::Serialize;

/// 统一错误。序列化成 `{ code, message }` 过 IPC —— 前端按 code 分支，
/// message 只给人看，不要 match 它。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("没有配置 {0} 的密钥")]
    NoKey(String),
    #[error("钥匙串读写失败：{0}")]
    Vault(String),
    #[error("找不到厂商 {0}")]
    UnknownProvider(String),
    #[error("{provider} 没有配置端点")]
    NoBaseUrl { provider: String },
    #[error("找不到 Agent {0}")]
    UnknownAgent(String),
    #[error("{agent} 没有可用的{modality}模型")]
    NoModel { agent: String, modality: String },
    #[error("请求失败：{0}")]
    Http(String),
    #[error("模型返回无法解析：{0}")]
    Decode(String),
    #[error("找不到 skill {0}")]
    UnknownSkill(String),
    #[error("skill 加载失败：{0}")]
    Skill(String),
    #[error("工作空间：{0}")]
    Workspace(String),
    #[error("读写失败：{0}")]
    Store(String),
}

impl Error {
    /// 稳定的错误码，前端按它分支
    pub fn code(&self) -> &'static str {
        match self {
            Error::NoKey(_) => "no_key",
            Error::Vault(_) => "vault",
            Error::UnknownProvider(_) => "unknown_provider",
            Error::NoBaseUrl { .. } => "no_base_url",
            Error::UnknownAgent(_) => "unknown_agent",
            Error::NoModel { .. } => "no_model",
            Error::Http(_) => "http",
            Error::Decode(_) => "decode",
            Error::UnknownSkill(_) => "unknown_skill",
            Error::Skill(_) => "skill",
            Error::Workspace(_) => "workspace",
            Error::Store(_) => "store",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WireError {
    pub code: &'static str,
    pub message: String,
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        WireError { code: self.code(), message: self.to_string() }.serialize(s)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 错误码稳定且各不相同() {
        let all = [
            Error::NoKey("x".into()),
            Error::Vault("x".into()),
            Error::UnknownProvider("x".into()),
            Error::NoBaseUrl { provider: "x".into() },
            Error::UnknownAgent("x".into()),
            Error::NoModel { agent: "x".into(), modality: "文本".into() },
            Error::Http("x".into()),
            Error::Decode("x".into()),
        ];
        let codes: Vec<_> = all.iter().map(|e| e.code()).collect();
        let uniq: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(codes.len(), uniq.len(), "错误码不能重复，前端要靠它分支");
    }

    #[test]
    fn 序列化成_code_加_message() {
        let v = serde_json::to_value(Error::NoKey("火山方舟".into())).unwrap();
        assert_eq!(v["code"], "no_key");
        assert!(v["message"].as_str().unwrap().contains("火山方舟"));
    }
}
