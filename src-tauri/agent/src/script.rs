//! 写剧本：按大纲的一场写正文。
//!
//! # 模型只写内容，结构由程序补
//!
//! 模型填的是「地点、时间、这一场发生的几行」。**场次键、幕标题、Markdown
//! 的骨架都由程序拼**（`body_of`）—— 与大纲那条一个道理：让模型写
//! `**场景3**` 这种结构标记，它会写错、会和已有的撞，而那种错在界面上
//! 看起来像是正常内容。
//!
//! # 前一场的结尾要送进去
//!
//! 这是这条链路有意义的原因。只给「这一场承担什么功能」的话，模型写出来的
//! 和本地那份模板差别不大（那一版就是几个固定句式套标题）。一场之所以能接得上，
//! 是因为它知道上一场停在哪儿、谁在场、观众已经知道了什么。

use crate::agent::AgentSpec;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use studio_error::{Error, Result};

/// 一场最多几行。超了不是更详细，是模型开始灌水
pub const MAX_LINES: usize = 24;
/// 一行最多几个字。再长就不是一行动作或一句台词了
pub const MAX_CHARS: usize = 120;

/// 模型要填的结构
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ScriptDraft {
    /// 给人看的一段话：这一场为什么这么写
    pub reply: String,
    /// 地点，短语。比如「旧公寓客厅」
    pub place: String,
    /// 时间，短语。比如「深夜」「第二天清晨」
    pub time: String,
    /// 这一场的正文，一行一句。动作行直接写，台词行写成 `名字："……"`
    pub lines: Vec<String>,
}

/// 给模型的输入：这一场 + 它接在哪儿
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptInput {
    pub project: String,
    /// 场次键，形如「场景3」。**只用来告诉模型这是第几场**，它不该把这个写进正文
    pub beat_key: String,
    /// 这一场承担什么功能
    pub beat_t: String,
    #[serde(default)]
    pub act_title: String,
    /// 已定稿的角色，「名字：描述」。**只送定稿的** —— 草稿随时会改
    #[serde(default)]
    pub leads: Vec<String>,
    /// 已定稿的场景资产，给模型挑地点用
    #[serde(default)]
    pub places: Vec<String>,
    /// 前一场正文的结尾几行。**这一场要接得上它**
    #[serde(default)]
    pub prev_tail: String,
    /// 用户输入的那句话；技能卡触发时可能为空
    #[serde(default)]
    pub idea: String,
}

fn list(label: &str, xs: &[String], empty: &str) -> String {
    if xs.is_empty() {
        format!("{label}：{empty}")
    } else {
        format!("{label}：{}", xs.join("；"))
    }
}

/// 拼给模型的那段话。独立成函数是为了能单测「有没有前一场时说法不同」
pub fn prompt_of(input: &ScriptInput) -> String {
    let act = if input.act_title.trim().is_empty() {
        "（这一场还没归幕）".to_string()
    } else {
        input.act_title.trim().to_string()
    };
    let prev = if input.prev_tail.trim().is_empty() {
        "这是第一场，前面没有内容 —— 开场要把人和地方立起来，别从半空中开始。".to_string()
    } else {
        format!(
            "前一场的结尾是：\n{}\n\n**这一场要接着它往下走**，不要重述上一场已经交代过的事。",
            input.prev_tail.trim()
        )
    };
    let idea = if input.idea.trim().is_empty() {
        String::new()
    } else {
        format!("\n用户另外交代：{}", input.idea.trim())
    };
    format!(
        "项目《{}》，{act}，{}。\n这一场承担的功能：{}\n\n{}\n\n{}\n{}\n\n\
         写这一场的正文：\n\
         - 先定地点和时间（place、time），从下面那份场景清单里挑，没有合适的再自己定\n\
         - lines 一行一句。**动作行直接写**，台词行写成 `名字：\"……\"`\n\
         - 台词只留最必要的那几句，能用动作交代的别用嘴说\n\
         - 不要写镜头、不要写景别、不要写「镜头缓缓推进」这类拍摄指令 —— 那是分镜那一步的事\n\
         - 不要在正文里写场次号或幕标题，那些由程序补{}",
        input.project,
        input.beat_key,
        input.beat_t,
        list("已定稿的角色", &input.leads, "还没有定稿的角色，用大纲里的称呼"),
        list("已定稿的场景", &input.places, "还没有定稿的场景，地点自己定"),
        prev,
        idea,
    )
}

