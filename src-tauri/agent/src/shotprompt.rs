//! 补写提示词：第二条端到端链路。
//!
//! 与起草大纲的分工一样 —— 模型只写**内容**，编号、归属、范围由 Rust 兜底。
//! 这里兜的是 id：模型极易把 id 拼错、编出不存在的镜头、或者把同一镜写两遍。
//! 提示词写错了人一眼能看出来，写到别的镜头上却是静默的错。

use crate::agent::AgentSpec;
use studio_error::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 一镜的现状，由前端整理好送进来（资产引用已经展开成描述，Rust 不碰项目库）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotBrief {
    pub id: String,
    /// 景别中文名，如「全景」
    pub size: String,
    /// 景别对应的英文术语，前端词表给的 —— 不让模型自己翻，术语要稳定
    #[serde(default)]
    pub size_en: String,
    /// 这镜要发生什么，中文
    #[serde(default)]
    pub desc: String,
    /// 这镜引用的资产描述，已展开
    #[serde(default)]
    pub refs: Vec<String>,
}

/// 模型要填的一条
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShotPrompt {
    /// 镜号，必须是输入里给过的
    pub id: String,
    /// 英文提示词
    pub own: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct PromptDraft {
    /// 给人看的一段话：这批提示词按什么思路写的
    pub reply: String,
    pub prompts: Vec<ShotPrompt>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptInput {
    pub project: String,
    /// 项目画风，英文片段。每条提示词都要带上它，画风才统一
    #[serde(default)]
    pub style_prompt: String,
    pub shots: Vec<ShotBrief>,
}

/// 对齐模型产物与真实镜头集合。**纯函数，这是兜底那一层**：
///
/// - 不在请求集合里的 id 直接丢（模型编的）
/// - 同一 id 只取第一条（模型重复写）
/// - 空提示词丢掉（写了等于没写，留着会让这镜从「缺提示词」里消失）
/// - 缺画风的补上画风（模型经常忘）
///
/// 返回丢掉的 id，调用方可以据此知道哪些镜没补上。
pub fn reconcile(draft: &mut PromptDraft, input: &PromptInput) -> Vec<String> {
    let wanted: Vec<&str> = input.shots.iter().map(|s| s.id.as_str()).collect();
    let style = input.style_prompt.trim();

    let mut seen: Vec<String> = Vec::new();
    draft.prompts.retain_mut(|p| {
        let id = p.id.trim().to_string();
        if !wanted.contains(&id.as_str()) || seen.contains(&id) || p.own.trim().is_empty() {
            return false;
        }
        p.id = id.clone();
        p.own = p.own.trim().to_string();
        if !style.is_empty() && !p.own.to_lowercase().contains(&style.to_lowercase()) {
            p.own = format!("{}, {style}", p.own);
        }
        seen.push(id);
        true
    });

    wanted
        .iter()
        .filter(|id| !seen.iter().any(|s| s == *id))
        .map(|s| s.to_string())
        .collect()
}

/// 拼给模型的那段话。每镜一行，把它自己的景别 / 内容 / 引用摆明白 ——
/// 模型不需要「创作」，需要的是把这几段合成一条稳定的英文提示词。
pub fn prompt_of(input: &PromptInput) -> String {
    let mut s = format!(
        "项目《{}》有 {} 镜缺提示词。给每一镜写一条**英文**文生图/文生视频提示词。\n\n\
         规则：\n\
         - id 必须原样抄下面给的镜号，不要改、不要编、不要漏\n\
         - 用给定的英文景别术语开头，保证景别不跑\n\
         - 把该镜引用的资产描述织进去，人物与场景才前后一致\n\
         - 只写画面里看得见的东西，不写情节、不写台词、不写镜头调度术语之外的解释\n",
        input.project,
        input.shots.len()
    );
    if !input.style_prompt.trim().is_empty() {
        s.push_str(&format!("- 每条结尾统一带上画风：{}\n", input.style_prompt.trim()));
    }
    s.push_str("\n镜头：\n");
    for sh in &input.shots {
        s.push_str(&format!(
            "- {} | 景别 {}（{}）| 内容：{} | 引用：{}\n",
            sh.id,
            sh.size,
            if sh.size_en.is_empty() { "medium shot" } else { &sh.size_en },
            if sh.desc.trim().is_empty() { "（未写）" } else { sh.desc.trim() },
            if sh.refs.is_empty() { "无".to_string() } else { sh.refs.join("；") },
        ));
    }
    s.push_str("\nreply 里用中文说一句这批提示词是按什么思路写的，不要罗列提示词本身。");
    s
}

/// 跑一次。结构化输出走 `structured::extract` —— 工具调用不通时它会自动换成
/// 提示词那条（思考模型不接受强制 tool_choice，见那个模块的说明）。
pub async fn draft(
    spec: &AgentSpec,
    api_key: &str,
    preamble: &str,
    input: &PromptInput,
    out: &crate::structured::Out<'_>,
) -> Result<PromptDraft> {
    let mut draft: PromptDraft =
        crate::structured::extract(spec, api_key, preamble, &prompt_of(input), out).await?;
    reconcile(&mut draft, input);
    Ok(draft)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brief(id: &str) -> ShotBrief {
        ShotBrief {
            id: id.into(),
            size: "全景".into(),
            size_en: "full shot".into(),
            desc: "交代环境".into(),
            refs: vec!["11 岁小女孩, 米色针织衫".into()],
        }
    }

    fn input_of(ids: &[&str], style: &str) -> PromptInput {
        PromptInput {
            project: "猫".into(),
            style_prompt: style.into(),
            shots: ids.iter().map(|i| brief(i)).collect(),
        }
    }

    fn draft_of(pairs: &[(&str, &str)]) -> PromptDraft {
        PromptDraft {
            reply: "按景别合成".into(),
            prompts: pairs
                .iter()
                .map(|(i, o)| ShotPrompt { id: (*i).into(), own: (*o).into() })
                .collect(),
        }
    }

    #[test]
    fn 模型编出来的镜号会被丢掉_不写到不存在的镜头上() {
        let i = input_of(&["s1-1"], "");
        let mut d = draft_of(&[("s1-1", "full shot, girl"), ("s9-9", "wide shot, cat")]);
        let missed = reconcile(&mut d, &i);
        assert_eq!(d.prompts.len(), 1);
        assert_eq!(d.prompts[0].id, "s1-1");
        assert!(missed.is_empty());
    }

    #[test]
    fn 同一镜写两遍只留第一条() {
        let i = input_of(&["s1-1"], "");
        let mut d = draft_of(&[("s1-1", "first"), ("s1-1", "second")]);
        reconcile(&mut d, &i);
        assert_eq!(d.prompts.len(), 1);
        assert_eq!(d.prompts[0].own, "first");
    }

    #[test]
    fn 空提示词算没补上_不能让这镜从缺提示词里消失() {
        let i = input_of(&["s1-1", "s1-2"], "");
        let mut d = draft_of(&[("s1-1", "   "), ("s1-2", "full shot, cat")]);
        let missed = reconcile(&mut d, &i);
        assert_eq!(d.prompts.len(), 1);
        assert_eq!(missed, ["s1-1"]);
    }

    #[test]
    fn 漏写的镜号会被报出来_而不是静悄悄少一条() {
        let i = input_of(&["s1-1", "s1-2", "s1-3"], "");
        let mut d = draft_of(&[("s1-2", "x")]);
        let missed = reconcile(&mut d, &i);
        assert_eq!(missed, ["s1-1", "s1-3"]);
    }

    #[test]
    fn 模型忘了画风时补上_已经带了就不重复() {
        let i = input_of(&["s1-1", "s1-2"], "film grain");
        let mut d = draft_of(&[("s1-1", "full shot, cat"), ("s1-2", "wide shot, Film Grain")]);
        reconcile(&mut d, &i);
        assert_eq!(d.prompts[0].own, "full shot, cat, film grain");
        assert_eq!(d.prompts[1].own, "wide shot, Film Grain", "已带画风不该再缀一遍");
    }

    #[test]
    fn 镜号两边的空白会被修掉_模型经常带空格() {
        let i = input_of(&["s1-1"], "");
        let mut d = draft_of(&[(" s1-1 ", " full shot, cat ")]);
        reconcile(&mut d, &i);
        assert_eq!(d.prompts[0].id, "s1-1");
        assert_eq!(d.prompts[0].own, "full shot, cat");
    }

    #[test]
    fn 提示词里摆明每镜的景别与引用_模型不用猜() {
        let i = input_of(&["s1-1"], "film grain");
        let p = prompt_of(&i);
        assert!(p.contains("s1-1"));
        assert!(p.contains("full shot"));
        assert!(p.contains("米色针织衫"));
        assert!(p.contains("film grain"));
        assert!(p.contains("原样抄"));
    }

    #[test]
    fn 没设画风时不出现空的画风要求() {
        let p = prompt_of(&input_of(&["s1-1"], "  "));
        assert!(!p.contains("统一带上画风"));
    }

    #[test]
    fn 产物能序列化成前端认识的形状() {
        let d = draft_of(&[("s1-1", "full shot")]);
        let v = serde_json::to_value(&d).unwrap();
        assert!(v["reply"].is_string());
        assert_eq!(v["prompts"][0]["id"], "s1-1");
        assert_eq!(v["prompts"][0]["own"], "full shot");
    }
}
