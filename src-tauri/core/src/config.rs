//! 配置结构：与前端 `domain/agent/config.ts`、`domain/providers/*.ts` 一一对应。
//!
//! 这些类型是**契约**，两边必须同形 —— 前端 JSON 直接反序列化成这里的结构。
//! 字段名用 camelCase，跟 TS 保持一致，省掉一层易错的映射。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Modality {
    Text,
    Image,
    Video,
}

/// 协议族：决定用哪个适配器。
/// 国内六家的文本接口都是 OpenAI 兼容；图片/视频各家是自有的异步任务接口。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Protocol {
    OpenaiChat,
    AsyncTask,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelRef {
    pub provider: String,
    pub model: String,
}

/// 自主度。决定 agent loop 的形态 —— 与前端 `Autonomy` 同名同值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Autonomy {
    /// 出计划和产物，执行前交回人（默认）
    #[default]
    Propose,
    /// 跑完整循环，只在要花钱或动定稿资产时停下来问
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub agent_id: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    /// 按模态各配一个模型；缺省跟随全局
    #[serde(default)]
    pub models: std::collections::HashMap<String, ModelRef>,
    #[serde(default)]
    pub temperature: Option<f64>,
    /// 改写后的系统提示词。None = 用出厂 preamble
    #[serde(default)]
    pub preamble: Option<String>,
    #[serde(default)]
    pub autonomy: Autonomy,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

impl AgentConfig {
    /// 这位 Agent 在某模态下用的模型：自己配的优先，否则全局默认。
    /// 与前端 `modelFor` 同一语义 —— 两边算出来必须一致。
    pub fn model_for<'a>(
        &'a self,
        modality: &str,
        globals: &'a std::collections::HashMap<String, ModelRef>,
    ) -> Option<&'a ModelRef> {
        self.models.get(modality).or_else(|| globals.get(modality))
    }

    /// 实际生效的系统提示词。空白不算改写 —— 免得误存一个空提示词把 Agent 变哑巴
    pub fn preamble_or<'a>(&'a self, fallback: &'a str) -> &'a str {
        match self.preamble.as_deref().map(str::trim) {
            Some(s) if !s.is_empty() => s,
            _ => fallback,
        }
    }
}

/// 一家厂商的接入设置。**密钥不在这里** —— 它只进系统钥匙串。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSetting {
    pub id: String,
    /// 用户改过的端点；空则用内置默认
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn cfg() -> AgentConfig {
        serde_json::from_value(serde_json::json!({
            "agentId": "dp",
            "skills": ["shots.generate"],
            "tools": ["project.read", "shot.write"],
            "models": { "video": { "provider": "volcengine", "model": "doubao-seedance" } },
            "autonomy": "propose",
            "enabled": true
        }))
        .unwrap()
    }

    #[test]
    fn 前端_json_能直接反序列化() {
        let c = cfg();
        assert_eq!(c.agent_id, "dp");
        assert_eq!(c.autonomy, Autonomy::Propose);
        assert!(c.enabled);
    }

    #[test]
    fn 缺省字段有合理默认_老配置不至于反序列化失败() {
        let c: AgentConfig =
            serde_json::from_value(serde_json::json!({ "agentId": "writer" })).unwrap();
        assert!(c.enabled, "enabled 缺省应为 true");
        assert_eq!(c.autonomy, Autonomy::Propose);
        assert!(c.skills.is_empty());
    }

    #[test]
    fn 模型解析与前端同语义_自己配的优先否则跟全局() {
        let c = cfg();
        let mut globals = HashMap::new();
        globals.insert(
            "video".into(),
            ModelRef { provider: "zhipu".into(), model: "cogvideox".into() },
        );
        globals.insert(
            "text".into(),
            ModelRef { provider: "deepseek".into(), model: "deepseek-chat".into() },
        );

        assert_eq!(c.model_for("video", &globals).unwrap().provider, "volcengine");
        assert_eq!(c.model_for("text", &globals).unwrap().provider, "deepseek");
        assert!(c.model_for("image", &globals).is_none());
    }

    #[test]
    fn 空白提示词不算改写() {
        let mut c = cfg();
        assert_eq!(c.preamble_or("出厂"), "出厂");
        c.preamble = Some("   \n ".into());
        assert_eq!(c.preamble_or("出厂"), "出厂");
        c.preamble = Some("只拍特写".into());
        assert_eq!(c.preamble_or("出厂"), "只拍特写");
    }
}
