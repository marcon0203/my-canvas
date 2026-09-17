//! 时间线与字幕：成片那两步要写的东西。
//!
//! # 为什么这两个工具一直做不了
//!
//! 不是代码没写，是**项目里没有这两份数据** —— 剪辑页上那三条轨（画面/配音/
//! 字幕）原来是写死的占位。工具没有可写的目标，做出来也只能假装成功。
//! 所以先有这份数据模型，再有工具。
//!
//! # 这一层只排顺序与时间，不碰媒体
//!
//! 拼片段、转码、烧字幕是另一回事（要 ffmpeg，现在没有）。这里产出的是
//! 一份「谁在第几秒、放多久、这段字幕配哪一句」的清单 —— 界面按它画轨道，
//! 将来的渲染管线按它拼片子。清单是纯数据，所以整个这层都能单测。

use crate::md::DocBlock;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 一个片段在时间线上的位置。
///
/// `at` 是起点毫秒，由累加算出来而不是让调用方填 —— 让模型自己算起点，
/// 一处算错后面全错位，而且看起来仍然像一条正常的时间线。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub shot_id: String,
    /// 起点，毫秒
    pub at: u32,
    /// 时长，毫秒
    pub dur: u32,
}

/// 一条字幕。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub at: u32,
    pub dur: u32,
    pub text: String,
}

/// 时间线。`beatMs` 有值表示按这个卡点对齐过
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub clips: Vec<Clip>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beat_ms: Option<u32>,
}

/// 字幕轨
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Subtitles {
    pub lang: String,
    pub cues: Vec<Cue>,
}

/// 一条字幕最多几个字。
///
/// 超过一行看不完 —— 短视频的字幕是一眼扫过去的东西，不是读的。
/// 超了就按标点切成几条，而不是塞一长条让界面自己截断。
pub const MAX_CUE_CHARS: usize = 18;

/// 判定可用的镜头才进时间线。
///
/// **不是「有视频的」而是「判定可用的」**：重摇过好几版都不满意的镜头
/// 也有视频文件，把它排进片子里等于把废片交出去。
fn usable(shot: &Value) -> bool {
    shot.get("vid").and_then(Value::as_str) == Some("ok")
        && shot.get("verdict").and_then(Value::as_str) != Some("redo")
}

/// 时长：镜头上的 `dur` 是秒。缺了按 2 秒 —— 与 makeShot 的默认值一致
fn dur_ms(shot: &Value) -> u32 {
    let sec = shot.get("dur").and_then(Value::as_f64).unwrap_or(2.0);
    ((sec.max(0.1)) * 1000.0).round() as u32
}

/// 场次序号 + 镜号里的序号 → 排序键。
///
/// 按字符串排会把 `s1-10` 排在 `s1-2` 前面 —— 十镜以上的场次顺序就乱了，
/// 而乱掉的成片顺序是那种「看着怪但说不出哪儿怪」的问题。
fn sort_key(shot: &Value) -> (u32, u32) {
    let id = shot.get("id").and_then(Value::as_str).unwrap_or("");
    let nums: Vec<u32> = id
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    (nums.first().copied().unwrap_or(0), nums.get(1).copied().unwrap_or(0))
}

/// 排时间线。`beat_ms` 有值时把每段时长对齐到卡点的整数倍。
///
/// 对齐用四舍五入而不是向上取整：向上取整会让每一段都变长，
/// 二十段之后片子比预期长一截。最少留一个卡点 —— 对齐成 0 长度等于丢掉这段。
pub fn plan(shots: &[Value], beat_ms: Option<u32>) -> Timeline {
    let mut list: Vec<&Value> = shots.iter().filter(|s| usable(s)).collect();
    list.sort_by_key(|s| sort_key(s));

    let mut at = 0u32;
    let mut clips = Vec::with_capacity(list.len());
    for s in list {
        let mut dur = dur_ms(s);
        if let Some(b) = beat_ms.filter(|b| *b > 0) {
            let n = ((dur as f64) / (b as f64)).round().max(1.0) as u32;
            dur = n * b;
        }
        clips.push(Clip {
            shot_id: s.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
            at,
            dur,
        });
        at += dur;
    }
    Timeline { clips, beat_ms: beat_ms.filter(|b| *b > 0) }
}

/// 时间线总长（毫秒）
pub fn total_ms(t: &Timeline) -> u32 {
    t.clips.last().map(|c| c.at + c.dur).unwrap_or(0)
}

