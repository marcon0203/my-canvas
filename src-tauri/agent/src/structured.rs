//! 让模型填一个有 schema 的结构。**三条链路共用这一处**。
//!
//! # 为什么不能只用 Rig 的 Extractor
//!
//! `Extractor` 是靠「注册一个 submit 工具 + 强制 `tool_choice: required`」实现的
//! （见 rig-agent 的 `extractor.rs`，那句 `ToolChoice::Required` 是写死的）。
//! 思考模型不接受强制 tool_choice，供应商直接回 400：
//!
//! ```text
//! Thinking mode does not support this tool_choice
//! ```
//!
//! 国内几家的旗舰现在默认就是思考模型（GLM、DeepSeek-R1、豆包 thinking…），
//! 所以这不是边角情况 —— 用户接一个最常见的模型，整条链路就跑不起来。
//!
//! # 这里怎么做
//!
//! 1. 先走工具调用那条（可靠性最好，模型只能填 schema，填错 Rig 会重试）
//! 2. 拿到「不支持这个 tool_choice」这类 400 时，换成**把 schema 写进提示词、
//!    自己解析返回的 JSON**。这条路任何 chat 接口都吃得下，代价是模型可能
//!    在 JSON 外面裹一层解释或 ``` 围栏 —— 所以 `json_of` 得能刨出来
//! 3. 某个模型一旦被判定要走第二条，**这一次进程内记下来**，后面同一个模型
//!    直接走第二条。不记的话每次生成都要先白挨一个 400
//!
//! 不反过来「一律走第二条」：工具调用那条的结构可靠性明显更高，能用就该用。

use crate::agent::AgentSpec;
use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use serde::Serialize;
use studio_error::{Error, Result};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

/// 判定过「这个模型要走提示词那条」的集合，键是 `provider/model`。
///
/// 进程内缓存，不落盘：用户把思考模式关掉之后重启就回到先试工具调用。
/// 缓存错了也不会坏事 —— 提示词那条路只是稍微不那么可靠，不是不能用。
fn plain_only() -> &'static Mutex<HashSet<String>> {
    static S: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashSet::new()))
}

fn key_of(spec: &AgentSpec) -> String {
    format!("{}/{}", spec.model.provider, spec.model.model)
}

/// 这个错误是不是「不支持强制工具调用」。
///
/// 只认和 tool_choice / 工具支持有关的说法。**别把所有 400 都当成它** ——
/// 密钥不对、模型名写错、余额不足也是 400，那些换条路一样失败，
/// 白跑一次还把真原因盖掉了。
pub fn wants_plain_json(msg: &str) -> bool {
    let m = msg.to_lowercase();
    ["tool_choice", "tool choice", "toolchoice"].iter().any(|k| m.contains(k))
        || (m.contains("thinking") && m.contains("tool"))
        || m.contains("does not support tool")
        || m.contains("tools are not supported")
}

