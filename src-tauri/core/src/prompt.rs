//! 提示词合成：画风 + 引用资产 + 本镜描述 → 一条英文提示词。
//!
//! # 为什么这里会有第二份实现
//!
//! 前端 `domain/prompt/compile.ts` 里也有一份 —— 界面上那条彩色三段式提示词
//! 是它算的，用户改一个字就要立刻重算，不可能每次都过一趟 IPC。
//!
//! 所以这是刻意的两份，配一个 parity 测试（`prompt::samples` →
//! `src/domain/prompt/__fixtures__/rust-prompts.json` → 前端那边逐条比对）。
//! 「搬到 core 让两边共用」听起来更干净，但那会让界面上的即时预览变成异步的，
//! 代价比一个对比测试大得多。
//!
//! # 三段式，以及为什么镜头语言不在里面
//!
//! 画风、引用资产的设定、这一镜自己的内容 —— 三段，按这个顺序。
//! 景别机位这些镜头语言**不在分镜提示词里**：生成资产形状照时已经定好了，
//! 出图时随参考图走。重复说一遍只会和参考图打架。

use crate::error::{Error, Result};
use crate::patch::style_frag;
use crate::project::{self, Bundle};
use serde_json::{Value, json};
use std::path::Path;

/// 一段提示词的来源。界面上按来源上色，所以分段而不是直接给一整条
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// style / ref / own
    pub k: String,
    pub v: String,
}

fn seg(k: &str, v: impl Into<String>) -> Segment {
    Segment { k: k.into(), v: v.into() }
}

/// aid → 资产描述。出图时模型要看见「艾米长什么样」，而不是只看见一个编号
fn desc_by_aid(b: &Bundle) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(groups) = b.assets.as_object() {
        for list in groups.values() {
            for a in list.as_array().unwrap_or(&vec![]) {
                let aid = a.get("aid").and_then(Value::as_str).unwrap_or("");
                let d = a.get("desc").and_then(Value::as_str).unwrap_or("");
                if !aid.is_empty() && !d.is_empty() {
                    out.push((aid.to_string(), d.to_string()));
                }
            }
        }
    }
    out
}

/// 合成一镜。`style` 为空或 `全局` 时跟项目画风走。
///
/// 与前端 `compileShot` 同一套规则：查不到描述的引用**跳过**而不是写个占位 ——
/// 「CHAR-003」这种编号混进提示词，出图模型只会把它当一串乱码去画。
pub fn compile_shot(
    shot: &Value,
    global_style_prompt: &str,
    descs: &[(String, String)],
) -> Vec<Segment> {
    let node = shot.get("style").and_then(Value::as_str).unwrap_or("");
    let style = if node.is_empty() || node == "全局" {
        global_style_prompt.to_string()
    } else {
        style_frag(node)
    };

    let mut out = vec![seg("style", style)];
    for aid in shot.get("refs").and_then(Value::as_array).unwrap_or(&vec![]) {
        let Some(aid) = aid.as_str() else { continue };
        if let Some((_, d)) = descs.iter().find(|(k, _)| k == aid) {
            out.push(seg("ref", d.clone()));
        }
    }
    let own = shot.get("own").and_then(Value::as_str).unwrap_or("").trim();
    if !own.is_empty() {
        out.push(seg("own", own));
    }
    out
}

/// 真正拿去发请求的那一条。空段落滤掉 —— 逗号连着逗号会让模型读出一个空槽
pub fn text_of(segs: &[Segment]) -> String {
    segs.iter()
        .map(|s| s.v.trim())
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

/// `prompt.compile` 工具：**只读**。
///
/// 它回答「这一镜真正会发出去的提示词长什么样」，不写任何东西 ——
/// 分镜提示词是从画风/引用/本镜内容算出来的派生值，落盘反而会让它和源头对不上。
/// （注册表里它原来标着「会改项目」，那是错的：改提示词要改的是源头，不是这条结果。）
pub fn compile(root: &Path, id: &str, args: &Value) -> Result<Value> {
    let b = project::load(root, id)?;
    let shots = b.shots.as_array().cloned().unwrap_or_default();
    let descs = desc_by_aid(&b);

    let want: Vec<String> = args
        .get("shotIds")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let picked: Vec<&Value> = if want.is_empty() {
        shots.iter().collect()
    } else {
        // 编错的镜号要说出来，不要静默少算一条
        let have: Vec<&str> = shots.iter().filter_map(|s| s.get("id")?.as_str()).collect();
        if let Some(miss) = want.iter().find(|w| !have.contains(&w.as_str())) {
            return Err(Error::Store(format!("分镜里没有 {miss}")));
        }
        shots
            .iter()
            .filter(|s| {
                s.get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|x| want.iter().any(|w| w == x))
            })
            .collect()
    };
    if picked.is_empty() {
        return Err(Error::Store("这个项目还没有镜头".into()));
    }

    let out: Vec<Value> = picked
        .iter()
        .map(|s| {
            let segs = compile_shot(s, &b.meta.style_prompt, &descs);
            json!({
                "id": s.get("id").and_then(Value::as_str).unwrap_or(""),
                "segments": segs,
                "text": text_of(&segs),
            })
        })
        .collect();
    Ok(json!({ "prompts": out }))
}

