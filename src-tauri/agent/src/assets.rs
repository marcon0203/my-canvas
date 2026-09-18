//! 提取资产：从剧本正文里找出反复出现的人和地方，立成资产。
//!
//! # 为什么这一步值得花模型的钱
//!
//! 本地那版是从正文里按规则挑候选（出现过的专名），够用但挑不出「这两个称呼
//! 其实是同一个人」，也写不出资产描述 —— 而描述正是分镜引用它时真正会用到的
//! 东西（提示词里进的是描述，不是名字）。
//!
//! # aid 由程序编号
//!
//! 模型只填分组、名字、描述。**编号不让它碰** —— 它会重复、会跳号、会和库里
//! 已有的撞，而撞号的后果是分镜引用到另一个资产上，那种错很难看出来。
//! 编号在 `tools::patch` 里做（它看得到全项目已用的号）。

use crate::agent::AgentSpec;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use studio_error::{Error, Result};

/// 一轮最多立几个。再多不是更全，是模型把路人也算进来了
pub const MAX_ASSETS: usize = 12;
pub const MAX_NAME: usize = 24;
pub const MAX_DESC: usize = 120;

/// 三个分组。模型只能填这三个之一，别的一律丢掉
pub const GROUPS: [&str; 3] = ["角色", "场景", "道具"];