/// 从模型的回答里刨出那段 JSON。
///
/// 要对付三种情况，都是真见过的：
/// - ```json 围栏
/// - JSON 前后带一段解释（「好的，这是结果：」）
/// - 思考模型把推理过程也吐出来（`<think>…</think>`）
///
/// 做法：先剥围栏与 think 块，再从第一个 `{` 起做括号配对，取出第一段完整的
/// 对象。**不用正则贪婪匹配到最后一个 `}`** —— JSON 后面再跟一句解释时，
/// 那样会把解释也吞进来。字符串里的括号与转义要跳过，否则 `"a}b"` 会提前收尾。
pub fn json_of(raw: &str) -> Option<&str> {
    let mut s = raw.trim();

    // 思考模型的推理块。只剥最外层那一对就够，里面不会再嵌一个
    if let Some(end) = s.find("</think>") {
        s = s[end + "</think>".len()..].trim_start();
    }

    // ``` 围栏：取围栏里的内容
    if let Some(rest) = s.strip_prefix("```") {
        let body = rest.strip_prefix("json").unwrap_or(rest);
        let body = body.trim_start_matches(['\r', '\n']);
        if let Some(end) = body.find("```") {
            s = body[..end].trim();
        } else {
            s = body.trim();
        }
    }

    let bytes = s.as_bytes();
    let start = bytes.iter().position(|b| *b == b'{')?;
    let mut depth = 0usize;
    let mut in_str = false;
    let mut esc = false;
    for (i, b) in bytes.iter().enumerate().skip(start) {
        if esc {
            esc = false;
            continue;
        }
        match b {
            b'\\' if in_str => esc = true,
            b'"' => in_str = !in_str,
            b'{' if !in_str => depth += 1,
            b'}' if !in_str => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[start..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// 走工具调用那条：Rig 的 Extractor，模型只能填 schema，填错 Rig 会重试。
async fn by_tool<T>(spec: &AgentSpec, api_key: &str, preamble: &str, prompt: &str) -> Result<T>
where
    T: JsonSchema + DeserializeOwned + Serialize + Send + Sync + 'static,
{
    rig::extractor::ExtractorBuilder::<T>::from_model_handle(
        crate::agent::model_handle(spec, api_key),
    )
    .preamble(preamble)
    .build()
    .extract(prompt.to_string())
    .await
    .map_err(|e| classify(&e.to_string()))
}

/// 供应商的错误分两类：**不支持强制工具调用**要换路，其它要如实报。
///
/// 一律报 Decode 的话，界面会说「模型没按要求的结构返回」—— 而 400
/// 根本不是模型不听话，是我们的请求它不收。
fn classify(msg: &str) -> Error {
    if msg.contains("status 4") || msg.contains("status 5") || msg.contains("ProviderResponseError")
    {
        Error::Http(msg.to_string())
    } else {
        Error::Decode(msg.to_string())
    }
}

/// 走提示词那条：**schema 由 rig 的 `OutputMode::Prompted` 注进去**，不自己拼
/// 那段指令（rig 那句 "Respond with ONLY a single JSON object that conforms to
/// this JSON Schema…" 就是干这个的，重写一遍只会和它漂移）。
///
/// 但**解析必须自己做** —— rig 自己的文档就写着这条路返回的文本「不保证是干净
/// 的 JSON，可能带解释或 markdown 围栏」，所以 `json_of` 留着。
async fn by_prompt<T>(spec: &AgentSpec, api_key: &str, preamble: &str, prompt: &str) -> Result<T>
where
    T: JsonSchema + DeserializeOwned + Serialize + Send + Sync + 'static,
{
    use rig::agent::run::OutputMode;
    use rig::completion::Prompt;

    let mut b = rig::agent::AgentBuilder::from_model_handle(
        crate::agent::model_handle(spec, api_key),
    )
    .name(&spec.agent_id)
    .preamble(preamble)
    .output_schema::<T>()
    .output_mode(OutputMode::Prompted);
    if let Some(t) = spec.temperature {
        b = b.temperature(t);
    }

    let out = b.build().prompt(prompt).await.map_err(|e| classify(&e.to_string()))?;

    let body =
        json_of(&out).ok_or_else(|| Error::Decode(format!("模型没返回 JSON：{}", head(&out))))?;
    serde_json::from_str(body).map_err(|e| Error::Decode(format!("{e}：{}", head(body))))
}

/// 错误里带上模型原话的开头，方便排查；但别把整段几千字都塞进错误
fn head(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() <= 200 {
        return t.to_string();
    }
    t.chars().take(200).collect::<String>() + "…"
}

/// 让模型填一个 `T`。先试工具调用，不行就换提示词那条。
pub async fn extract<T>(spec: &AgentSpec, api_key: &str, preamble: &str, prompt: &str) -> Result<T>
where
    T: JsonSchema + DeserializeOwned + Serialize + Send + Sync + 'static,
{
    let key = key_of(spec);
    let skip_tool = plain_only().lock().map(|s| s.contains(&key)).unwrap_or(false);
    if skip_tool {
        return by_prompt(spec, api_key, preamble, prompt).await;
    }

    match by_tool(spec, api_key, preamble, prompt).await {
        Ok(v) => Ok(v),
        Err(e) if wants_plain_json(&e.to_string()) => {
            if let Ok(mut s) = plain_only().lock() {
                s.insert(key);
            }
            by_prompt(spec, api_key, preamble, prompt).await
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用户真遇到的那条。这是这个模块存在的理由，原话钉在测试里
    const THINKING: &str = "CompletionError: ProviderResponseError: status 400 Bad Request: \
        {\"error\":{\"message\":\"Thinking mode does not support this tool_choice\",\
        \"type\":\"invalid_request_error\"}}";

    #[test]
    fn 认得思考模型那条_400() {
        assert!(wants_plain_json(THINKING));
    }

    #[test]
    fn 别的_400_不换路_换了也失败还把真原因盖掉() {
        for msg in [
            "status 400: {\"error\":{\"message\":\"Incorrect API key provided\"}}",
            "status 400: {\"error\":{\"message\":\"The model `glm-9` does not exist\"}}",
            "status 402: 余额不足",
            "status 429: rate limit exceeded",
            "error decoding response body",
        ] {
            assert!(!wants_plain_json(msg), "不该换路：{msg}");
        }
    }

    #[test]
    fn 几种说法都认_大小写不敏感() {
        for msg in [
            "Invalid value: 'required'. Supported values are: 'auto'. (param: tool_choice)",
            "This model does not support tool calling",
            "TOOLS ARE NOT SUPPORTED for this endpoint",
            "thinking is enabled; tool use must be auto",
        ] {
            assert!(wants_plain_json(msg), "该认出来：{msg}");
        }
    }

    #[test]
    fn 干净的_json_原样取出() {
        assert_eq!(json_of(r#"{"a":1}"#), Some(r#"{"a":1}"#));
    }

    #[test]
    fn 剥掉_json_围栏() {
        let s = "```json\n{\"a\":1}\n```";
        assert_eq!(json_of(s), Some("{\"a\":1}"));
        assert_eq!(json_of("```\n{\"a\":2}\n```"), Some("{\"a\":2}"));
    }

    #[test]
    fn 前后裹着解释也能刨出来() {
        let s = "好的，这是结果：\n{\"a\":1}\n希望有帮助！";
        assert_eq!(json_of(s), Some("{\"a\":1}"));
    }

    #[test]
    fn 思考模型的推理块被剥掉() {
        let s = "<think>我先想想，这里应该给三条……</think>\n{\"alts\":[\"甲\"]}";
        assert_eq!(json_of(s), Some("{\"alts\":[\"甲\"]}"));
        // 推理块里出现的 { 不能被当成正文的开头
        let s2 = "<think>比如 {\"错的\":1} 这种</think>{\"对的\":2}";
        assert_eq!(json_of(s2), Some("{\"对的\":2}"));
    }

    #[test]
    fn 嵌套对象完整取出_不在第一个右括号收尾() {
        let s = "{\"a\":{\"b\":[1,2]},\"c\":3}";
        assert_eq!(json_of(s), Some(s));
    }

    #[test]
    fn 字符串里的括号不算层级() {
        let s = r#"{"t":"这里有个 } 和 {","n":1}"#;
        assert_eq!(json_of(s), Some(s));
    }

    #[test]
    fn 转义引号不会把字符串提前收尾() {
        let s = r#"{"t":"他说\"好\"","n":1}"#;
        assert_eq!(json_of(s), Some(s));
    }

    #[test]
    fn json_后面再跟一段话时不把那段也吞进来() {
        // 贪婪匹配到最后一个 } 就会出这个错
        let s = "{\"a\":1}\n说明：{这不是 JSON}";
        assert_eq!(json_of(s), Some("{\"a\":1}"));
    }

    #[test]
    fn 没有_json_时返回_none_而不是瞎猜() {
        for s in ["", "抱歉，我做不到", "[1,2,3]", "```json\n没有大括号\n```"] {
            assert_eq!(json_of(s), None, "{s:?}");
        }
    }

    #[test]
    fn 错误里带原话开头_但不塞整段() {
        let long = "字".repeat(500);
        let h = head(&long);
        assert_eq!(h.chars().count(), 201);
        assert!(h.ends_with('…'));
        assert_eq!(head("  短的  "), "短的");
    }
}

/// 对着一个假供应商跑真链路。
///
/// 这一组是这个模块存在的理由的验收：假站点在**看到 tool_choice 时回 400**
/// （原话就是用户遇到的那句），否则回一段带 ``` 围栏和思考块的 JSON。
/// 所以「先试工具调用 → 认出 400 → 换提示词那条 → 刨出 JSON」整条路都被跑过一遍。
#[cfg(test)]
mod http_tests {
    use super::*;
    use schemars::JsonSchema;
    use serde::Deserialize;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[derive(Debug, Deserialize, Serialize, JsonSchema, PartialEq)]
    struct Alts {
        reply: String,
        alts: Vec<String>,
    }

    /// 假站点的回法
    #[derive(Clone, Copy, PartialEq)]
    enum Mode {
        /// 思考模型：带 tool_choice 就 400
        Thinking,
        /// 什么都不支持：两条路都 400（换路也救不了，得如实报错）
        Broken,
    }

    /// 收到过的请求路径。用来核「我们问的是 chat/completions 那个接口」
    type Paths = Arc<Mutex<Vec<String>>>;

    /// 起一个假的 OpenAI 兼容端点。返回 base_url、请求计数、收到的路径
    async fn provider_paths(mode: Mode) -> (String, Arc<AtomicUsize>, Paths) {
        let paths: Paths = Arc::new(Mutex::new(Vec::new()));
        let (base, hits) = provider_with(mode, paths.clone()).await;
        (base, hits, paths)
    }

    async fn provider(mode: Mode) -> (String, Arc<AtomicUsize>) {
        let (base, hits) = provider_with(mode, Arc::new(Mutex::new(Vec::new()))).await;
        (base, hits)
    }

    async fn provider_with(mode: Mode, paths: Paths) -> (String, Arc<AtomicUsize>) {
        let hits = Arc::new(AtomicUsize::new(0));
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let h = hits.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = l.accept().await {
                let h = h.clone();
                let ps = paths.clone();
                tokio::spawn(async move {
                    // 请求体可能分包到达，按 Content-Length 读齐再判断
                    let mut raw = Vec::new();
                    let mut buf = [0u8; 4096];
                    loop {
                        let n = sock.read(&mut buf).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        raw.extend_from_slice(&buf[..n]);
                        let text = String::from_utf8_lossy(&raw);
                        let Some(head_end) = text.find("\r\n\r\n") else { continue };
                        let len = text
                            .to_lowercase()
                            .find("content-length:")
                            .and_then(|i| {
                                text[i + "content-length:".len()..]
                                    .lines()
                                    .next()?
                                    .trim()
                                    .parse::<usize>()
                                    .ok()
                            })
                            .unwrap_or(0);
                        if raw.len() >= head_end + 4 + len {
                            break;
                        }
                    }
                    let req = String::from_utf8_lossy(&raw).to_string();
                    h.fetch_add(1, Ordering::SeqCst);
                    if let Some(p) = req.split_whitespace().nth(1)
                        && let Ok(mut v) = ps.lock()
                    {
                        v.push(p.to_string());
                    }
                    // **只认强制**：`"tool_choice":"required"` 或指名某个函数。
                    // rig 的 deepseek 客户端会把它抹成 `null` —— 那种不该 400，
                    // 真供应商也不会拒。判成「出现过这个键就算」的话，
                    // 「走内置 provider 有没有用」这条测试永远看不出差别
                    let body = req.split("\r\n\r\n").nth(1).unwrap_or("");
                    let forced = body.contains("\"tool_choice\":\"required\"")
                        || body.contains("\"tool_choice\":{")
                        || body.contains("\"tool_choice\": \"required\"");
                    let wants_tool = body.contains("\"tools\":[");

                    let (status, body) = match (mode, forced) {
                        (Mode::Thinking, true) | (Mode::Broken, _) => (
                            400,
                            "{\"error\":{\"message\":\"Thinking mode does not support this \
                             tool_choice\",\"type\":\"invalid_request_error\"}}"
                                .to_string(),
                        ),
                        _ if wants_tool => {
                            // 工具那条：回一个真的 tool_call，参数就是那份结构。
                            // 这段要同时满足通用 openai 与 DeepSeek 两套结构：
                            // DeepSeek 的 `tool_calls[].index` 不是可选的、`content`
                            // 不是 Option、`usage` 还要缓存命中那两个字段（真接口都带）。
                            // 漏一个就被报成「供应商返回格式不对」，而那是假象
                            let args = "{\\\"reply\\\":\\\"差别在谁动手\\\",\
                                \\\"alts\\\":[\\\"甲去了\\\",\\\"乙去了\\\"]}";
                            (200, format!(
                                "{{\"id\":\"1\",\"object\":\"chat.completion\",\"created\":0,\
                                 \"model\":\"m\",\"choices\":[{{\"index\":0,\"message\":{{\
                                 \"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{{\
                                 \"id\":\"c1\",\"index\":0,\"type\":\"function\",\"function\":{{\
                                 \"name\":\"submit\",\"arguments\":\"{args}\"}}}}]}},\
                                 \"finish_reason\":\"tool_calls\"}}],\"usage\":{{\
                                 \"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2,\
                                 \"prompt_cache_hit_tokens\":0,\"prompt_cache_miss_tokens\":1}}}}"
                            ))
                        }
                        _ => {
                            // 提示词那条：故意裹上思考块与围栏，`json_of` 要能刨出来
                            let content = "<think>先想想给哪三条</think>\\n\
                                ```json\\n{\\\"reply\\\":\\\"差别在谁动手\\\",\
                                \\\"alts\\\":[\\\"甲去了\\\",\\\"乙去了\\\"]}\\n```";
                            (
                                200,
                                format!(
                                    "{{\"id\":\"1\",\"object\":\"chat.completion\",\"created\":0,\
                                     \"model\":\"m\",\"choices\":[{{\"index\":0,\"message\":\
                                     {{\"role\":\"assistant\",\"content\":\"{content}\"}},\
                                     \"finish_reason\":\"stop\"}}],\"usage\":\
                                     {{\"prompt_tokens\":1,\"completion_tokens\":1,\
                                     \"total_tokens\":2}}}}"
                                ),
                            )
                        }
                    };
                    let reason = if status == 200 { "OK" } else { "Bad Request" };
                    let head = format!(
                        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(body.as_bytes()).await;
                    let _ = sock.flush().await;
                });
            }
        });
        (format!("http://{addr}"), hits)
    }

    /// 每个测试用不同的模型名，免得进程内那份「要走提示词」的缓存串台
    fn spec(base: &str, model: &str) -> AgentSpec {
        spec_of("custom", base, model)
    }

    fn spec_of(provider: &str, base: &str, model: &str) -> AgentSpec {
        let cfg: studio_conf::config::AgentConfig =
            serde_json::from_value(serde_json::json!({ "agentId": "writer" })).unwrap();
        let globals = std::collections::HashMap::from([(
            "text".to_string(),
            studio_conf::config::ModelRef {
                provider: provider.into(),
                model: model.into(),
            },
        )]);
        let providers = std::collections::HashMap::from([(
            provider.to_string(),
            serde_json::from_value::<studio_conf::config::ProviderSetting>(serde_json::json!({
                "id": provider, "baseUrl": base,
            }))
            .unwrap(),
        )]);
        crate::agent::resolve(&cfg, "你是编剧。", &globals, &providers).unwrap()
    }

    #[tokio::test]
    async fn 思考模型那条_400_会自动换成提示词那条并拿到结构() {
        let (base, hits) = provider(Mode::Thinking).await;
        let s = spec(&base, "thinking-1");
        let got: Alts = extract(&s, "sk-x", "你是编剧。", "给三条走向").await.unwrap();

        assert_eq!(got.reply, "差别在谁动手");
        assert_eq!(got.alts, ["甲去了", "乙去了"]);
        // 两次请求：先工具调用挨了 400，再走提示词那条
        assert!(hits.load(Ordering::SeqCst) >= 2, "应该试过两条路");
    }

    #[tokio::test]
    async fn 同一个模型第二次直接走提示词_不再白挨一个_400() {
        let (base, hits) = provider(Mode::Thinking).await;
        let s = spec(&base, "thinking-2");

        let _: Alts = extract(&s, "sk-x", "p", "q").await.unwrap();
        let first = hits.load(Ordering::SeqCst);
        let _: Alts = extract(&s, "sk-x", "p", "q").await.unwrap();
        let second = hits.load(Ordering::SeqCst) - first;

        assert!(first >= 2, "第一次要试两条路，实际 {first}");
        assert_eq!(second, 1, "第二次该只发一次请求，实际 {second}");
    }

    /// **走 rig 内置的那家供应商，白拿它已经做好的修正。**
    ///
    /// rig 的 `providers::deepseek` 会在思考模式下把强制 tool_choice 抹成 null，
    /// `providers::moonshot` 会降级成 auto。所以同一个假供应商（带强制
    /// tool_choice 就 400）下：
    /// - provider = deepseek → 请求里根本没有强制 tool_choice，一次就成
    /// - provider = custom（通用 chat/completions）→ 先挨 400，再换提示词那条
    ///
    /// 这条测试的意义是：以后有人把 deepseek 那一支改回通用客户端，
    /// 请求数会从 1 变 2，这里当场失败。
    #[tokio::test]
    async fn 内置的_deepseek_客户端自己躲开了强制_tool_choice() {
        let (base, hits) = provider(Mode::Thinking).await;
        let s = spec_of("deepseek", &base, "deepseek-reasoner");
        let got: Alts = extract(&s, "sk-x", "你是编剧。", "给三条走向").await.unwrap();

        assert_eq!(got.alts, ["甲去了", "乙去了"]);
        assert_eq!(hits.load(Ordering::SeqCst), 1, "该一次就成，不用换路");
    }

    #[tokio::test]
    async fn 通用客户端那几家躲不开_所以兜底那条必须在() {
        let (base, hits) = provider(Mode::Thinking).await;
        // 火山方舟、阿里百炼、腾讯混元、自定义端点 rig 都没有专属模块
        let s = spec_of("custom", &base, "generic-1");
        let got: Alts = extract(&s, "sk-x", "你是编剧。", "给三条走向").await.unwrap();

        assert_eq!(got.alts, ["甲去了", "乙去了"]);
        assert!(hits.load(Ordering::SeqCst) >= 2, "这几家只能靠换路兜住");
    }

    /// 锁住接口家族。
    ///
    /// rig 0.42 的 `openai::Client` 是 **Responses API**（`/responses`）客户端，
    /// `CompletionsClient` 才是 `/chat/completions`。目录里六家国内供应商只有后者。
    /// 换回前者的话，症状是响应解析报「unknown variant `chat.completion`,
    /// expected `response`」—— 看着像供应商返回格式不对，其实是我们问错了接口。
    #[tokio::test]
    async fn 两条路都问的是_chat_completions_不是_responses() {
        let (base, _, paths) = provider_paths(Mode::Thinking).await;
        let s = spec(&base, "paths-1");
        let _: Alts = extract(&s, "sk-x", "p", "q").await.unwrap();

        let got = paths.lock().unwrap().clone();
        assert!(got.len() >= 2, "两条路都该发过请求：{got:?}");
        for p in &got {
            assert!(p.ends_with("/chat/completions"), "问错接口了：{p}");
        }
    }

    #[tokio::test]
    async fn 两条路都不通时如实报错_不假装成功() {
        let (base, _) = provider(Mode::Broken).await;
        let s = spec(&base, "broken-1");
        let e = extract::<Alts>(&s, "sk-x", "p", "q").await.unwrap_err();
        // 换路之后仍然失败，报的是真实原因而不是「解析不出来」
        assert!(matches!(e.code(), "http" | "decode"), "报的是 {}", e.code());
        assert!(e.to_string().contains("400") || e.to_string().contains("Thinking"),
            "错误里要留着供应商的原话：{e}");
    }
}