/* ---------------- 中译英 ---------------- */

/// 译提示词用的系统提示词。
///
/// 写死在这儿而不是让调用方传：这句话决定了译出来的东西能不能用 ——
/// 把情节和心理也译进去，出图模型会试着画「她很难过」，画出来是一张乱图。
pub const TRANSLATE_PREAMBLE: &str = "\
You turn Chinese shot descriptions into English image/video generation prompts.

Rules:
- Translate only what is VISIBLE in frame: subjects, clothing, actions, setting, light, colour, texture.
- Drop plot, motives, inner feelings and dialogue. \"她想起了童年\" has nothing to draw — omit it.
- Keep it a comma-separated phrase list, not a sentence. No trailing period.
- Do not add style words, camera or lens terms: those come from elsewhere in the prompt.
- Output the prompt only. No quotes, no explanation, no alternatives.";

/// 调文本模型要的东西。**密钥只在这儿传一次**，不进返回值、不进日志。
pub struct ChatCtx<'a> {
    pub model: &'a crate::config::ModelRef,
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub timeout: std::time::Duration,
}

/// `prompt.translate`：中文描述 → 英文提示词。真调模型。
pub async fn translate(ctx: &ChatCtx<'_>, args: &Value) -> Result<Value> {
    let text = args.get("text").and_then(Value::as_str).unwrap_or("").trim();
    if text.is_empty() {
        return Err(Error::Generate("没有要译的文字".into()));
    }

    let spec = crate::agent::AgentSpec {
        agent_id: "translator".into(),
        model: ctx.model.clone(),
        base_url: ctx.base_url.to_string(),
        preamble: TRANSLATE_PREAMBLE.to_string(),
        // 译提示词不需要发散：同一句中文两次译出不同结果，命中率就没法归因了
        temperature: Some(0.0),
        tools: vec![],
        autonomy: crate::config::Autonomy::Propose,
        max_turns: 1,
    };
    let agent = crate::agent::build(&spec, ctx.api_key);

    let out = tokio::time::timeout(ctx.timeout, async {
        use rig::completion::Prompt;
        agent.prompt(text).await
    })
    .await
    .map_err(|_| Error::Generate("译提示词超时".into()))?
    .map_err(|e| Error::Generate(format!("译提示词失败：{e}")))?;

    // 模型有时会加引号或「Prompt:」前缀 —— 那两样会被出图模型当成画面内容
    let cleaned = out
        .trim()
        .trim_start_matches("Prompt:")
        .trim_start_matches("prompt:")
        .trim()
        .trim_matches('"')
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return Err(Error::Generate("模型返回了空提示词".into()));
    }
    Ok(json!({ "text": cleaned, "model": ctx.model.model }))
}

/* ---------------- 样本：给前端的 parity 测试 ---------------- */

/// 合成规则的样本。见本文件头上那段「为什么会有第二份实现」。
pub fn samples() -> Value {
    let cases: &[(&str, &str, Value)] = &[
        ("跟项目画风", "watercolor storybook", json!({
            "id": "s1-1", "style": "全局", "own": "a girl at the window, morning light",
            "refs": ["CHAR-001", "SCENE-001"],
        })),
        ("节点级画风压过项目", "watercolor storybook", json!({
            "id": "s1-2", "style": "胶片质感", "own": "close on her hands", "refs": ["CHAR-001"],
        })),
        ("引用查不到描述时跳过_不把编号混进提示词", "watercolor storybook", json!({
            "id": "s1-3", "style": "", "own": "empty street", "refs": ["CHAR-999"],
        })),
        ("没有本镜内容时只有画风与引用", "watercolor storybook", json!({
            "id": "s1-4", "style": "全局", "own": "   ", "refs": ["SCENE-001"],
        })),
        ("项目画风也为空时不留空段", "", json!({
            "id": "s1-5", "style": "全局", "own": "rain on glass", "refs": [],
        })),
        ("词表里没有的自定义画风名原样带上", "watercolor storybook", json!({
            "id": "s1-6", "style": "我的风格", "own": "wide shot", "refs": [],
        })),
    ];
    let descs = vec![
        ("CHAR-001".to_string(), "Amy, 11, quiet, short black hair".to_string()),
        ("SCENE-001".to_string(), "suburban house, wooden window frame".to_string()),
    ];
    let out: Vec<Value> = cases
        .iter()
        .map(|(name, global, shot)| {
            let segs = compile_shot(shot, global, &descs);
            json!({
                "case": name, "globalStylePrompt": global, "shot": shot,
                "segments": segs, "text": text_of(&segs),
            })
        })
        .collect();
    json!({ "assetDescs": descs, "cases": out })
}

