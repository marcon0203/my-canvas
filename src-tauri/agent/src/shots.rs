//! 拆镜头：把一场拆成几个镜头。
//!
//! # 为什么这一步值得花模型的钱
//!
//! 本地那版是「每场固定三镜：全景交代环境、中景看清动作、近景靠近情绪」。
//! 对任何一场都成立，也对任何一场都不贴 —— 一场只有一个人坐着不动，
//! 和一场两个人抢一样东西，该拆成几镜、每镜给谁，本来就不一样。
//!
//! # 场次键与镜号由程序把关
//!
//! 模型要说每一镜属于哪一场，所以它**必须**碰场次键。但它编出来的场次键
//! 不能信：`reconcile` 会把不在清单里的整条丢掉并如实报出丢了几条 ——
//! 与 `shotprompt::reconcile` 一个道理（镜号写错是静默的错，会把提示词写到
//! 别的镜头上）。镜号本身由前端在采纳时分配。

use crate::agent::AgentSpec;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use studio_error::{Error, Result};

/// 一场最多拆几镜。再多不是更细，是把一个动作切成了碎片
pub const MAX_PER_BEAT: usize = 6;
/// 一轮最多多少镜
pub const MAX_SHOTS: usize = 40;
pub const MAX_DESC: usize = 60;

/// 景别。与前端 `SIZE_ORDER` 同一份 —— 模型只能填这里面的，别的丢掉
pub const SIZES: [&str; 7] =
    ["大远景", "远景", "全景", "中景", "中近景", "近景", "特写"];

/// 单镜时长的范围（秒）。出视频的模型普遍只做几秒的片段
pub const MIN_DUR: u32 = 2;
pub const MAX_DUR: u32 = 8;

