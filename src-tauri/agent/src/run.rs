//! 一次 Agent 运行的编排：事件序列与失败处理。
//!
//! **刻意放在 core 而不是 tauri 层**：tauri 层在没有 GUI 系统库的机器上编译不了，
//! 把编排放那儿等于这段代码永远没被类型检查过。这里能编、能测、能换 sink。

use crate::agent::{self, AgentSpec};
use studio_conf::config::{AgentConfig, ModelRef, ProviderSetting};
use studio_error::Error;
use crate::assets::{self, AssetsDraft, AssetsInput};
use crate::expand::{self, AltsDraft, ExpandInput};
use crate::outline::{self, OutlineDraft, OutlineInput};
use crate::script::{self, ScriptDraft, ScriptInput};
use crate::shotprompt::{self, PromptDraft, PromptInput};
use crate::shots::{self, ShotsDraft, ShotsInput};
use studio_skill::{SkillStore, compose_preamble};
use std::collections::HashMap;

/// 与前端 `AgentEvent` 同形。契约一致，前端换 transport 不用改事件处理。
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum RunEvent {
    Step { index: usize },
    Delta { text: String },
    /// 思考模型在开口之前的推理过程。**与 Delta 分开**：那不是产物的一部分，
    /// 混进正文等于把模型的草稿当成了它的回答
    Think { text: String },
    Proposal { draft: OutlineDraft },
    /// 补写提示词的产物。**刻意与 Proposal 分开**：几种产物形状不同，
    /// 合成一个 untagged 字段会让前端靠猜字段来分辨。
    Prompts { draft: PromptDraft },
    /// 延展走向的产物
    Alts { draft: AltsDraft },
    /// 写剧本的产物。`body` 是拼好的正文 Markdown ——
    /// **场次键与幕标题的拼法只在 Rust 侧有一份**（`script::body_of`），
    /// 前端不再实现一遍，两边漂移的话结构标记会对不上
    Script { draft: ScriptDraft, body: String },
    /// 提取资产的产物
    Assets { draft: AssetsDraft },
    /// 拆镜头的产物。`dropped` 是核对时丢掉了几条（模型编的场次键、
    /// 不认识的景别）—— **要带到界面上如实说**，不能让「20 镜里收了 17 镜」
    /// 看起来像模型只给了 17 镜
    Shots { draft: ShotsDraft, dropped: usize },
    Done,
    /// **失败也走事件**，不走 Result —— 否则前端要同时处理
    /// 「Promise reject」和「事件里的错误」两条路径。
    Failed { code: String, message: String },
}

impl RunEvent {
    fn failed(e: &Error) -> Self {
        RunEvent::Failed { code: e.code().into(), message: e.to_string() }
    }
}

/// 事件出口。tauri 侧传 Channel，测试里传个收集器。
pub trait Sink {
    fn emit(&self, event: RunEvent);
}

impl<F: Fn(RunEvent)> Sink for F {
    fn emit(&self, event: RunEvent) {
        self(event)
    }
}

/// 取密钥的方式。测试里换成假的，免得碰真的那份。
///
/// **只有 trait 在这儿，真实现（读那家的 YAML）不在。** 那一份在门面 crate
/// 里紧挨着 vault —— 这样 `vault::load` 不必为了被这里调用而变成公开的，
/// 「没有任何 IPC 命令能读出明文」这句话才还是编译器保证的。
pub trait Keys {
    fn get(&self, provider: &str) -> studio_error::Result<String>;
}

/// 一次运行的公共入参。`I` 是这条链路自己的输入形状 ——
/// 解析 Agent、取密钥这两步每条链路都一样，只有输入不同。
pub struct Run<'a, I> {
    pub cfg: &'a AgentConfig,
    pub fallback_preamble: &'a str,
    pub globals: &'a HashMap<String, ModelRef>,
    pub providers: &'a HashMap<String, ProviderSetting>,
    pub input: &'a I,
    /// 已加载的 skill。`skill` 指定这一轮要展开哪一个的正文（第 2 级）；
    /// 其余的只以名字+说明出现在清单里（第 1 级）。
    pub skills: &'a SkillStore,
    pub skill: Option<&'a str>,
}