pub const SAMPLES_PATH: &str = "../../src/domain/prompt/__fixtures__/rust-prompts.json";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{Bundle, Meta};
    use tempfile::TempDir;

    fn setup() -> TempDir {
        let tmp = TempDir::new().unwrap();
        project::save(tmp.path(), &Bundle {
            meta: Meta {
                id: "p1".into(),
                style_prompt: "watercolor storybook".into(),
                ..Meta::default()
            },
            assets: json!({ "角色": [{ "aid": "CHAR-001", "name": "艾米", "desc": "Amy, 11" }] }),
            shots: json!([
                { "id": "s1-1", "style": "全局", "own": "at the window", "refs": ["CHAR-001"] },
                { "id": "s1-2", "style": "胶片质感", "own": "her hands", "refs": [] }
            ]),
            ..Default::default()
        }).unwrap();
        tmp
    }

    #[test]
    fn 三段式按_画风_引用_本镜_的顺序() {
        let tmp = setup();
        let v = compile(tmp.path(), "p1", &json!({ "shotIds": ["s1-1"] })).unwrap();
        let ks: Vec<&str> = v["prompts"][0]["segments"]
            .as_array().unwrap().iter()
            .map(|s| s["k"].as_str().unwrap()).collect();
        assert_eq!(ks, ["style", "ref", "own"]);
        assert_eq!(v["prompts"][0]["text"], "watercolor storybook, Amy, 11, at the window");
    }

    #[test]
    fn 节点级画风压过项目画风() {
        let tmp = setup();
        let v = compile(tmp.path(), "p1", &json!({ "shotIds": ["s1-2"] })).unwrap();
        assert_eq!(v["prompts"][0]["text"], "film photography, grainy, her hands");
    }

    #[test]
    fn 不给镜号就合成全部() {
        let tmp = setup();
        let v = compile(tmp.path(), "p1", &json!({})).unwrap();
        assert_eq!(v["prompts"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn 编错的镜号要报出来_不静默少算一条() {
        let tmp = setup();
        let e = compile(tmp.path(), "p1", &json!({ "shotIds": ["s1-1", "s9-9"] })).unwrap_err();
        assert!(e.to_string().contains("没有 s9-9"));
    }

    #[test]
    fn 查不到描述的引用跳过_编号不混进提示词() {
        let tmp = TempDir::new().unwrap();
        project::save(tmp.path(), &Bundle {
            meta: Meta { id: "p".into(), style_prompt: "s".into(), ..Meta::default() },
            assets: json!({}),
            shots: json!([{ "id": "s1-1", "own": "x", "refs": ["CHAR-404"] }]),
            ..Default::default()
        }).unwrap();
        let v = compile(tmp.path(), "p", &json!({})).unwrap();
        assert_eq!(v["prompts"][0]["text"], "s, x");
        assert!(!v["prompts"][0]["text"].as_str().unwrap().contains("CHAR-404"));
    }

    #[test]
    fn 空段不留逗号() {
        let segs = vec![seg("style", ""), seg("own", "rain")];
        assert_eq!(text_of(&segs), "rain");
    }

    #[test]
    fn 样本文件与当前实现一致_否则前端验的是过期规则() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SAMPLES_PATH);
        let want = crate::patch::samples_json(&samples());
        let got = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(got, want, "合成规则变了但 {} 没更新 —— 跑 `npm run fixtures`", path.display());
    }

    #[test]
    fn 译提示词的系统提示词把该说的都说了() {
        // 这四条是「译出来能不能用」的全部要点，少一条就会出现画不出来的提示词
        for must in ["VISIBLE", "Drop plot", "comma-separated", "No quotes"] {
            assert!(TRANSLATE_PREAMBLE.contains(must), "少了：{must}");
        }
    }

    #[tokio::test]
    async fn 空文字不去调模型() {
        let m = crate::config::ModelRef { provider: "deepseek".into(), model: "x".into() };
        let ctx = ChatCtx {
            model: &m, base_url: "http://127.0.0.1:1", api_key: "k",
            timeout: std::time::Duration::from_millis(50),
        };
        let e = translate(&ctx, &json!({ "text": "  " })).await.unwrap_err();
        assert!(e.to_string().contains("没有要译的"));
    }
}