/// 一个候选镜头
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShotCand {
    /// 属于哪一场，必须是给定清单里的场次键
    pub scene_key: String,
    /// 景别，只能是给定的那七个之一
    pub size: String,
    /// 这一镜画面上发生什么，一句话
    pub desc: String,
    /// 时长（秒）
    pub dur: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShotsDraft {
    /// 给人看的一段话：为什么这么拆
    pub reply: String,
    pub shots: Vec<ShotCand>,
}

/// 要拆的一场
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BeatBrief {
    pub k: String,
    /// 这一场承担什么功能
    pub t: String,
    /// 这一场的正文。有正文才拆得准 —— 没有就只能照功能猜
    #[serde(default)]
    pub body: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotsInput {
    pub project: String,
    /// 要拆的那几场
    #[serde(default)]
    pub beats: Vec<BeatBrief>,
    /// 已定稿的资产（「名字：描述」），拆镜时要知道画面里能有谁
    #[serde(default)]
    pub leads: Vec<String>,
    #[serde(default)]
    pub idea: String,
}

pub fn prompt_of(input: &ShotsInput) -> String {
    let beats = if input.beats.is_empty() {
        "（没有要拆的场次）".to_string()
    } else {
        input
            .beats
            .iter()
            .map(|b| {
                if b.body.trim().is_empty() {
                    format!("- {}（{}）：还没有正文，照功能拆", b.k, b.t)
                } else {
                    format!("- {}（{}）：\n{}", b.k, b.t, b.body.trim())
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let leads = if input.leads.is_empty() {
        "还没有定稿的资产。".to_string()
    } else {
        format!("画面里可以用的资产：{}", input.leads.join("；"))
    };
    let idea = if input.idea.trim().is_empty() {
        String::new()
    } else {
        format!("\n用户另外交代：{}", input.idea.trim())
    };
    format!(
        "项目《{}》，把下面这几场各拆成镜头。\n\n{beats}\n\n{leads}\n\n\
         要求：\n\
         - sceneKey **必须**是上面列出的那几个之一，一个字都不能改\n\
         - size 只能是：{}\n\
         - **每场拆几镜由这场本身决定**，不要一律三镜。一个人坐着不动的场次两镜够了；\n\
           两个人抢一样东西可能要五镜。一场最多 {MAX_PER_BEAT} 镜\n\
         - desc 写**画面上看得见什么**，一句话。不写情绪、不写台词内容\n\
           反例：「他很愤怒」；正例：「他把杯子摔在地上，水溅到裤脚」\n\
         - dur 是这一镜的秒数，{MIN_DUR}–{MAX_DUR} 秒。出视频的模型只做短片段\n\
         - 相邻两镜的景别不要一样 —— 同景别接同景别在成片里看着像没剪过{idea}",
        input.project,
        SIZES.join(" / "),
    )
}

/// 核对产物。返回**丢掉了几条**，让界面能如实说「20 镜里收了 17 镜」。
///
/// 三种丢：场次键不在清单里（模型编的）、景别不认识、描述是空的。
/// **不猜不补** —— 猜错的后果是一镜挂在别的场次下面，那种错很难看出来。
pub fn reconcile(d: &mut ShotsDraft, input: &ShotsInput) -> Result<usize> {
    let known: std::collections::HashSet<&str> =
        input.beats.iter().map(|b| b.k.as_str()).collect();
    let before = d.shots.len();
    let mut per_beat: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    d.shots = std::mem::take(&mut d.shots)
        .into_iter()
        .filter_map(|mut s| {
            s.scene_key = s.scene_key.trim().to_string();
            s.size = s.size.trim().to_string();
            s.desc = s
                .desc
                .trim()
                .trim_start_matches(['-', '*', '•'])
                .trim()
                .chars()
                .take(MAX_DESC)
                .collect();
            if !known.contains(s.scene_key.as_str())
                || !SIZES.contains(&s.size.as_str())
                || s.desc.is_empty()
            {
                return None;
            }
            // 每场封顶：超出的丢掉，而不是让一场拆出二十镜
            let n = per_beat.entry(s.scene_key.clone()).or_insert(0);
            if *n >= MAX_PER_BEAT {
                return None;
            }
            *n += 1;
            s.dur = s.dur.clamp(MIN_DUR, MAX_DUR);
            Some(s)
        })
        .take(MAX_SHOTS)
        .collect();

    if d.shots.is_empty() {
        return Err(Error::Decode("模型没拆出可用的镜头".into()));
    }
    Ok(before.saturating_sub(d.shots.len()))
}

pub async fn draft(
    spec: &AgentSpec,
    api_key: &str,
    preamble: &str,
    input: &ShotsInput,
    out: &crate::structured::Out<'_>,
) -> Result<(ShotsDraft, usize)> {
    let mut d: ShotsDraft =
        crate::structured::extract(spec, api_key, preamble, &prompt_of(input), out).await?;
    let dropped = reconcile(&mut d, input)?;
    Ok((d, dropped))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ShotsInput {
        ShotsInput {
            project: "雨夜来客".into(),
            beats: vec![
                BeatBrief { k: "场景1".into(), t: "开场".into(), body: "他推开门。".into() },
                BeatBrief { k: "场景2".into(), t: "发现钱少了".into(), body: String::new() },
            ],
            leads: vec!["李明：三十岁，瘦".into()],
            ..Default::default()
        }
    }

    fn shot(k: &str, size: &str, desc: &str, dur: u32) -> ShotCand {
        ShotCand { scene_key: k.into(), size: size.into(), desc: desc.into(), dur }
    }

    fn draft(ss: Vec<ShotCand>) -> ShotsDraft {
        ShotsDraft { reply: "x".into(), shots: ss }
    }

    /// **正文要送进去** —— 没正文只能照功能猜，那和本地那版固定三镜差别不大
    #[test]
    fn 有正文的场次送正文_没正文的说清照功能拆() {
        let p = prompt_of(&input());
        assert!(p.contains("他推开门。"), "{p}");
        assert!(p.contains("还没有正文，照功能拆"), "{p}");
    }

    /// 这条是这条链路相对本地模板的**全部意义**：拆几镜由这场本身决定
    #[test]
    fn 明确要求不要一律三镜() {
        let p = prompt_of(&input());
        assert!(p.contains("不要一律三镜"), "{p}");
        assert!(p.contains("由这场本身决定"), "{p}");
    }

    #[test]
    fn 景别清单和场次键约束都在提示词里() {
        let p = prompt_of(&input());
        for s in SIZES {
            assert!(p.contains(s), "缺景别 {s}：{p}");
        }
        assert!(p.contains("场景1") && p.contains("场景2"), "{p}");
        assert!(p.contains("一个字都不能改"), "{p}");
    }

    #[test]
    fn 描述要求写看得见的_并给了正反例() {
        let p = prompt_of(&input());
        assert!(p.contains("看得见什么"), "{p}");
        assert!(p.contains("反例"), "{p}");
        assert!(p.contains("不写情绪"), "{p}");
    }

    #[test]
    fn 定稿资产进了提示词_没有时给兜底说法() {
        assert!(prompt_of(&input()).contains("李明：三十岁，瘦"));
        let mut i = input();
        i.leads.clear();
        assert!(prompt_of(&i).contains("还没有定稿的资产"));
    }

    /// **模型编的场次键整条丢掉，不猜不补。**
    /// 猜错的后果是一镜挂在别的场次下面 —— 那种错很难看出来
    #[test]
    fn 编出来的场次键整条丢掉_并报出丢了几条() {
        let i = input();
        let mut d = draft(vec![
            shot("场景1", "全景", "他推开门", 4),
            shot("场景9", "中景", "模型编的场次", 3),
            shot("第三场", "近景", "换了个写法也不认", 3),
        ]);
        let dropped = reconcile(&mut d, &i).unwrap();
        assert_eq!(d.shots.len(), 1);
        assert_eq!(dropped, 2, "要如实报出丢了几条");
    }

    #[test]
    fn 不认识的景别整条丢掉() {
        let i = input();
        let mut d = draft(vec![
            shot("场景1", "全景", "甲", 4),
            shot("场景1", "大特写", "这个景别清单里没有", 3),
            shot("场景1", "", "空景别", 3),
        ]);
        reconcile(&mut d, &i).unwrap();
        assert_eq!(d.shots.len(), 1);
    }

    #[test]
    fn 描述空的丢掉_剥列表符号() {
        let i = input();
        let mut d = draft(vec![
            shot("场景1", "全景", "  ", 4),
            shot("场景1", "中景", "- 他推开门", 3),
        ]);
        reconcile(&mut d, &i).unwrap();
        assert_eq!(d.shots.len(), 1);
        assert_eq!(d.shots[0].desc, "他推开门");
    }

    #[test]
    fn 时长夹到出视频模型做得到的范围() {
        let i = input();
        let mut d = draft(vec![
            shot("场景1", "全景", "甲", 0),
            shot("场景1", "中景", "乙", 99),
            shot("场景1", "近景", "丙", 4),
        ]);
        reconcile(&mut d, &i).unwrap();
        assert_eq!(d.shots[0].dur, MIN_DUR);
        assert_eq!(d.shots[1].dur, MAX_DUR);
        assert_eq!(d.shots[2].dur, 4);
    }

    /// 一场拆出二十镜是模型卡住了，不是拆得细
    #[test]
    fn 每场封顶_超出的丢掉() {
        let i = input();
        let many: Vec<ShotCand> = (0..20)
            .map(|n| shot("场景1", "中景", &format!("第 {n} 镜"), 3))
            .collect();
        let mut d = draft(many);
        reconcile(&mut d, &i).unwrap();
        assert_eq!(d.shots.len(), MAX_PER_BEAT);
    }

    #[test]
    fn 每场各自封顶_不是加起来封顶() {
        let i = input();
        let mut ss: Vec<ShotCand> = (0..8).map(|n| shot("场景1", "中景", &format!("甲{n}"), 3)).collect();
        ss.extend((0..8).map(|n| shot("场景2", "全景", &format!("乙{n}"), 3)));
        let mut d = draft(ss);
        reconcile(&mut d, &i).unwrap();
        assert_eq!(d.shots.len(), MAX_PER_BEAT * 2);
    }

    #[test]
    fn 一镜都不剩时报错_不给一个空产物() {
        let i = input();
        let mut d = draft(vec![shot("场景9", "全景", "全是编的", 3)]);
        assert!(reconcile(&mut d, &i).is_err());
    }

    #[test]
    fn 产物能序列化成前端认识的形状() {
        let v = serde_json::to_value(draft(vec![shot("场景1", "全景", "他推开门", 4)])).unwrap();
        assert_eq!(v["shots"][0]["sceneKey"], "场景1");
        assert_eq!(v["shots"][0]["dur"], 4);
    }
}