/// 收拾产物：去空白、剥列表符号、截断、去掉模型自己加的结构标记。
///
/// 一行都不剩就报错 —— 那说明这一轮没产出东西，给一个空正文块比失败更糟。
pub fn tidy(d: &mut ScriptDraft) -> Result<()> {
    d.place = d.place.trim().chars().take(40).collect();
    d.time = d.time.trim().chars().take(40).collect();
    let mut seen = std::collections::HashSet::new();
    d.lines = std::mem::take(&mut d.lines)
        .into_iter()
        .map(|l| {
            // 模型爱加的列表符号与 Markdown 标记 —— 正文里不该有
            l.trim()
                .trim_start_matches(['-', '*', '•', '#', '>'])
                .trim()
                .to_string()
        })
        .filter(|l| !l.is_empty())
        // 同一行重复出现是模型卡住的典型症状，留着看起来像刻意的重复
        .filter(|l| seen.insert(l.clone()))
        .map(|l| {
            if l.chars().count() > MAX_CHARS {
                l.chars().take(MAX_CHARS).collect::<String>() + "…"
            } else {
                l
            }
        })
        .take(MAX_LINES)
        .collect();
    if d.lines.is_empty() {
        return Err(Error::Decode("模型没写出这一场的正文".into()));
    }
    if d.place.is_empty() {
        d.place = "待定场景".into();
    }
    if d.time.is_empty() {
        d.time = "待定时间".into();
    }
    Ok(())
}

/// 正文块的 Markdown。**场次键与幕标题在这儿拼，不让模型写** ——
/// 与 `outline::number` 一个道理：结构标记由程序保证。
pub fn body_of(d: &ScriptDraft, act_title: &str, beat_key: &str) -> String {
    let mut out = String::new();
    if !act_title.trim().is_empty() {
        out.push_str(&format!("# {}\n\n", act_title.trim()));
    }
    out.push_str(&format!("**{beat_key}**\n{} · {}\n\n", d.place, d.time));
    out.push_str(&d.lines.join("\n"));
    out.push('\n');
    out
}

