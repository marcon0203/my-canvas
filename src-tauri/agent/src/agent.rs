//! 把配置装配成 Rig agent。
//!
//! 映射关系（与 docs/desktop-architecture.md 的表一致）：
//! | 配置                     | Rig              | 决定           |
//! |--------------------------|------------------|----------------|
//! | preamble / persona 默认  | `.preamble()`    | **怎么想**     |
//! | tools                    | `.tool()`        | 能动什么       |
//! | models[modality]         | `client.agent()` | 用谁的脑子     |
//! | temperature              | `.temperature()` | 发散程度       |
//!
//! `skills` 不进 Rig —— 它决定「接不接这个活」，是路由层的事，在 agent 建起来之前就判完了。

use studio_conf::config::{AgentConfig, Autonomy, ModelRef, ProviderSetting};
use studio_error::{Error, Result};
use studio_conf::providers::resolve_base_url;
use std::collections::HashMap;

/// 建一个 agent 需要的全部输入，解析完再交给 Rig —— 解析失败要在建之前就报出来。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpec {
    pub agent_id: String,
    pub model: ModelRef,
    pub base_url: String,
    pub preamble: String,
    pub temperature: Option<f64>,
    pub tools: Vec<String>,
    pub autonomy: Autonomy,
    /// 单轮里最多允许几次工具往返。propose 只跑一轮就交回人
    pub max_turns: usize,
}

/// 自主度 → 工具往返预算。
/// propose：出完计划就停，交回人采纳；auto：跑完整循环。
pub fn turn_budget(autonomy: Autonomy) -> usize {
    match autonomy {
        Autonomy::Propose => 1,
        Autonomy::Auto => 12,
    }
}

/// 解析配置 → AgentSpec。纯函数，没有 IO，所以能完整单测。
pub fn resolve(
    cfg: &AgentConfig,
    fallback_preamble: &str,
    globals: &HashMap<String, ModelRef>,
    providers: &HashMap<String, ProviderSetting>,
) -> Result<AgentSpec> {
    if !cfg.enabled {
        return Err(Error::UnknownAgent(format!("{} 已停用", cfg.agent_id)));
    }
    let model = cfg
        .model_for("text", globals)
        .ok_or_else(|| Error::NoModel {
            agent: cfg.agent_id.clone(),
            modality: "文本".into(),
        })?
        .clone();
    let base_url = resolve_base_url(&model.provider, providers.get(&model.provider))?;

    Ok(AgentSpec {
        agent_id: cfg.agent_id.clone(),
        model,
        base_url,
        preamble: cfg.preamble_or(fallback_preamble).to_string(),
        temperature: cfg.temperature,
        tools: cfg.tools.clone(),
        autonomy: cfg.autonomy,
        max_turns: turn_budget(cfg.autonomy),
    })
}

/// 用 AgentSpec 建 Rig agent。
///
/// 国内六家的文本接口都是 OpenAI 兼容，所以统一走 Rig 的 OpenAI 客户端改 baseURL；
/// 图片/视频不走这里 —— 它们是各家自有的异步任务接口，作为 tool 挂进来。
/// 拿这家供应商的模型句柄。**能用 rig 内置的那家就用它，别一律走通用客户端。**
///
/// 两件事都踩过：
///
/// 1. **接口家族**：`openai::Client` 在 rig 0.42 里是 Responses API（`/responses`）
///    的客户端 —— OpenAI 自家的新接口。目录里这几家国内供应商只提供
///    `/chat/completions`，所以通用那条必须是 `CompletionsClient`。
///    用错了的症状很难查：响应解析报「unknown variant `chat.completion`,
///    expected `response`」，看着像供应商返回格式不对，其实是我们问错了接口。
///
/// 2. **各家的脾气 rig 已经替我们处理了一部分**。结构化输出要强制
///    `tool_choice: required`，而好几家的思考模型不接受它，直接回 400
///    （「Thinking mode does not support this tool_choice」）。rig 的
///    `providers::deepseek` 会在思考模式下把强制 tool_choice 抹成 null，
///    `providers::moonshot` 会降级成 `auto` 并补一句引导 —— 走它们的客户端
///    就白拿这些修复，自己写等于重复劳动还容易漏。
///
/// 剩下几家 rig 没有专属模块（火山方舟、阿里百炼、腾讯混元、自定义端点），
/// 智谱那个 `providers::zai` 是 z.ai 国际站且没做这类修正，用它没好处。
/// 这些走通用 chat/completions —— 它们的思考模型仍会 400，由
/// `structured::extract` 换成提示词那条兜住。
pub fn model_handle(spec: &AgentSpec, api_key: &str) -> rig::agent::ModelHandle {
    use rig::agent::ModelHandle;
    use rig::client::CompletionClient;
    use rig::providers::{deepseek, moonshot, openai};

    let m = &spec.model.model;
    match spec.model.provider.as_str() {
        "deepseek" => ModelHandle::new(
            deepseek::Client::builder()
                .api_key(api_key)
                .base_url(&spec.base_url)
                .build()
                .expect("deepseek 客户端构建失败")
                .completion_model(m),
        ),
        "moonshot" => ModelHandle::new(
            moonshot::Client::builder()
                .api_key(api_key)
                .base_url(&spec.base_url)
                .build()
                .expect("moonshot 客户端构建失败")
                .completion_model(m),
        ),
        _ => ModelHandle::new(
            openai::CompletionsClient::builder()
                .api_key(api_key)
                .base_url(&spec.base_url)
                .build()
                .expect("openai 兼容客户端构建失败")
                .completion_model(m),
        ),
    }
}

