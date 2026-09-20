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
//!
//! # 两条路都是流式的
//!
//! 产物里有一段给人看的话（`reply`）。它必须边生成边出来 —— 否则用户先对着
//! 空面板干等一整轮（思考模型能等半分钟），然后一下子出现一整段。原来的做法
//! 是等模型答完再把整段按两字一块发出去，观感像流式，实际上等的时间一点没少，
//! 反馈原话是「没有流式输出吗？」
//!
//! 所以这两条路走的都是 `stream_prompt`，边收边用 `stream::ReplyScan` 从还没
//! 写完的 JSON 里把 `reply` 已经到手的那截刨出来。工具那条 `reply` 在 `submit`
//! 的参数片段里，提示词那条就在模型正文里，位置不同、刨法一样。
//!
//! 也正因为会边跑边吐字，**换路多了一个前提**：已经往界面上发过字就不能换 ——
//! 换一条路是从头再说一遍。

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
/// - markdown 围栏（三个反引号，有时还带 json）
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

/// 正文一到手就往外发的出口。
///
/// `&dyn` 而不是泛型参数：三条链路的签名上再套一层泛型只会更难读，而这里
/// 每轮也就调几百次，虚调用的开销不值得计较。
pub type Deltas<'a> = &'a (dyn Fn(&str) + Sync);

/// 一轮运行往外发的两股文字。
///
/// **分成两股而不是拌在一起**：思考模型在开口之前会先想很久，那段推理不是
/// 产物的一部分，混进正文就等于把模型的草稿当成了它的回答。但它也不能扔掉 ——
/// 不然思考的那半分钟界面上一个字都没有，「没有流式输出」这个观感只解了一半。
pub struct Out<'a> {
    /// 产物里给人看的那段话（JSON 里的 `reply` 字段）
    pub reply: Deltas<'a>,
    /// 思考模型的推理过程。不是所有模型都有
    pub think: Deltas<'a>,
    /// 这一轮真实烧了多少 token。**厂商报的那份**，不是我们估的
    pub usage: &'a (dyn Fn(Usage) + Sync),
}

/// 一轮请求真实用掉的 token。
///
/// 为什么要它：界面上那个「消耗 N 积分」是本地常量拍的（大纲 2、分镜 3…），
/// 和真实用量没有关系。走完一整条流程看到「已消耗 38 积分」，那个 38
/// 不对应任何真实开销。积分留着当**预估**，真实用量单独记 —— 两个数
/// 摆在一起，人才判断得出这条片子值不值。
///
/// 全 0 是「厂商没报」的意思（rig 的 `Usage` 就是这个约定），界面据此
/// 显示「这家没报用量」而不是显示 0。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl Usage {
    pub fn is_missing(&self) -> bool {
        self.input_tokens == 0 && self.output_tokens == 0
    }
}

/// 不要流式时传它。测试里用得上 —— 那些用例关心的是结构，不是观感
pub fn silent() -> Out<'static> {
    Out { reply: &|_: &str| {}, think: &|_: &str| {}, usage: &|_: Usage| {} }
}

/// 正文从流里的哪儿来。
///
/// 两条路的正文在流里的位置不一样：工具调用那条它在 `submit` 的参数里，
/// 提示词那条它就在模型的正文里。**不能两边都收** —— 工具那条模型可能
/// 在调工具之前先说一句闲话，把那句也当正文，界面上就会先冒出一段
/// 跟产物无关的话。
#[derive(Clone, Copy, PartialEq)]
enum Src {
    ToolArgs,
    Text,
}

