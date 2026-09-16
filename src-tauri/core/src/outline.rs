//! 起草大纲：第一条端到端打通的链路。
//!
//! 走 Rig 的 Extractor 而不是自由文本 + 正则：
//! 模型直接填一个有 schema 的结构，解析失败 Rig 会自动重试。
//! 产物形状与前端 `domain/story/model.ts` 的 `Act` 一致 —— 采纳时直接进项目树。

use crate::agent::AgentSpec;
use crate::error::{Error, Result};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// 一场。`k` 是场次键，与 `Shot.sceneKey` 对齐
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Beat {
    /// 场次键，形如「场景1」。由 Rust 统一编号，不让模型自己编
    #[serde(default)]
    pub k: String,
    /// 这一场承担什么功能，一句话
    pub t: String,
}

/// 一幕
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Act {
    /// 幕标题
    pub t: String,
    /// 时间跨度，形如「0:00–1:20」
    pub span: String,
    pub beats: Vec<Beat>,
}

/// 模型要填的结构。**只让它填内容，id 与编号由 Rust 补** ——
/// 让模型生成 id 是自找麻烦：它会重复、会跳号、会和已有的撞。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct OutlineDraft {
    /// 给人看的一段话：这版结构为什么这么搭
    pub reply: String,
    pub acts: Vec<Act>,
}

/// 补齐 id 与场次编号。纯函数，可单测 —— 这是「模型不可靠、程序兜底」的那一层。
pub fn number(draft: &mut OutlineDraft, existing_beats: usize) {
    let mut scene = existing_beats + 1;
    for (ai, act) in draft.acts.iter_mut().enumerate() {
        for beat in act.beats.iter_mut() {
            beat.k = format!("场景{scene}");
            scene += 1;
        }
        // 幕的 id 交给前端在采纳时生成；这里只保证场次键唯一且连续
        let _ = ai;
    }
}

/// 给模型的输入：项目现状 + 用户那句话
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineInput {
    pub project: String,
    /// 用户输入的灵感；技能卡触发时可能为空
    #[serde(default)]
    pub idea: String,
    /// 已有幕数与场数 —— 有大纲时是「补」不是「推翻重来」
    #[serde(default)]
    pub act_count: usize,
    #[serde(default)]
    pub beat_count: usize,
}

/// 拼给模型的那段话。独立成函数是为了能单测「有无大纲时说法不同」
pub fn prompt_of(input: &OutlineInput) -> String {
    let idea = if input.idea.trim().is_empty() {
        "（用户没给具体灵感，按项目名发挥）".to_string()
    } else {
        input.idea.trim().to_string()
    };
    if input.act_count == 0 {
        format!(
            "项目《{}》还没有大纲。按三幕结构起草一版，每幕 2–3 场。\n\
             每一场先写它承担什么功能，不要写具体台词。\n\
             灵感：{idea}",
            input.project
        )
    } else {
        format!(
            "项目《{}》已有 {} 幕 {} 场。**不要推翻重来**，只补 1–2 场，\n\
             补在结构最薄的地方，并在 reply 里说清补在哪、为什么。\n\
             灵感：{idea}",
            input.project, input.act_count, input.beat_count
        )
    }
}

/// 跑一次。Rig 的 Extractor 负责让模型填 schema，失败自动重试。
pub async fn draft(spec: &AgentSpec, api_key: &str, input: &OutlineInput) -> Result<OutlineDraft> {
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
        .extractor::<OutlineDraft>(&spec.model.model)
        .preamble(&spec.preamble)
        .build();

    let mut draft = extractor
        .extract(prompt_of(input))
        .await
        .map_err(|e| Error::Decode(e.to_string()))?;
    number(&mut draft, input.beat_count);
    Ok(draft)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft_of(shape: &[usize]) -> OutlineDraft {
        OutlineDraft {
            reply: "x".into(),
            acts: shape
                .iter()
                .map(|n| Act {
                    t: "幕".into(),
                    span: "0:00–1:00".into(),
                    beats: (0..*n).map(|_| Beat { k: String::new(), t: "场".into() }).collect(),
                })
                .collect(),
        }
    }

    #[test]
    fn 场次键由程序编号_跨幕连续且唯一() {
        let mut d = draft_of(&[2, 3]);
        number(&mut d, 0);
        let keys: Vec<_> = d.acts.iter().flat_map(|a| a.beats.iter().map(|b| b.k.clone())).collect();
        assert_eq!(keys, ["场景1", "场景2", "场景3", "场景4", "场景5"]);
    }

    #[test]
    fn 已有场次时接着编_不与既有撞车() {
        let mut d = draft_of(&[2]);
        number(&mut d, 8);
        let keys: Vec<_> = d.acts.iter().flat_map(|a| a.beats.iter().map(|b| b.k.clone())).collect();
        assert_eq!(keys, ["场景9", "场景10"]);
    }

    #[test]
    fn 模型填的场次键会被覆盖_不信任模型编号() {
        let mut d = draft_of(&[1]);
        d.acts[0].beats[0].k = "模型瞎写的".into();
        number(&mut d, 0);
        assert_eq!(d.acts[0].beats[0].k, "场景1");
    }

    #[test]
    fn 空大纲时提示词说起草_有大纲时说别推翻重来() {
        let fresh = OutlineInput {
            project: "猫".into(), idea: "".into(), act_count: 0, beat_count: 0,
        };
        assert!(prompt_of(&fresh).contains("三幕结构起草"));

        let existing = OutlineInput {
            project: "猫".into(), idea: "加一场".into(), act_count: 3, beat_count: 8,
        };
        let p = prompt_of(&existing);
        assert!(p.contains("不要推翻重来"));
        assert!(p.contains("3 幕 8 场"));
        assert!(p.contains("加一场"));
    }

    #[test]
    fn 没给灵感时不留空_给模型一个明确的兜底说法() {
        let i = OutlineInput {
            project: "猫".into(), idea: "   ".into(), act_count: 0, beat_count: 0,
        };
        assert!(prompt_of(&i).contains("没给具体灵感"));
    }

    #[test]
    fn 产物能序列化成前端认识的形状() {
        let mut d = draft_of(&[1]);
        number(&mut d, 0);
        let v = serde_json::to_value(&d).unwrap();
        assert!(v["reply"].is_string());
        assert_eq!(v["acts"][0]["beats"][0]["k"], "场景1");
        assert!(v["acts"][0]["span"].is_string());
    }
}