pub fn build(spec: &AgentSpec, api_key: &str) -> rig::agent::Agent {
    let mut b = rig::agent::AgentBuilder::from_model_handle(model_handle(spec, api_key))
        .name(&spec.agent_id)
        .preamble(&spec.preamble);
    if let Some(t) = spec.temperature {
        b = b.temperature(t);
    }
    b.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn globals() -> HashMap<String, ModelRef> {
        HashMap::from([(
            "text".to_string(),
            ModelRef { provider: "deepseek".into(), model: "deepseek-chat".into() },
        )])
    }

    fn cfg(json: serde_json::Value) -> AgentConfig {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn 取全局模型并解析出端点() {
        let c = cfg(serde_json::json!({ "agentId": "writer" }));
        let s = resolve(&c, "出厂提示词", &globals(), &HashMap::new()).unwrap();
        assert_eq!(s.model.model, "deepseek-chat");
        assert_eq!(s.base_url, "https://api.deepseek.com");
        assert_eq!(s.preamble, "出厂提示词");
    }

    #[test]
    fn 自己配的模型压过全局() {
        let c = cfg(serde_json::json!({
            "agentId": "dp",
            "models": { "text": { "provider": "moonshot", "model": "moonshot-v1-128k" } }
        }));
        let s = resolve(&c, "x", &globals(), &HashMap::new()).unwrap();
        assert_eq!(s.model.provider, "moonshot");
        assert_eq!(s.base_url, "https://api.moonshot.cn/v1");
    }

    #[test]
    fn 改写过的提示词压过出厂默认() {
        let c = cfg(serde_json::json!({ "agentId": "dp", "preamble": "只拍特写" }));
        assert_eq!(resolve(&c, "出厂", &globals(), &HashMap::new()).unwrap().preamble, "只拍特写");
    }

    #[test]
    fn 自主度决定工具往返预算() {
        assert_eq!(turn_budget(Autonomy::Propose), 1, "先出方案：一轮就交回人");
        assert!(turn_budget(Autonomy::Auto) > 1, "自主执行要能多轮");
    }

    #[test]
    fn 停用的_agent_建不出来() {
        let c = cfg(serde_json::json!({ "agentId": "dp", "enabled": false }));
        assert_eq!(
            resolve(&c, "x", &globals(), &HashMap::new()).unwrap_err().code(),
            "unknown_agent"
        );
    }

    #[test]
    fn 没有文本模型时明确报错_不静默跑不动() {
        let c = cfg(serde_json::json!({ "agentId": "dp" }));
        let e = resolve(&c, "x", &HashMap::new(), &HashMap::new()).unwrap_err();
        assert_eq!(e.code(), "no_model");
        assert!(e.to_string().contains("文本"));
    }

    #[test]
    fn 自定义端点没填时报错而不是拿空串发请求() {
        let c = cfg(serde_json::json!({
            "agentId": "dp",
            "models": { "text": { "provider": "custom", "model": "llama3" } }
        }));
        assert_eq!(
            resolve(&c, "x", &globals(), &HashMap::new()).unwrap_err().code(),
            "no_base_url"
        );
    }
}