/// 跑一次。
pub async fn draft(
    spec: &AgentSpec,
    api_key: &str,
    preamble: &str,
    input: &ScriptInput,
    out: &crate::structured::Out<'_>,
) -> Result<ScriptDraft> {
    let mut d: ScriptDraft =
        crate::structured::extract(spec, api_key, preamble, &prompt_of(input), out).await?;
    tidy(&mut d)?;
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ScriptInput {
        ScriptInput {
            project: "雨夜来客".into(),
            beat_key: "场景3".into(),
            beat_t: "主角第一次发现钱少了".into(),
            act_title: "失衡".into(),
            leads: vec!["李明：三十岁，修表匠，话少".into()],
            places: vec!["旧公寓客厅".into()],
            ..Default::default()
        }
    }

    fn draft(lines: &[&str]) -> ScriptDraft {
        ScriptDraft {
            reply: "x".into(),
            place: "旧公寓客厅".into(),
            time: "深夜".into(),
            lines: lines.iter().map(|s| (*s).to_string()).collect(),
        }
    }

    /// **前一场的结尾必须进提示词** —— 这是这条链路相对本地模板的全部意义
    #[test]
    fn 前一场的结尾进了提示词_而且要求接着往下走() {
        let mut i = input();
        i.prev_tail = "他把最后一张钞票压在表壳下。".into();
        let p = prompt_of(&i);
        assert!(p.contains("他把最后一张钞票压在表壳下。"), "{p}");
        assert!(p.contains("接着它往下走"), "{p}");
        assert!(p.contains("不要重述"), "{p}");
    }

    #[test]
    fn 没有前一场时说是开场_不留一句空指令() {
        let p = prompt_of(&input());
        assert!(p.contains("第一场"), "{p}");
        assert!(!p.contains("前一场的结尾是"), "{p}");
    }

    #[test]
    fn 定稿的角色与场景真的进了提示词() {
        let p = prompt_of(&input());
        assert!(p.contains("李明：三十岁，修表匠，话少"), "{p}");
        assert!(p.contains("旧公寓客厅"), "{p}");
    }

    #[test]
    fn 没有定稿资产时给兜底说法_不把空清单塞进去() {
        let mut i = input();
        i.leads.clear();
        i.places.clear();
        let p = prompt_of(&i);
        assert!(p.contains("还没有定稿的角色"), "{p}");
        assert!(p.contains("还没有定稿的场景"), "{p}");
    }

    /// 拍摄指令要明确禁掉：写进正文的话，分镜那一步会把它当成画面内容
    #[test]
    fn 明确不许写镜头指令_那是分镜那一步的事() {
        let p = prompt_of(&input());
        assert!(p.contains("不要写镜头"), "{p}");
        assert!(p.contains("分镜"), "{p}");
    }

    #[test]
    fn 用户那句话在就跟着走_不在就不留空指令() {
        let p = prompt_of(&input());
        assert!(!p.contains("用户另外交代"), "{p}");
        let mut i = input();
        i.idea = "把台词再少一点".into();
        assert!(prompt_of(&i).contains("把台词再少一点"));
    }

    #[test]
    fn 收拾产物_剥列表符号去空去重() {
        let mut d = draft(&["- 他推开门。", "  ", "他推开门。", "* 桌上那杯水还温着。", "> 引用符号也剥"]);
        tidy(&mut d).unwrap();
        assert_eq!(d.lines, ["他推开门。", "桌上那杯水还温着。", "引用符号也剥"]);
    }

    #[test]
    fn 过长的一行被截断_而不是把一段话塞进一行() {
        let long = "字".repeat(200);
        let mut d = draft(&[&long]);
        tidy(&mut d).unwrap();
        assert_eq!(d.lines[0].chars().count(), MAX_CHARS + 1, "截断后加一个省略号");
        assert!(d.lines[0].ends_with('…'));
    }

    #[test]
    fn 行数封顶_超了是灌水不是更详细() {
        let many: Vec<String> = (0..80).map(|i| format!("第 {i} 行")).collect();
        let mut d = ScriptDraft { lines: many, ..draft(&[]) };
        tidy(&mut d).unwrap();
        assert_eq!(d.lines.len(), MAX_LINES);
    }

    #[test]
    fn 一行都不剩时报错_不给一个空正文块() {
        let mut d = draft(&["  ", "-", "#"]);
        assert!(tidy(&mut d).is_err());
    }

    #[test]
    fn 地点时间没写时给兜底_界面上不留一个空的圆点() {
        let mut d = ScriptDraft { place: "  ".into(), time: String::new(), ..draft(&["他推开门。"]) };
        tidy(&mut d).unwrap();
        assert_eq!(d.place, "待定场景");
        assert_eq!(d.time, "待定时间");
    }

    /// **场次键由程序拼，不信模型。** 让模型写 `**场景3**` 它会写错、会撞号，
    /// 而那种错在界面上看起来像正常内容
    #[test]
    fn 正文的结构标记由程序拼() {
        let d = draft(&["他推开门。", "李明：\"你来了。\""]);
        let body = body_of(&d, "失衡", "场景3");
        assert!(body.starts_with("# 失衡\n\n**场景3**\n旧公寓客厅 · 深夜\n\n"), "{body}");
        assert!(body.contains("他推开门。\n李明：\"你来了。\""), "{body}");
    }

    #[test]
    fn 没归幕时不写一个空的一级标题() {
        let body = body_of(&draft(&["他推开门。"]), "  ", "场景1");
        assert!(!body.starts_with('#'), "{body}");
        assert!(body.starts_with("**场景1**"), "{body}");
    }

    #[test]
    fn 产物能序列化成前端认识的形状() {
        let v = serde_json::to_value(draft(&["他推开门。"])).unwrap();
        assert_eq!(v["place"], "旧公寓客厅");
        assert_eq!(v["lines"][0], "他推开门。");
    }
}