/// 拼这一轮真正发出去的 preamble：人格 + skill 清单 + （要用的那个）skill 正文。
///
/// 正文在这里才读 —— 扫描时只读了 frontmatter。没找到那个 skill 不算致命错误：
/// 少一段指令，模型还能按人格干活，比整轮失败强。
fn preamble_of<I>(run: &Run<'_, I>, spec: &AgentSpec) -> String {
    let allowed: Vec<String> = run.cfg.skills.clone();
    let body = run.skill.and_then(|n| run.skills.body(n).ok());
    compose_preamble(&spec.preamble, &run.skills.catalog(&allowed), body.as_deref())
}

pub type OutlineRun<'a> = Run<'a, OutlineInput>;
pub type PromptRun<'a> = Run<'a, PromptInput>;
pub type ExpandRun<'a> = Run<'a, ExpandInput>;
pub type ScriptRun<'a> = Run<'a, ScriptInput>;
pub type AssetsRun<'a> = Run<'a, AssetsInput>;
pub type ShotsRun<'a> = Run<'a, ShotsInput>;

/// 解析阶段：不发请求，所以能独立测。失败时发 Failed 并返回 None。
fn prepare<I, S: Sink, K: Keys>(run: &Run<'_, I>, sink: &S, keys: &K) -> Option<(AgentSpec, String)> {
    sink.emit(RunEvent::Step { index: 1 });
    let spec = match agent::resolve(run.cfg, run.fallback_preamble, run.globals, run.providers) {
        Ok(s) => s,
        Err(e) => {
            sink.emit(RunEvent::failed(&e));
            return None;
        }
    };
    // 密钥在这里才取，且不出这个函数 —— 它不进事件、不进返回值
    match keys.get(&spec.model.provider) {
        Ok(k) => Some((spec, k)),
        Err(e) => {
            sink.emit(RunEvent::failed(&e));
            None
        }
    }
}

/// 文字的出口：模型每吐出一点就发一个事件。
///
/// 原来这儿是「等模型答完，再把整段按两字一块切开发出去」。观感像流式，
/// 实际上用户先对着空面板干等一整轮，反馈原话是「没有流式输出吗？」。
/// 现在这两个闭包交给 `structured::extract`，由它在收流的过程中调。
///
/// **推理过程也要发。** 思考模型在开口之前会先想很久，只发正文的话那段时间
/// 界面上还是一个字都没有 —— 只解了一半。
/// **为什么是宏而不是函数**：`Out` 借着那两个闭包，闭包又借着 sink ——
/// 一个返回 `Out` 的函数里，闭包是临时值，出了函数就没了。所以这两个绑定
/// 必须落在调用方的作用域里，而三条链路又都要这三行。
macro_rules! out_of {
    ($sink:expr, $out:ident) => {
        let reply = |t: &str| $sink.emit(RunEvent::Delta { text: t.to_string() });
        let think = |t: &str| $sink.emit(RunEvent::Think { text: t.to_string() });
        let $out = crate::structured::Out { reply: &reply, think: &think };
    };
}

/// 跑一次「起草大纲」。
pub async fn outline_draft<S: Sink + Sync, K: Keys>(run: OutlineRun<'_>, sink: S, keys: K) {
    let Some((spec, key)) = prepare(&run, &sink, &keys) else { return };

    sink.emit(RunEvent::Step { index: 2 });
    let preamble = preamble_of(&run, &spec);
    // 正文在这一步里就往外流了 —— 第 3 步是收尾（编号、对齐、收拾），
    // 它在正文说完之后才发
    out_of!(sink, out);
    let draft = match outline::draft(&spec, &key, &preamble, run.input, &out).await {
        Ok(d) => d,
        Err(e) => return sink.emit(RunEvent::failed(&e)),
    };

    sink.emit(RunEvent::Step { index: 3 });
    sink.emit(RunEvent::Proposal { draft });
    sink.emit(RunEvent::Done);
}

