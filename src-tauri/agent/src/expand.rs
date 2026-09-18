//! 延展一场的剧情走向。
//!
//! 与起草大纲同一条路子（Rig 的 Extractor 填 schema），**区别在输入**：
//! 这条要的是「这一场在整条线里的位置」—— 前一版是三个固定句式套上这一场的
//! 标题，只给标题的话模型给的三条和那份模板差别不大。所以前后场次、所在幕、
//! 已定稿的角色都要送过去。
//!
//! 产物是纯字符串数组，与前端 `alts` 补丁同形；采纳时按 beatId 落到那一场下面。

use crate::agent::AgentSpec;
use studio_error::{Error, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 最多留几条。模型多给了就截断 —— 界面上一场挂七八条走向没人看
pub const MAX_ALTS: usize = 4;

/// 一条走向的最大长度（字符）。超了截断并补省略号 ——
/// 走向是给人扫一眼做选择的，写成一段话就失去了「三条并排比较」的意义
pub const MAX_CHARS: usize = 60;

/// 相邻场次的简报。只要键和功能，不要正文
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SceneBrief {
    /// 场次键，形如「场景3」
    pub k: String,
    /// 这一场承担什么功能
    pub t: String,
}

/// 模型要填的结构
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AltsDraft {
    /// 给人看的一段话：这三条差别在哪
    pub reply: String,
    /// 备选走向，每条一句话，能独立读懂
    pub alts: Vec<String>,
}

/// 给模型的输入：这一场 + 它的上下文
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandInput {
    pub project: String,
    /// 这一场的场次键与功能
    pub beat_key: String,
    pub beat_t: String,
    /// 所在幕
    #[serde(default)]
    pub act_title: String,
    #[serde(default)]
    pub act_span: String,
    /// 前面几场（最近的排最后）与后面几场
    #[serde(default)]
    pub before: Vec<SceneBrief>,
    #[serde(default)]
    pub after: Vec<SceneBrief>,
    /// 已定稿的角色，「名字：描述」。**只送定稿的** —— 草稿资产随时会改
    #[serde(default)]
    pub leads: Vec<String>,
    /// 用户那句话。技能卡触发时为空
    #[serde(default)]
    pub idea: String,
}

fn list(items: &[SceneBrief]) -> String {
    if items.is_empty() {
        return "（没有）".into();
    }
    items.iter().map(|s| format!("{}：{}", s.k, s.t)).collect::<Vec<_>>().join("；")
}

/// 拼给模型的那段话。独立成函数是为了能单测「上下文真的进去了」。
///
/// 那句「不要只换形容词」是这条链路的要点：走向的差别要落在
/// **谁在场、谁知情、谁动手**上，否则三条读起来是同一件事的三种说法，
/// 而后面的分镜和资产也就不会有任何不同。
pub fn prompt_of(input: &ExpandInput) -> String {
    let idea = input.idea.trim();
    let want = if idea.is_empty() {
        String::new()
    } else {
        format!("\n用户另外提了一句，按它的方向来：{idea}")
    };
    let leads = if input.leads.is_empty() {
        "（还没有定稿的角色）".to_string()
    } else {
        input.leads.join("；")
    };
    format!(
        "项目《{proj}》，这一场在「{act}」（{span}）里。\n\
         这一场：{key}：{t}\n\
         前面几场：{before}\n\
         后面几场：{after}\n\
         已定稿的角色：{leads}\n\
         \n\
         给这一场 3 条不同的走向，每条一句话，不超过 {max} 字，能独立读懂。\n\
         **差别要落在谁在场、谁知情、谁动手上，不要只换形容词。**\n\
         前后场次已经定了，你给的走向要接得上它们 —— 改这一场不是把后面推翻。\n\
         在 reply 里用一句话说清这三条的差别在哪。{want}",
        proj = input.project,
        act = if input.act_title.trim().is_empty() { "未归幕" } else { input.act_title.trim() },
        span = if input.act_span.trim().is_empty() { "时间未定" } else { input.act_span.trim() },
        key = input.beat_key,
        t = input.beat_t,
        before = list(&input.before),
        after = list(&input.after),
        max = MAX_CHARS,
    )
}

/// 收拾模型给的那几条：去空白、去空、去重、截断过长、最多留 MAX_ALTS 条。
///
/// **一条都不剩就是失败**，不要返回一个空数组让界面显示「0 条备选走向」——
/// 那种产物采纳下去什么也不会发生，而用户以为它做完了。
pub fn tidy(draft: &mut AltsDraft) -> Result<()> {
    let mut out: Vec<String> = Vec::new();
    for raw in draft.alts.drain(..) {
        let mut s = raw.trim().trim_start_matches(['-', '*', '•']).trim().to_string();
        if s.is_empty() || out.iter().any(|x| x == &s) {
            continue;
        }
        if s.chars().count() > MAX_CHARS {
            s = s.chars().take(MAX_CHARS).collect::<String>() + "…";
        }
        out.push(s);
        if out.len() == MAX_ALTS {
            break;
        }
    }
    if out.is_empty() {
        return Err(Error::Decode("模型没给出任何可用的走向".into()));
    }
    draft.alts = out;
    draft.reply = draft.reply.trim().to_string();
    Ok(())
}

/// 跑一次。
pub async fn expand(
    spec: &AgentSpec,
    api_key: &str,
    preamble: &str,
    input: &ExpandInput,
) -> Result<AltsDraft> {
    // prelude 一次带齐 CompletionClient（父 trait）与 AgentClientExt，
    // 只导后者的话 completion_model 不在方法解析范围内，.extractor() 找不到
    use rig::prelude::*;
    use rig::providers::openai;

    let client = openai::Client::builder()
        .api_key(api_key)
        .base_url(&spec.base_url)
        .build()
        .map_err(|e| Error::Http(e.to_string()))?;

    let extractor = client
        .extractor::<AltsDraft>(&spec.model.model)
        .preamble(preamble)
        .build();

    let mut draft = extractor
        .extract(prompt_of(input))
        .await
        .map_err(|e| Error::Decode(e.to_string()))?;
    tidy(&mut draft)?;
    Ok(draft)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brief(k: &str, t: &str) -> SceneBrief {
        SceneBrief { k: k.into(), t: t.into() }
    }

    fn input() -> ExpandInput {
        ExpandInput {
            project: "找猫".into(),
            beat_key: "场景3".into(),
            beat_t: "第一次尝试解决，失败".into(),
            act_title: "失衡".into(),
            act_span: "1:20–2:30".into(),
            before: vec![brief("场景2", "异样被放大")],
            after: vec![brief("场景4", "揭示真正的规则")],
            leads: vec!["小满：短发女孩，红色雨衣".into()],
            idea: String::new(),
        }
    }

    fn draft(alts: &[&str]) -> AltsDraft {
        AltsDraft {
            reply: " 三条的差别在谁动手。 ".into(),
            alts: alts.iter().map(|s| (*s).to_string()).collect(),
        }
    }

    #[test]
    fn 上下文真的进了提示词_这条链路的意义就在这儿() {
        let p = prompt_of(&input());
        // 这一场自己
        assert!(p.contains("场景3：第一次尝试解决，失败"));
        // 所在幕
        assert!(p.contains("失衡") && p.contains("1:20–2:30"));
        // 前后场次 —— 缺了这个，模型给的三条接不上后面
        assert!(p.contains("场景2：异样被放大"));
        assert!(p.contains("场景4：揭示真正的规则"));
        // 已定稿角色
        assert!(p.contains("小满"));
    }

    #[test]
    fn 要求差别落在人物关系上_而不是换形容词() {
        let p = prompt_of(&input());
        assert!(p.contains("谁在场、谁知情、谁动手"));
        assert!(p.contains("不要只换形容词"));
        assert!(p.contains("接得上"), "要说清前后场次已经定了");
    }

    #[test]
    fn 没有前后场次时说没有_不留一个空冒号() {
        let mut i = input();
        i.before.clear();
        i.after.clear();
        i.leads.clear();
        let p = prompt_of(&i);
        assert!(p.contains("前面几场：（没有）"));
        assert!(p.contains("后面几场：（没有）"));
        assert!(p.contains("还没有定稿的角色"));
    }

    #[test]
    fn 用户那句话在就跟着走_不在就不留空指令() {
        assert!(!prompt_of(&input()).contains("用户另外提了一句"));
        let mut i = input();
        i.idea = "  要更黑暗一点  ".into();
        let p = prompt_of(&i);
        assert!(p.contains("要更黑暗一点"));
        assert!(!p.contains("  要更黑暗一点  "), "两边空白要修掉");
    }

    #[test]
    fn 幕信息缺失时给兜底说法_不把空串拼进去() {
        let mut i = input();
        i.act_title = "  ".into();
        i.act_span = String::new();
        let p = prompt_of(&i);
        assert!(p.contains("未归幕") && p.contains("时间未定"));
    }

    #[test]
    fn 收拾产物_去空白去空去重() {
        let mut d = draft(&["  甲去了  ", "", "甲去了", "乙去了", "   "]);
        tidy(&mut d).unwrap();
        assert_eq!(d.alts, ["甲去了", "乙去了"]);
        assert_eq!(d.reply, "三条的差别在谁动手。");
    }

    #[test]
    fn 模型爱加的列表符号被剥掉() {
        let mut d = draft(&["- 甲去了", "* 乙去了", "• 丙去了"]);
        tidy(&mut d).unwrap();
        assert_eq!(d.alts, ["甲去了", "乙去了", "丙去了"]);
    }

    #[test]
    fn 多给了就截断_界面上一场挂七八条没人看() {
        let many: Vec<String> = (1..=9).map(|i| format!("走向{i}")).collect();
        let mut d = AltsDraft { reply: "x".into(), alts: many };
        tidy(&mut d).unwrap();
        assert_eq!(d.alts.len(), MAX_ALTS);
        assert_eq!(d.alts[0], "走向1");
    }

    #[test]
    fn 过长的一条被截断_而不是把一段话塞进一行() {
        let long = "甲".repeat(MAX_CHARS + 20);
        let mut d = AltsDraft { reply: "x".into(), alts: vec![long] };
        tidy(&mut d).unwrap();
        assert_eq!(d.alts[0].chars().count(), MAX_CHARS + 1, "截断后补一个省略号");
        assert!(d.alts[0].ends_with('…'));
    }

    #[test]
    fn 一条都不剩时报错_不给一个空数组让界面显示_0_条() {
        let mut d = draft(&["", "   ", "\n"]);
        let e = tidy(&mut d).unwrap_err();
        assert_eq!(e.code(), "decode");
        assert!(e.to_string().contains("没给出任何"));
    }

    /// 端不通时要报 decode/http，而不是 panic 或者静静返回空产物。
    /// 真发请求的那条路（Rig Extractor）没法在这儿造响应，这条至少守住失败形状。
    #[tokio::test]
    async fn 端点不通时如实报错_不返回空产物() {
        // 用真实的解析路径造 spec：手写字段的话，AgentSpec 加字段这条测试就崩
        let cfg: studio_conf::config::AgentConfig = serde_json::from_value(serde_json::json!({
            "agentId": "writer",
        }))
        .unwrap();
        let globals = std::collections::HashMap::from([(
            "text".to_string(),
            studio_conf::config::ModelRef { provider: "custom".into(), model: "x".into() },
        )]);
        let providers = std::collections::HashMap::from([(
            "custom".to_string(),
            serde_json::from_value::<studio_conf::config::ProviderSetting>(serde_json::json!({
                "id": "custom",
                "baseUrl": "http://127.0.0.1:1",
            }))
            .unwrap(),
        )]);
        let spec = crate::agent::resolve(&cfg, "你是编剧。", &globals, &providers).unwrap();
        let e = expand(&spec, "sk-x", "你是编剧。", &input()).await.unwrap_err();
        assert!(matches!(e.code(), "decode" | "http"), "报的是 {}", e.code());
    }

    #[test]
    fn 产物能序列化成前端认识的形状() {
        let mut d = draft(&["甲去了", "乙去了", "丙去了"]);
        tidy(&mut d).unwrap();
        let v = serde_json::to_value(&d).unwrap();
        assert!(v["reply"].is_string());
        assert_eq!(v["alts"].as_array().unwrap().len(), 3);
        assert!(v["alts"][0].is_string());
    }
}