/// 驱动一次流式运行：边收边把 `reply` 刨出来发出去。
///
/// 返回 (模型最终给的那段输出, 已经发出去多少字节)。**字节数要带回去** ——
/// 换路的判定要用它：已经往界面上吐过字了就不能再换一条路重说一遍。
async fn drive(
    agent: rig::Agent,
    prompt: &str,
    from: Src,
    out: &Out<'_>,
) -> (Result<String>, usize) {
    use crate::stream::ReplyScan;
    use futures::StreamExt;
    use rig::agent::MultiTurnStreamItem;
    use rig::streaming::{StreamedAssistantContent, StreamingPrompt, ToolCallDeltaContent};

    let mut stream = agent.stream_prompt(prompt.to_string()).await;
    let mut scan = ReplyScan::default();
    // 盯住第一个工具调用。并发的几路参数拌在一起，刨出来的就是一段乱码
    let mut call: Option<String> = None;
    let mut final_out = String::new();

    while let Some(item) = stream.next().await {
        let item = match item {
            Ok(i) => i,
            Err(e) => return (Err(classify(&e.to_string())), scan.sent()),
        };
        let chunk = match (from, item) {
            // 推理过程：两条路都收。它在 `reply` 之前就来了，正是要填上的那段空白
            (_, MultiTurnStreamItem::StreamAssistantItem(
                StreamedAssistantContent::ReasoningDelta { reasoning, .. },
            )) => {
                (out.think)(&reasoning);
                None
            }
            (Src::Text, MultiTurnStreamItem::StreamAssistantItem(
                StreamedAssistantContent::Text(t),
            )) => Some(t.text),
            (Src::ToolArgs, MultiTurnStreamItem::StreamAssistantItem(
                StreamedAssistantContent::ToolCallDelta { internal_call_id, content },
            )) => {
                if call.get_or_insert(internal_call_id.clone()) != &internal_call_id {
                    None
                } else if let ToolCallDeltaContent::Delta(d) = content {
                    Some(d)
                } else {
                    None
                }
            }
            (_, MultiTurnStreamItem::FinalResponse(r)) => {
                // 厂商报的真实用量。rig 把整轮的 usage 聚合在这儿 ——
                // 换路重试时会报两次，调用方按「最后一次」算
                (out.usage)(Usage {
                    input_tokens: r.usage.input_tokens,
                    output_tokens: r.usage.output_tokens,
                });
                final_out = r.output;
                None
            }
            _ => None,
        };
        if let Some(c) = chunk {
            let add = scan.push(&c);
            if !add.is_empty() {
                (out.reply)(&add);
            }
        }
    }
    (Ok(final_out), scan.sent())
}

/// 把最终那段输出解析成 `T`。
///
/// 两条路都过 `json_of`：工具那条拿到的本来就该是干净的参数 JSON，但真见过
/// 模型不调工具、直接把 JSON 写在正文里的情况 —— 那时候 `output` 就是一段
/// 裹着围栏的文本，刨一下能救回来，白报一个错没必要。
fn parse<T: DeserializeOwned>(out: &str) -> Result<T> {
    let body =
        json_of(out).ok_or_else(|| Error::Decode(format!("模型没返回 JSON：{}", head(out))))?;
    serde_json::from_str(body).map_err(|e| Error::Decode(format!("{e}：{}", head(body))))
}

/// 装一个「有一个输出工具、并且强制它调」的 agent。
///
/// 这正是 rig 的 `ExtractorBuilder::from_model_handle` 内部做的事（那句
/// `ToolChoice::Required` + `OutputMode::Tool` 是写死的）。**不直接用
/// `Extractor` 是因为它只有 `extract()`，没有流式出口** —— 而产物里那段给人
/// 看的话必须边生成边出来，不能等整轮跑完再假装打字。
///
/// **不抄它那段提示词**：它写的是「调 `submit`」，而 `submit` 这个名字是它
/// 通过 `AgentRunner::output_tool()` 改的，那个方法是 `pub(crate)`，外面用不了。
/// 照抄的结果是提示词让模型调 `submit`、请求里登记的却是 `final_result`，
/// 模型照着提示词调，rig 当场判成「调了一个不存在的工具」——
/// 这个洞是真踩过的，所以那条「提示词说的和登记的必须是同一个」留成了测试。
///
/// 让模型调哪个工具，交给 rig 自己那句（`OutputMode::Tool` 默认会往提示词里
/// 补一句「call the `xxx` tool exactly once…」，名字由它填）。我们只补一句
/// 「每个字段都要填」—— 那是 extractor 那段提示词里真正管用的部分。
fn tool_agent<T>(spec: &AgentSpec, api_key: &str, preamble: &str) -> rig::Agent
where
    T: JsonSchema + DeserializeOwned + Serialize + Send + Sync + 'static,
{
    use rig::agent::{AgentBuilder, OutputMode};
    use rig::completion::message::ToolChoice;

    let mut b = AgentBuilder::from_model_handle(crate::agent::model_handle(spec, api_key))
        .name(&spec.agent_id)
        .preamble(preamble)
        .append_preamble(FILL_EVERY_FIELD)
        .output_schema::<T>()
        .tool_choice(ToolChoice::Required)
        .output_mode(OutputMode::Tool);
    if let Some(t) = spec.temperature {
        b = b.temperature(t);
    }
    b.build()
}