/// 跑一次「补写提示词」。步骤数与前端的步骤卡对齐。
pub async fn shots_prompt<S: Sink + Sync, K: Keys>(run: PromptRun<'_>, sink: S, keys: K) {
    let Some((spec, key)) = prepare(&run, &sink, &keys) else { return };

    sink.emit(RunEvent::Step { index: 2 });
    let preamble = preamble_of(&run, &spec);
    // 正文在这一步里就往外流了 —— 第 3 步是收尾（编号、对齐、收拾），
    // 它在正文说完之后才发
    out_of!(sink, out);
    let draft = match shotprompt::draft(&spec, &key, &preamble, run.input, &out).await {
        Ok(d) => d,
        Err(e) => return sink.emit(RunEvent::failed(&e)),
    };

    sink.emit(RunEvent::Step { index: 3 });
    sink.emit(RunEvent::Prompts { draft });
    sink.emit(RunEvent::Done);
}

/// 跑一次「延展走向」。步骤数与前端的步骤卡对齐。
pub async fn outline_expand<S: Sink + Sync, K: Keys>(run: ExpandRun<'_>, sink: S, keys: K) {
    let Some((spec, key)) = prepare(&run, &sink, &keys) else { return };

    sink.emit(RunEvent::Step { index: 2 });
    let preamble = preamble_of(&run, &spec);
    // 正文在这一步里就往外流了 —— 第 3 步是收尾（编号、对齐、收拾），
    // 它在正文说完之后才发
    out_of!(sink, out);
    let draft = match expand::expand(&spec, &key, &preamble, run.input, &out).await {
        Ok(d) => d,
        Err(e) => return sink.emit(RunEvent::failed(&e)),
    };

    sink.emit(RunEvent::Step { index: 3 });
    sink.emit(RunEvent::Alts { draft });
    sink.emit(RunEvent::Done);
}

/// 跑一次「写剧本」。步骤数与前端的步骤卡对齐。
pub async fn script_draft<S: Sink + Sync, K: Keys>(run: ScriptRun<'_>, sink: S, keys: K) {
    let Some((spec, key)) = prepare(&run, &sink, &keys) else { return };

    sink.emit(RunEvent::Step { index: 2 });
    let preamble = preamble_of(&run, &spec);
    out_of!(sink, out);
    let draft = match script::draft(&spec, &key, &preamble, run.input, &out).await {
        Ok(d) => d,
        Err(e) => return sink.emit(RunEvent::failed(&e)),
    };

    sink.emit(RunEvent::Step { index: 3 });
    let body = script::body_of(&draft, &run.input.act_title, &run.input.beat_key);
    sink.emit(RunEvent::Script { draft, body });
    sink.emit(RunEvent::Done);
}

/// 跑一次「提取资产」。步骤数与前端的步骤卡对齐。
pub async fn assets_extract<S: Sink + Sync, K: Keys>(run: AssetsRun<'_>, sink: S, keys: K) {
    let Some((spec, key)) = prepare(&run, &sink, &keys) else { return };

    sink.emit(RunEvent::Step { index: 2 });
    let preamble = preamble_of(&run, &spec);
    out_of!(sink, out);
    let draft = match assets::draft(&spec, &key, &preamble, run.input, &out).await {
        Ok(d) => d,
        Err(e) => return sink.emit(RunEvent::failed(&e)),
    };

    sink.emit(RunEvent::Step { index: 3 });
    sink.emit(RunEvent::Assets { draft });
    sink.emit(RunEvent::Done);
}