/// 一个候选资产
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Cand {
    /// 分组：角色 / 场景 / 道具，只能是这三个
    pub group: String,
    pub name: String,
    /// 给分镜引用时会进提示词的那段描述。**写外形与可见特征**，不写心理
    pub desc: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AssetsDraft {
    /// 给人看的一段话：为什么是这几个
    pub reply: String,
    pub assets: Vec<Cand>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetsInput {
    pub project: String,
    /// 剧本正文。**要真送正文** —— 只送场次标题的话模型只能瞎猜人物长什么样
    #[serde(default)]
    pub script: String,
    /// 库里已经有的（「分组 · 名字」），避免重复立
    #[serde(default)]
    pub existing: Vec<String>,
    #[serde(default)]
    pub idea: String,
}

pub fn prompt_of(input: &AssetsInput) -> String {
    let have = if input.existing.is_empty() {
        "资产库现在是空的。".to_string()
    } else {
        format!(
            "**资产库里已经有这些，不要重复立**：{}",
            input.existing.join("；")
        )
    };
    let idea = if input.idea.trim().is_empty() {
        String::new()
    } else {
        format!("\n用户另外交代：{}", input.idea.trim())
    };
    format!(
        "项目《{}》的剧本正文：\n\n{}\n\n{have}\n\n\
         从正文里找出**反复出现、后面分镜要反复画**的人、地方、关键道具，立成资产。\n\
         - group 只能是「角色」「场景」「道具」之一\n\
         - 只出现一次的路人和一次性道具**不要立** —— 立了只会让资产库变噪音\n\
         - 同一个人的不同称呼（「他」「老李」「李明」）算一个，用正文里最完整的那个名字\n\
         - desc 写**外形与可见特征**（年龄、体型、衣着、材质、光线），出图时要靠它；\n\
           不要写心理、动机、剧情 —— 那些画不出来\n\
           反例：「内心愧疚的修表匠」；正例：「三十岁男性，瘦，穿洗旧的灰毛衣，左手缺一截无名指」\n\
         - 不要编号、不要写 aid —— 编号由程序统一分配{idea}",
        input.project,
        if input.script.trim().is_empty() {
            "（正文还是空的）".to_string()
        } else {
            input.script.trim().to_string()
        },
    )
}

/// 收拾产物：分组必须合法、去空去重、截断。
///
/// **分组不合法的整条丢掉**，不要猜一个默认分组 —— 猜错的后果是一个角色被立
/// 成道具，而它在界面上出现在错的那一栏里，人得自己发现。
pub fn tidy(d: &mut AssetsDraft) -> Result<()> {
    let mut seen = std::collections::HashSet::new();
    d.assets = std::mem::take(&mut d.assets)
        .into_iter()
        .filter_map(|mut c| {
            c.group = c.group.trim().to_string();
            if !GROUPS.contains(&c.group.as_str()) {
                return None;
            }
            c.name = c
                .name
                .trim()
                .trim_start_matches(['-', '*', '•'])
                .trim()
                .chars()
                .take(MAX_NAME)
                .collect();
            c.desc = c.desc.trim().chars().take(MAX_DESC).collect();
            if c.name.is_empty() || c.desc.is_empty() {
                return None;
            }
            // 同一分组里同名的算一个
            seen.insert(format!("{}·{}", c.group, c.name)).then_some(c)
        })
        .take(MAX_ASSETS)
        .collect();
    if d.assets.is_empty() {
        return Err(Error::Decode("模型没找出可以立成资产的人或地方".into()));
    }
    Ok(())
}

pub async fn draft(
    spec: &AgentSpec,
    api_key: &str,
    preamble: &str,
    input: &AssetsInput,
    out: &crate::structured::Out<'_>,
) -> Result<AssetsDraft> {
    let mut d: AssetsDraft =
        crate::structured::extract(spec, api_key, preamble, &prompt_of(input), out).await?;
    tidy(&mut d)?;
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(g: &str, n: &str, d: &str) -> Cand {
        Cand { group: g.into(), name: n.into(), desc: d.into() }
    }

    fn draft(cs: Vec<Cand>) -> AssetsDraft {
        AssetsDraft { reply: "x".into(), assets: cs }
    }

    /// **正文要真送进去** —— 只送场次标题的话模型只能瞎猜人物长什么样
    #[test]
    fn 剧本正文进了提示词() {
        let i = AssetsInput {
            project: "雨夜来客".into(),
            script: "李明把最后一张钞票压在表壳下。".into(),
            ..Default::default()
        };
        let p = prompt_of(&i);
        assert!(p.contains("李明把最后一张钞票压在表壳下。"), "{p}");
    }

    #[test]
    fn 已有的资产要告诉模型_不然会重复立() {
        let i = AssetsInput {
            existing: vec!["角色 · 李明".into(), "场景 · 旧公寓客厅".into()],
            ..Default::default()
        };
        let p = prompt_of(&i);
        assert!(p.contains("角色 · 李明"), "{p}");
        assert!(p.contains("不要重复立"), "{p}");
    }

    #[test]
    fn 库是空的时候也说清_不留一句空清单() {
        let p = prompt_of(&AssetsInput::default());
        assert!(p.contains("资产库现在是空的"), "{p}");
    }

    /// 描述要能出图。**写心理是这一步最常见的错** ——
    /// 「内心愧疚的修表匠」进了提示词，出图模型画不出「愧疚」
    #[test]
    fn 要求描述写外形_并给了正反例() {
        let p = prompt_of(&AssetsInput::default());
        assert!(p.contains("外形与可见特征"), "{p}");
        assert!(p.contains("不要写心理"), "{p}");
        assert!(p.contains("反例"), "没给反例的话这条约束模型经常不照做：{p}");
    }

    #[test]
    fn 只出现一次的路人明确不要立() {
        let p = prompt_of(&AssetsInput::default());
        assert!(p.contains("路人"), "{p}");
        assert!(p.contains("噪音"), "{p}");
    }

    /// **分组不合法的整条丢掉，不猜一个默认分组。**
    /// 猜错的后果是一个角色出现在道具那一栏里，人得自己发现
    #[test]
    fn 分组不合法的整条丢掉() {
        let mut d = draft(vec![
            cand("角色", "李明", "三十岁男性，瘦"),
            cand("人物", "王姐", "四十岁女性"),
            cand("", "无名", "什么"),
            cand("背景", "街", "雨夜"),
        ]);
        tidy(&mut d).unwrap();
        assert_eq!(d.assets.len(), 1);
        assert_eq!(d.assets[0].name, "李明");
    }

    #[test]
    fn 同分组同名的算一个_跨分组不算() {
        let mut d = draft(vec![
            cand("角色", "李明", "甲"),
            cand("角色", "李明", "乙"),
            cand("道具", "李明", "一块牌子"),
        ]);
        tidy(&mut d).unwrap();
        assert_eq!(d.assets.len(), 2);
    }

    #[test]
    fn 名字或描述空的丢掉_不立一个空壳资产() {
        let mut d = draft(vec![
            cand("角色", "  ", "有描述没名字"),
            cand("场景", "有名字没描述", "   "),
            cand("角色", "李明", "三十岁"),
        ]);
        tidy(&mut d).unwrap();
        assert_eq!(d.assets.len(), 1);
    }

    #[test]
    fn 名字剥列表符号_描述截断() {
        let mut d = draft(vec![cand("角色", "- 李明", &"字".repeat(200))]);
        tidy(&mut d).unwrap();
        assert_eq!(d.assets[0].name, "李明");
        assert_eq!(d.assets[0].desc.chars().count(), MAX_DESC);
    }

    #[test]
    fn 一轮封顶_超了是把路人也算进来了() {
        let many: Vec<Cand> = (0..40).map(|i| cand("角色", &format!("人{i}"), "描述")).collect();
        let mut d = draft(many);
        tidy(&mut d).unwrap();
        assert_eq!(d.assets.len(), MAX_ASSETS);
    }

    #[test]
    fn 一个都不剩时报错_不给一个空产物() {
        let mut d = draft(vec![cand("人物", "王姐", "四十岁")]);
        assert!(tidy(&mut d).is_err());
    }

    #[test]
    fn 产物能序列化成前端认识的形状() {
        let v = serde_json::to_value(draft(vec![cand("角色", "李明", "三十岁")])).unwrap();
        assert_eq!(v["assets"][0]["group"], "角色");
        assert_eq!(v["assets"][0]["name"], "李明");
    }
}