/// 用英文是因为这句是给 schema 那套机制看的，和人格那段中文不是一回事；
/// 模型对这类指令的英文版服从度也更稳
const FILL_EVERY_FIELD: &str =
    "\n\nFill out EVERY field of the structured result, even with default values. \
     Do not return the final answer as plain text.";

/// 走工具调用那条：模型只能填 schema，可靠性最好。正文从 `submit` 的参数里流出来
async fn by_tool<T>(
    spec: &AgentSpec,
    api_key: &str,
    preamble: &str,
    prompt: &str,
    out: &Out<'_>,
) -> (Result<T>, usize)
where
    T: JsonSchema + DeserializeOwned + Serialize + Send + Sync + 'static,
{
    let agent = tool_agent::<T>(spec, api_key, preamble);
    let (got, sent) = drive(agent, prompt, Src::ToolArgs, out).await;
    (got.and_then(|o| parse(&o)), sent)
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
async fn by_prompt<T>(
    spec: &AgentSpec,
    api_key: &str,
    preamble: &str,
    prompt: &str,
    out: &Out<'_>,
) -> Result<T>
where
    T: JsonSchema + DeserializeOwned + Serialize + Send + Sync + 'static,
{
    use rig::agent::{AgentBuilder, OutputMode};

    let mut b = AgentBuilder::from_model_handle(crate::agent::model_handle(spec, api_key))
        .name(&spec.agent_id)
        .preamble(preamble)
        .output_schema::<T>()
        .output_mode(OutputMode::Prompted);
    if let Some(t) = spec.temperature {
        b = b.temperature(t);
    }

    let (got, _) = drive(b.build(), prompt, Src::Text, out).await;
    parse(&got?)
}

/// 错误里带上模型原话的开头，方便排查；但别把整段几千字都塞进错误
fn head(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() <= 200 {
        return t.to_string();
    }
    t.chars().take(200).collect::<String>() + "…"
}

/// 让模型填一个 `T`，同时把里面给人看的那段话边生成边发出去。
///
/// 先试工具调用，不行就换提示词那条。
pub async fn extract<T>(
    spec: &AgentSpec,
    api_key: &str,
    preamble: &str,
    prompt: &str,
    out: &Out<'_>,
) -> Result<T>
where
    T: JsonSchema + DeserializeOwned + Serialize + Send + Sync + 'static,
{
    let key = key_of(spec);
    let skip_tool = plain_only().lock().map(|s| s.contains(&key)).unwrap_or(false);
    if skip_tool {
        return by_prompt(spec, api_key, preamble, prompt, out).await;
    }

    let (got, sent) = by_tool(spec, api_key, preamble, prompt, out).await;
    match got {
        Ok(v) => Ok(v),
        // **已经吐过字就不换路**：换一条路是从头再说一遍，界面上会出现两段
        // 前半截一样的正文。判定那几条 400 是请求被拒，在任何内容之前就回来了，
        // 所以这个条件正常永远成立 —— 它挡的是不正常的情况
        Err(e) if sent == 0 && wants_plain_json(&e.to_string()) => {
            if let Ok(mut s) = plain_only().lock() {
                s.insert(key);
            }
            by_prompt(spec, api_key, preamble, prompt, out).await
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
    /// 收到过的请求体。用来核「提示词说的工具和登记的是同一个」
    type Bodies = Arc<Mutex<Vec<String>>>;

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

    /// 产物 JSON。两条路给的都是这一份 —— 形状一样，位置不同
    const ARGS: &str = r#"{"reply":"差别在谁动手","alts":["甲去了","乙去了"]}"#;

    /// 把一段文本按每 n 字节切开（切点对齐到字符边界）。
    /// **故意切得碎**：真实的流就是这样，切在汉字和转义中间才是常态
    fn pieces(s: &str, n: usize) -> Vec<String> {
        let mut out = Vec::new();
        let mut at = 0;
        while at < s.len() {
            let mut end = (at + n).min(s.len());
            while end < s.len() && !s.is_char_boundary(end) {
                end += 1;
            }
            out.push(s[at..end].to_string());
            at = end;
        }
        out
    }

    /// 一个 chunk 的骨架。`delta` 是这一帧真正的内容
    fn chunk(delta: serde_json::Value, finish: Option<&str>) -> String {
        let mut c = serde_json::json!({
            "id": "1", "object": "chat.completion.chunk", "created": 0, "model": "m",
            "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }],
        });
        if finish.is_some() {
            // DeepSeek 的 usage 还要缓存命中那两个字段，真接口都带。
            // 漏了会被报成「供应商返回格式不对」，而那是假象
            c["usage"] = serde_json::json!({
                "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2,
                "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 1,
            });
        }
        c.to_string()
    }

    /// 请求里登记的那个输出工具叫什么。
    ///
    /// **不写死成 `final_result`** —— 那是 rig 自己挑的名字，写死了就等于
    /// 在测 rig 的命名而不是测我们的行为。照请求里登记的那个回，
    /// 才是真供应商的做法
    fn advertised_tool(body: &str) -> String {
        let at = body.find("\"tools\":[").unwrap_or(0);
        let tail = &body[at..];
        let k = "\"name\":\"";
        let i = tail.find(k).map(|i| i + k.len());
        i.and_then(|i| tail[i..].find('"').map(|j| tail[i..i + j].to_string()))
            .unwrap_or_else(|| "final_result".to_string())
    }

    /// 思考模型开口之前那段推理。**两条路前面都加上** ——
    /// 真接口就是这样，而且它正是「等待期一片空白」要填的那段
    const THINKING: &str = "先看前后两场定了什么，再想三条差别落在哪";

    fn think_frames() -> Vec<String> {
        pieces(THINKING, 11)
            .into_iter()
            .map(|p| chunk(serde_json::json!({ "reasoning_content": p }), None))
            .collect()
    }

    /// 工具那条的 SSE：输出工具的参数分好几帧来
    fn tool_frames(tool: &str) -> Vec<String> {
        let mut f = think_frames();
        for (i, p) in pieces(ARGS, 7).into_iter().enumerate() {
            // 第一帧才带 id 与函数名，后面只带参数片段 —— 真接口就是这样
            let call = if i == 0 {
                serde_json::json!({
                    "index": 0, "id": "c1", "type": "function",
                    "function": { "name": tool, "arguments": p },
                })
            } else {
                serde_json::json!({ "index": 0, "function": { "arguments": p } })
            };
            f.push(chunk(serde_json::json!({ "tool_calls": [call] }), None));
        }
        f.push(chunk(serde_json::json!({}), Some("tool_calls")));
        f
    }

    /// 提示词那条的 SSE：正文分好几帧来，还裹着思考块和围栏
    fn text_frames() -> Vec<String> {
        let body = format!("<think>先想想给哪三条</think>\n```json\n{ARGS}\n```");
        let mut f = think_frames();
        f.extend(
            pieces(&body, 9)
                .into_iter()
                .map(|p| chunk(serde_json::json!({ "content": p }), None)),
        );
        f.push(chunk(serde_json::json!({}), Some("stop")));
        f
    }

    async fn provider_with(mode: Mode, paths: Paths) -> (String, Arc<AtomicUsize>) {
        provider_full(mode, paths, Arc::new(Mutex::new(Vec::new()))).await
    }

    async fn provider_full(
        mode: Mode,
        paths: Paths,
        bodies: Bodies,
    ) -> (String, Arc<AtomicUsize>) {
        let hits = Arc::new(AtomicUsize::new(0));
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let h = hits.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = l.accept().await {
                let h = h.clone();
                let ps = paths.clone();
                let bs = bodies.clone();
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
                    if let Ok(mut v) = bs.lock() {
                        v.push(body.to_string());
                    }
                    let forced = body.contains("\"tool_choice\":\"required\"")
                        || body.contains("\"tool_choice\":{")
                        || body.contains("\"tool_choice\": \"required\"");
                    let wants_tool = body.contains("\"tools\":[");

                    // 两条路现在都是流式的，所以这里也必须真的回 SSE。
                    // 回一整个 JSON 的话，rig 那边等的是 event-stream，
                    // 测出来的就不是我们发出去的那个请求了
                    if (mode == Mode::Thinking && forced) || mode == Mode::Broken {
                        let body = "{\"error\":{\"message\":\"Thinking mode does not support \
                                    this tool_choice\",\"type\":\"invalid_request_error\"}}";
                        let head = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\
                             Content-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = sock.write_all(head.as_bytes()).await;
                        let _ = sock.write_all(body.as_bytes()).await;
                        let _ = sock.flush().await;
                        return;
                    }

                    let frames = if wants_tool {
                        tool_frames(&advertised_tool(body))
                    } else {
                        text_frames()
                    };
                    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                                Cache-Control: no-cache\r\nConnection: close\r\n\r\n";
                    let _ = sock.write_all(head.as_bytes()).await;
                    for f in frames {
                        let _ = sock.write_all(format!("data: {f}\n\n").as_bytes()).await;
                        let _ = sock.flush().await;
                    }
                    let _ = sock.write_all(b"data: [DONE]\n\n").await;
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

    /// 只关心正文时用它：推理过程扔掉
    fn reply_only<'a>(reply: &'a (dyn Fn(&str) + Sync)) -> Out<'a> {
        Out { reply, think: &|_: &str| {}, usage: &|_: Usage| {} }
    }

    /// 收流式正文，**按块记**。`Fn(&str)`，所以内部得自己加锁。
    ///
    /// 只记一整段的话，「真流式」和「等答完再一次性发出来」看起来一模一样 ——
    /// 而那正是这次要改掉的东西，所以块数得留下来
    #[derive(Default)]
    struct Said(Mutex<Vec<String>>);

    impl Said {
        fn sink(&self) -> impl Fn(&str) + Sync + '_ {
            move |t: &str| self.0.lock().unwrap().push(t.to_string())
        }

        fn text(&self) -> String {
            self.0.lock().unwrap().concat()
        }
        fn chunks(&self) -> usize {
            self.0.lock().unwrap().len()
        }
    }

    #[tokio::test]
    async fn 思考模型那条_400_会自动换成提示词那条并拿到结构() {
        let (base, hits) = provider(Mode::Thinking).await;
        let s = spec(&base, "thinking-1");
        let said = Said::default();
        let got: Alts =
            extract(&s, "sk-x", "你是编剧。", "给三条走向", &reply_only(&said.sink())).await.unwrap();

        assert_eq!(got.reply, "差别在谁动手");
        assert_eq!(got.alts, ["甲去了", "乙去了"]);
        // 两次请求：先工具调用挨了 400，再走提示词那条
        assert!(hits.load(Ordering::SeqCst) >= 2, "应该试过两条路");
        // 换路之后那条也得是流式的 —— 这条路上正文裹在思考块和围栏里，
        // 刨出来的只该是 reply，不该带上 `<think>` 和 ```
        assert_eq!(said.text(), "差别在谁动手", "提示词那条也要边跑边吐字");
        assert!(said.chunks() > 1, "该是分好几块来的，实际 {} 块", said.chunks());
    }

    #[tokio::test]
    async fn 同一个模型第二次直接走提示词_不再白挨一个_400() {
        let (base, hits) = provider(Mode::Thinking).await;
        let s = spec(&base, "thinking-2");

        let _: Alts = extract(&s, "sk-x", "p", "q", &silent()).await.unwrap();
        let first = hits.load(Ordering::SeqCst);
        let _: Alts = extract(&s, "sk-x", "p", "q", &silent()).await.unwrap();
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
        let said = Said::default();
        let got: Alts =
            extract(&s, "sk-x", "你是编剧。", "给三条走向", &reply_only(&said.sink())).await.unwrap();

        assert_eq!(got.alts, ["甲去了", "乙去了"]);
        assert_eq!(hits.load(Ordering::SeqCst), 1, "该一次就成，不用换路");
        // 工具那条的正文在 `submit` 的参数里，要能从没写完的参数里刨出来。
        // 产物那几条（甲去了/乙去了）不该混进正文
        assert_eq!(said.text(), "差别在谁动手", "工具那条也要边跑边吐字");
        // **这条是「真流式」和「等答完再假装打字」的分界线**：一块就到齐，
        // 说明我们又在等整轮跑完了
        assert!(said.chunks() > 1, "该是分好几块来的，实际 {} 块", said.chunks());
    }

    #[tokio::test]
    async fn 通用客户端那几家躲不开_所以兜底那条必须在() {
        let (base, hits) = provider(Mode::Thinking).await;
        // 火山方舟、阿里百炼、腾讯混元、自定义端点 rig 都没有专属模块
        let s = spec_of("custom", &base, "generic-1");
        let got: Alts =
            extract(&s, "sk-x", "你是编剧。", "给三条走向", &silent()).await.unwrap();

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
        let _: Alts = extract(&s, "sk-x", "p", "q", &silent()).await.unwrap();

        let got = paths.lock().unwrap().clone();
        assert!(got.len() >= 2, "两条路都该发过请求：{got:?}");
        for p in &got {
            assert!(p.ends_with("/chat/completions"), "问错接口了：{p}");
        }
    }

    /// **思考模型的等待期不该是一片空白。**
    ///
    /// reply 是真流式了，但思考模型在开口之前会先想很久 —— 那段时间产物 JSON
    /// 里一个字都没有。推理过程得单独接出来，而且**不能混进正文**：那是模型
    /// 的草稿，不是它的回答。
    #[tokio::test]
    async fn 推理过程单独一路出来_不混进正文() {
        let (base, _) = provider(Mode::Thinking).await;
        let s = spec_of("deepseek", &base, "reason-1");
        let reply = Said::default();
        let think = Said::default();
        let r = reply.sink();
        let t = think.sink();
        let got: Alts = extract(&s, "sk-x", "p", "q", &Out { reply: &r, think: &t, usage: &|_: Usage| {} })
            .await
            .unwrap();

        assert_eq!(got.reply, "差别在谁动手");
        assert_eq!(think.text(), THINKING, "推理过程该完整地走 think 这一路");
        assert!(think.chunks() > 1, "也该是分好几块来的");
        assert_eq!(reply.text(), "差别在谁动手", "推理过程不该漏进正文");
    }

    /// **提示词让模型调的那个工具，必须就是请求里登记的那个。**
    ///
    /// 这个洞真踩过：照抄 rig `ExtractorBuilder` 的提示词（里面写死了「调
    /// `submit`」），而 `submit` 这个名字是它用 `pub(crate)` 的
    /// `AgentRunner::output_tool()` 改的，外面改不了 —— 于是请求里登记的是
    /// `final_result`，提示词却让模型调 `submit`。模型照着提示词调，rig 判成
    /// 「调了一个不存在的工具」，报错原话是：
    ///
    /// ```text
    /// model attempted to call unknown or disallowed tool `submit`.
    /// Allowed tools for this turn: ["final_result"]
    /// ```
    ///
    /// 看着像模型不听话，其实是我们自己把提示词和工具表说成了两件事。
    #[tokio::test]
    async fn 提示词里让模型调的工具_和请求里登记的是同一个() {
        let bodies: Bodies = Arc::new(Mutex::new(Vec::new()));
        let (base, _) =
            provider_full(Mode::Thinking, Arc::new(Mutex::new(Vec::new())), bodies.clone()).await;
        // deepseek 那支躲开了强制 tool_choice，所以第一次请求就是带工具表的那条
        let s = spec_of("deepseek", &base, "toolname-1");
        let _: Alts = extract(&s, "sk-x", "你是编剧。", "q", &silent()).await.unwrap();

        let body = bodies.lock().unwrap().first().cloned().unwrap();
        assert!(body.contains("\"tools\":["), "这条请求该带工具表：{body}");
        let tool = advertised_tool(&body);
        assert!(
            body.contains(&format!("`{tool}`")),
            "提示词里没提到登记的那个工具 `{tool}`"
        );
        // 反面：提示词里不该出现别的工具名。写死 `submit` 就是这么漏的
        assert!(
            tool == "submit" || !body.contains("`submit`"),
            "提示词里让模型调 `submit`，可登记的是 `{tool}`"
        );
    }

    #[tokio::test]
    async fn 两条路都不通时如实报错_不假装成功() {
        let (base, _) = provider(Mode::Broken).await;
        let s = spec(&base, "broken-1");
        let said = Said::default();
        let e = extract::<Alts>(&s, "sk-x", "p", "q", &reply_only(&said.sink())).await.unwrap_err();
        assert_eq!(said.text(), "", "一个字都没吐过，界面上不该留下半句话");
        // 换路之后仍然失败，报的是真实原因而不是「解析不出来」
        assert!(matches!(e.code(), "http" | "decode"), "报的是 {}", e.code());
        assert!(e.to_string().contains("400") || e.to_string().contains("Thinking"),
            "错误里要留着供应商的原话：{e}");
    }
}