/// 跑一次「拆镜头」。步骤数与前端的步骤卡对齐。
pub async fn shots_generate<S: Sink + Sync, K: Keys>(run: ShotsRun<'_>, sink: S, keys: K) {
    let Some((spec, key)) = prepare(&run, &sink, &keys) else { return };

    sink.emit(RunEvent::Step { index: 2 });
    let preamble = preamble_of(&run, &spec);
    out_of!(sink, out);
    let (draft, dropped) = match shots::draft(&spec, &key, &preamble, run.input, &out).await {
        Ok(d) => d,
        Err(e) => return sink.emit(RunEvent::failed(&e)),
    };

    sink.emit(RunEvent::Step { index: 3 });
    sink.emit(RunEvent::Shots { draft, dropped });
    sink.emit(RunEvent::Done);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct Collector(Arc<Mutex<Vec<RunEvent>>>);

    impl Sink for Collector {
        fn emit(&self, e: RunEvent) {
            self.0.lock().unwrap().push(e);
        }
    }

    impl Collector {
        fn events(&self) -> Vec<RunEvent> {
            self.0.lock().unwrap().clone()
        }
        fn codes(&self) -> Vec<String> {
            self.events()
                .into_iter()
                .filter_map(|e| match e {
                    RunEvent::Failed { code, .. } => Some(code),
                    _ => None,
                })
                .collect()
        }
    }

    struct FakeKeys(Option<&'static str>);

    impl Keys for FakeKeys {
        fn get(&self, provider: &str) -> studio_error::Result<String> {
            self.0
                .map(str::to_string)
                .ok_or_else(|| Error::NoKey(provider.into()))
        }
    }

    fn globals() -> HashMap<String, ModelRef> {
        HashMap::from([(
            "text".to_string(),
            ModelRef { provider: "deepseek".into(), model: "deepseek-chat".into() },
        )])
    }

    fn cfg(v: serde_json::Value) -> AgentConfig {
        serde_json::from_value(v).unwrap()
    }

    fn input() -> OutlineInput {
        OutlineInput { project: "猫".into(), idea: "".into(), act_count: 0, beat_count: 0 }
    }

    fn run_prepare(c: &AgentConfig, keys: FakeKeys) -> Collector {
        let sink = Collector::default();
        let g = globals();
        let p = HashMap::new();
        let i = input();
        prepare(
            &OutlineRun {
                cfg: c, fallback_preamble: "出厂", globals: &g, providers: &p, input: &i,
                skills: &SkillStore::default(), skill: None,
            },
            &sink,
            &keys,
        );
        sink
    }

    #[test]
    fn 配置有问题时不发请求_先发_step_再发_failed() {
        let c = cfg(serde_json::json!({ "agentId": "writer", "enabled": false }));
        let sink = run_prepare(&c, FakeKeys(Some("sk-x")));
        assert_eq!(sink.events()[0], RunEvent::Step { index: 1 });
        assert_eq!(sink.codes(), ["unknown_agent"]);
    }

    #[test]
    fn 没配密钥时明确报_no_key_而不是让请求去撞未授权() {
        let c = cfg(serde_json::json!({ "agentId": "writer" }));
        let sink = run_prepare(&c, FakeKeys(None));
        assert_eq!(sink.codes(), ["no_key"]);
    }

    #[test]
    fn 没有模型时报_no_model_且不去取密钥() {
        let c = cfg(serde_json::json!({ "agentId": "writer" }));
        let sink = Collector::default();
        let no_models: HashMap<String, ModelRef> = HashMap::new();
        let no_providers: HashMap<String, ProviderSetting> = HashMap::new();
        let i = input();
        prepare(
            &OutlineRun {
                cfg: &c, fallback_preamble: "出厂",
                globals: &no_models, providers: &no_providers, input: &i,
                skills: &SkillStore::default(), skill: None,
            },
            &sink,
            // 取密钥就 panic：证明模型都没解析出来时不该去读密钥
            &FakeKeys(None),
        );
        assert_eq!(sink.codes(), ["no_model"]);
    }

    #[test]
    fn 解析通过时不发任何失败事件() {
        let c = cfg(serde_json::json!({ "agentId": "writer" }));
        let sink = run_prepare(&c, FakeKeys(Some("sk-x")));
        assert!(sink.codes().is_empty());
    }

    /// 正文出口给出去的是一个闭包，链路在收流的过程中调它，**每调一次就是
    /// 一个 Delta**。原来这儿测的是「等答完再按两字切开」那个函数 ——
    /// 那个函数没了，剩下要保证的就是这条：转成事件时不吞字、不合并。
    #[test]
    fn 每来一块就发一个_delta_原样不动() {
        let sink = Collector::default();
        out_of!(sink, out);
        for c in ["补在第二幕：", "那里只有一场，", "撑不住转折。"] {
            (out.reply)(c);
        }
        let got: Vec<String> = sink
            .events()
            .into_iter()
            .filter_map(|e| match e {
                RunEvent::Delta { text } => Some(text),
                _ => None,
            })
            .collect();
        assert_eq!(got, ["补在第二幕：", "那里只有一场，", "撑不住转折。"],
            "来几块发几个事件，不攒也不切");
    }

    #[test]
    fn 这一轮的_preamble_里有被展开的_skill_正文_也有清单() {
        use std::fs;
        let tmp = tempfile::TempDir::new().unwrap();
        for (n, d, b) in [
            ("draft-outline", "起草大纲用", "照三幕铺，每幕两三场"),
            ("write-shot-prompts", "补写提示词用", "景别术语开头"),
        ] {
            fs::create_dir_all(tmp.path().join(n)).unwrap();
            fs::write(
                tmp.path().join(n).join("SKILL.md"),
                format!("---\nname: {n}\ndescription: {d}\n---\n\n{b}\n"),
            )
            .unwrap();
        }
        let store = SkillStore::scan(&[studio_skill::Root {
            name: "内置".into(),
            path: tmp.path().to_path_buf(),
        }]);

        let c = cfg(serde_json::json!({
            "agentId": "writer",
            "skills": ["draft-outline", "write-shot-prompts"],
        }));
        let g = globals();
        let p = HashMap::new();
        let i = input();
        let run = OutlineRun {
            cfg: &c, fallback_preamble: "出厂", globals: &g, providers: &p, input: &i,
            skills: &store, skill: Some("draft-outline"),
        };
        let spec = agent::resolve(&c, "你是编剧。", &g, &p).unwrap();
        let text = preamble_of(&run, &spec);

        assert!(text.contains("你是编剧。"), "人格还在");
        // 第 1 级：两个 skill 都以名字+说明出现
        assert!(text.contains("起草大纲用") && text.contains("补写提示词用"));
        // 第 2 级：只有这一轮要用的那个展开了正文
        assert!(text.contains("照三幕铺"), "要用的那个正文要展开");
        assert!(!text.contains("景别术语开头"), "没轮到的那个正文不该进上下文");
    }

    #[test]
    fn 配置没授权的_skill_连名字都不进_preamble() {
        use std::fs;
        let tmp = tempfile::TempDir::new().unwrap();
        for (n, d) in [("mine", "我能用的"), ("theirs", "别人的")] {
            fs::create_dir_all(tmp.path().join(n)).unwrap();
            fs::write(
                tmp.path().join(n).join("SKILL.md"),
                format!("---\nname: {n}\ndescription: {d}\n---\n\n正文\n"),
            )
            .unwrap();
        }
        let store = SkillStore::scan(&[studio_skill::Root {
            name: "内置".into(), path: tmp.path().to_path_buf(),
        }]);
        let c = cfg(serde_json::json!({ "agentId": "writer", "skills": ["mine"] }));
        let g = globals();
        let p = HashMap::new();
        let i = input();
        let run = OutlineRun {
            cfg: &c, fallback_preamble: "出厂", globals: &g, providers: &p, input: &i,
            skills: &store, skill: None,
        };
        let spec = agent::resolve(&c, "你是编剧。", &g, &p).unwrap();
        let text = preamble_of(&run, &spec);
        assert!(text.contains("我能用的"));
        assert!(!text.contains("别人的"), "没授权的 skill 模型不该知道它存在");
    }

    #[test]
    fn 三条链路的产物事件各走各的_前端不用猜字段() {
        // 形状不同的产物合成一个 untagged 字段，前端就得靠「有没有 acts」这种
        // 猜法来分辨。判别字段必须不一样。
        let a = serde_json::to_value(RunEvent::Alts {
            draft: AltsDraft { reply: "x".into(), alts: vec!["甲".into()] },
        })
        .unwrap();
        assert_eq!(a["t"], "alts");
        assert_eq!(a["draft"]["alts"][0], "甲");
    }

    /// 六条链路的产物事件**判别字段各不一样**。
    ///
    /// 形状不同的产物合成一个 untagged 字段，前端就得靠「有没有 acts」这种
    /// 猜法来分辨 —— 加一条链路就多一处猜。
    #[test]
    fn 六条链路的产物事件各走各的() {
        use crate::assets::Cand;
        use crate::script::ScriptDraft;
        use crate::shots::{ShotCand, ShotsDraft};

        let d = ScriptDraft {
            reply: "x".into(), place: "客厅".into(), time: "深夜".into(),
            lines: vec!["他推开门。".into()],
        };
        let body = crate::script::body_of(&d, "失衡", "场景3");
        let v = serde_json::to_value(RunEvent::Script { draft: d, body }).unwrap();
        assert_eq!(v["t"], "script");
        assert_eq!(v["draft"]["lines"][0], "他推开门。");
        // 拼好的正文跟着事件走 —— 前端不再实现一遍那套结构标记
        assert!(v["body"].as_str().unwrap().contains("**场景3**"), "{v}");

        let v = serde_json::to_value(RunEvent::Assets {
            draft: AssetsDraft {
                reply: "x".into(),
                assets: vec![Cand { group: "角色".into(), name: "李明".into(), desc: "三十岁".into() }],
            },
        })
        .unwrap();
        assert_eq!(v["t"], "assets");
        assert_eq!(v["draft"]["assets"][0]["name"], "李明");

        // **dropped 要上到事件里**：否则「20 镜里收了 17 镜」在界面上
        // 看起来像模型只给了 17 镜
        let v = serde_json::to_value(RunEvent::Shots {
            draft: ShotsDraft {
                reply: "x".into(),
                shots: vec![ShotCand {
                    scene_key: "场景1".into(), size: "全景".into(),
                    desc: "他推开门".into(), dur: 4,
                }],
            },
            dropped: 3,
        })
        .unwrap();
        assert_eq!(v["t"], "shots");
        assert_eq!(v["dropped"], 3);
        assert_eq!(v["draft"]["shots"][0]["sceneKey"], "场景1");

        // 判别字段两两不同 —— 这才是分开定义的意义
        let tags = ["proposal", "prompts", "alts", "script", "assets", "shots"];
        assert_eq!(tags.iter().collect::<std::collections::HashSet<_>>().len(), 6);
    }

    #[test]
    fn 事件序列化成前端认识的形状() {
        let v = serde_json::to_value(RunEvent::Step { index: 2 }).unwrap();
        assert_eq!(v["t"], "step");
        assert_eq!(v["index"], 2);

        let v = serde_json::to_value(RunEvent::Failed {
            code: "no_key".into(),
            message: "没有配置 DeepSeek 的密钥".into(),
        })
        .unwrap();
        assert_eq!(v["t"], "failed");
        assert_eq!(v["code"], "no_key");
    }
}