/// 正文里可以念出来的句子。
///
/// 剧本里混着场次标题（`**场景1**`）、Markdown 标题、动作描写和台词。
/// 字幕只要**能念的那部分**：`角色：台词` 的台词，和旁白行。
/// 场次标题与 `#` 开头的标题整行丢掉 —— 那是给人看的结构，不是片子里的话。
pub fn speakable(blocks: &[DocBlock]) -> Vec<String> {
    let mut out = Vec::new();
    for b in blocks {
        // 角色小传、大纲这类不是台词
        if b.kind != "text" {
            continue;
        }
        for raw in b.body.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with("---") {
                continue;
            }
            // **场景1** 这类场次标记
            if line.starts_with("**") && line.ends_with("**") {
                continue;
            }
            // `艾米：台词` —— 取冒号后面那半
            let said = match line.split_once(['：', ':']) {
                Some((who, rest)) if !who.is_empty() && who.chars().count() <= 8 => rest.trim(),
                _ => line,
            };
            let said = said.trim_matches(|c| c == '"' || c == '“' || c == '”');
            if said.chars().count() < 2 {
                continue;
            }
            out.push(said.to_string());
        }
    }
    out
}

/// 一句话 → 几条字幕。按标点切，切不开就硬断。
///
/// 硬断放在最后：一句没有标点的长句，宁可断在不好的地方也不能整句丢掉，
/// 也不能让它变成一条界面上显示不全的字幕。
pub fn split_cue(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in text.chars() {
        cur.push(ch);
        let punct = matches!(ch, '。' | '！' | '？' | '，' | '；' | '、' | '.' | '!' | '?' | ',' | ';');
        if punct && cur.chars().count() >= MAX_CUE_CHARS / 2 {
            out.push(cur.trim().trim_end_matches(['，', '、', ';', ',']).to_string());
            cur.clear();
        } else if cur.chars().count() >= MAX_CUE_CHARS {
            out.push(cur.trim().to_string());
            cur.clear();
        }
    }
    let tail = cur.trim().to_string();
    if !tail.is_empty() {
        // 尾巴太短就并进上一条，不留一个一两个字的字幕闪一下
        if tail.chars().count() <= 3 {
            if let Some(last) = out.last_mut() {
                last.push_str(&tail);
            } else {
                out.push(tail);
            }
        } else {
            out.push(tail);
        }
    }
    out.retain(|s| !s.is_empty());
    out
}

/// 按时间线给字幕排时间。
///
/// **一段画面里能放几条字幕，取决于这段有多长** —— 平均分这段的时长。
/// 句子比片段多时，多出来的跟着最后一段走完；句子比片段少时，后面的片段没字幕，
/// 这是对的：没有台词的镜头不该硬塞一条字幕。
pub fn cues(t: &Timeline, lines: &[String], lang: &str) -> Subtitles {
    let mut pieces: Vec<String> = Vec::new();
    for l in lines {
        pieces.extend(split_cue(l));
    }
    if t.clips.is_empty() || pieces.is_empty() {
        return Subtitles { lang: lang.to_string(), cues: vec![] };
    }

    // 尽量一段一句；句子多于片段时，末段承担剩下的
    let mut out = Vec::with_capacity(pieces.len());
    let per = (pieces.len() as f64 / t.clips.len() as f64).ceil().max(1.0) as usize;
    let mut i = 0;
    for c in &t.clips {
        if i >= pieces.len() {
            break;
        }
        let take = per.min(pieces.len() - i);
        let slot = (c.dur / take.max(1) as u32).max(200);
        for k in 0..take {
            out.push(Cue {
                at: c.at + slot * k as u32,
                dur: slot,
                text: pieces[i + k].clone(),
            });
        }
        i += take;
    }
    Subtitles { lang: lang.to_string(), cues: out }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shots() -> Vec<Value> {
        vec![
            json!({ "id": "s1-1", "dur": 2, "vid": "ok", "verdict": "ok" }),
            json!({ "id": "s1-10", "dur": 3, "vid": "ok", "verdict": "ok" }),
            json!({ "id": "s1-2", "dur": 1.5, "vid": "ok", "verdict": "ok" }),
            json!({ "id": "s2-1", "dur": 4, "vid": "none" }),               // 还没出视频
            json!({ "id": "s2-2", "dur": 4, "vid": "ok", "verdict": "redo" }), // 判定要重摇
        ]
    }

    #[test]
    fn 只排判定可用的_废片不进成片() {
        let t = plan(&shots(), None);
        let ids: Vec<&str> = t.clips.iter().map(|c| c.shot_id.as_str()).collect();
        assert_eq!(ids, ["s1-1", "s1-2", "s1-10"]);
    }

    #[test]
    fn 镜号按数字排_s1_10_不排在_s1_2_前面() {
        let t = plan(&shots(), None);
        let pos = |id: &str| t.clips.iter().position(|c| c.shot_id == id).unwrap();
        assert!(pos("s1-2") < pos("s1-10"), "十镜以上的场次顺序乱了");
    }

    #[test]
    fn 起点是累加出来的_不让调用方自己填() {
        let t = plan(&shots(), None);
        assert_eq!(t.clips[0].at, 0);
        assert_eq!(t.clips[1].at, 2000);
        assert_eq!(t.clips[2].at, 3500);
        assert_eq!(total_ms(&t), 6500);
    }

    #[test]
    fn 卡点对齐用四舍五入_不向上取整() {
        // 1.5s 对齐到 500ms 卡点 = 3 个卡点；2s = 4 个
        let t = plan(&shots(), Some(500));
        assert_eq!(t.clips.iter().map(|c| c.dur).collect::<Vec<_>>(), [2000, 1500, 3000]);
        assert_eq!(t.beat_ms, Some(500));

        // 向上取整的话每段都会变长，二十段之后片子比预期长一截
        let one = vec![json!({ "id": "s1-1", "dur": 2.1, "vid": "ok", "verdict": "ok" })];
        assert_eq!(plan(&one, Some(1000)).clips[0].dur, 2000, "2.1s 该对齐到 2s 而不是 3s");
    }

    #[test]
    fn 对齐后最少留一个卡点_不能变成_0_长度() {
        let tiny = vec![json!({ "id": "s1-1", "dur": 0.2, "vid": "ok", "verdict": "ok" })];
        assert_eq!(plan(&tiny, Some(1000)).clips[0].dur, 1000, "对齐成 0 等于把这段丢了");
    }

    #[test]
    fn 没有可用片段时时间线是空的_不是一条空片段() {
        let t = plan(&[json!({ "id": "s1-1", "vid": "none" })], None);
        assert!(t.clips.is_empty());
        assert_eq!(total_ms(&t), 0);
    }

    /* ---- 字幕 ---- */

    fn blocks() -> Vec<DocBlock> {
        vec![
            DocBlock {
                id: "d1".into(), kind: "character".into(), label: "角色小传".into(),
                body: "艾米，11 岁。".into(),
            },
            DocBlock {
                id: "d2".into(), kind: "text".into(), label: "正文".into(),
                body: "# 第一幕\n\n**场景1**\n\n艾米：年糕，你今天怎么不吃东西？\n\n窗外下起了雨。\n\n旁白：那一天，她第一次知道永远是有期限的。".into(),
            },
        ]
    }

    #[test]
    fn 只取能念的那部分_结构性的行不进字幕() {
        let lines = speakable(&blocks());
        assert!(lines.iter().any(|l| l.contains("年糕，你今天怎么不吃东西")));
        assert!(lines.iter().any(|l| l.contains("窗外下起了雨")));
        // 角色小传、幕标题、场次标记都不是片子里的话
        assert!(!lines.iter().any(|l| l.contains("11 岁")));
        assert!(!lines.iter().any(|l| l.contains("第一幕")));
        assert!(!lines.iter().any(|l| l.contains("场景1")));
        // `角色：台词` 只留台词那半
        assert!(!lines.iter().any(|l| l.starts_with("艾米")));
    }

    #[test]
    fn 长句按标点切_一条字幕不超过上限() {
        let long = "那一天，她第一次知道，永远是有期限的，而她连一句再见都没来得及说。";
        for c in split_cue(long) {
            assert!(c.chars().count() <= MAX_CUE_CHARS + 3, "太长：{c}");
        }
    }

    #[test]
    fn 没有标点的长句硬断_也不能整句丢掉() {
        let s = "啊".repeat(50);
        let out = split_cue(&s);
        assert!(out.len() >= 2);
        assert_eq!(out.join("").chars().count(), 50, "硬断也不能丢字");
    }

    #[test]
    fn 尾巴太短就并进上一条_不留一个两个字的字幕闪一下() {
        let out = split_cue("她走了，真的。");
        assert!(out.last().unwrap().ends_with("真的。"), "{out:?}");
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn 字幕落在片段的时间范围里() {
        let t = plan(&shots(), None);
        let s = cues(&t, &speakable(&blocks()), "zh");
        assert_eq!(s.lang, "zh");
        assert!(!s.cues.is_empty());
        let end = total_ms(&t);
        for c in &s.cues {
            assert!(c.at + c.dur <= end + 1, "{c:?} 超出片长 {end}");
            assert!(c.dur >= 200, "一条字幕短到看不见：{c:?}");
        }
        // 按时间递增 —— 乱序的字幕轨界面画出来是错的
        for w in s.cues.windows(2) {
            assert!(w[0].at <= w[1].at, "{:?} 在 {:?} 之后", w[0], w[1]);
        }
    }

    #[test]
    fn 没有台词或没有片段时给空字幕_不编一条() {
        let t = plan(&shots(), None);
        assert!(cues(&t, &[], "zh").cues.is_empty());
        assert!(cues(&Timeline::default(), &["一句话".to_string()], "zh").cues.is_empty());
    }

    #[test]
    fn 台词比片段少时后面的片段没字幕_不硬塞() {
        let t = plan(&shots(), None);   // 3 段
        let s = cues(&t, &["只有一句话，说完就完了。".to_string()], "zh");
        assert!(s.cues.len() <= 2, "把一句话摊到三段上了：{:?}", s.cues);
    }
}
