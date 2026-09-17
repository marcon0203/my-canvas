//! 工具：Agent 真正能动手的那些事。
//!
//! 一个 Agent = 提示词 + 模型 + skill + **工具**。前三样已经能组装了，
//! 工具原来只是一张清单 —— 名字、描述、风险都有，却没有任何代码因为
//! 「这个 Agent 有出图工具」而真的去出图。这里把它变成可调用的东西。
//!
//! # 每个工具要交代四件事
//!
//! | | 为什么要有 |
//! |---|---|
//! | `schema` | 模型要照着它填参数。没有 schema 的工具模型只能瞎猜 |
//! | `risk` | 决定自主模式下能不能自己调，见 `policy` |
//! | `runs_in` | 有些事 Rust 干不了（布光台是浏览器里的 WebGL） |
//! | `status` | **实现了没有**。没实现就如实说，不要让界面上看起来都一样能用 |
//!
//! # 闸门在调度处，不在调用方
//!
//! `dispatch` 里先过 `policy`，超出自主上限的直接返回「要人点头」，
//! 不执行。把判断放在每个调用方那儿迟早会漏掉一处。

use crate::config::ModelRef;
use crate::error::{Error, Result};
use crate::generate::{self, Job, TaskApi};
use crate::policy::{Risk, auto_allowed};
use crate::project;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::Path;

/// 这次调用是谁发起的。
///
/// `auto_allowed` 回答的是「**能不能不问就干**」，不是「能不能干」——
/// 把它当成唯一闸门的话，egress 那档永远是 false，人点了同意也跑不了。
/// 所以「人点过同意」必须是一条能传进来的信息。
///
/// **`Human` 只放行这一次调用。** 它不是一个设置，不会留在任何配置里，
/// 也不该由模型的输出决定 —— 调用方只在人真的点了那一下时才传它。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum By {
    /// Agent 自主调 —— 要过自主上限
    Agent,
    /// 人点了同意 —— 放行这一次
    Human,
}

/// 这个工具在哪儿跑
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunsIn {
    /// Rust 侧执行
    Rust,
    /// 只能在浏览器里跑（WebGL 之类）
    Browser,
}

/// 实现到什么程度。**如实说** —— 界面上不该让没实现的工具看起来一样能用
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// 真能调，跑通过
    Ready,
    /// **实现了，但厂商字段没对过真实文档。**
    ///
    /// 协议机制（提交/轮询/退避/超时/取消）是测过的；
    /// 「task_id 在响应的哪个字段」这类映射写这段代码时出网被挡，核不了。
    /// 接第一家时拿真 key 调一次，照报错改 `generate::adapters` 里那一两行。
    /// 单独列一档是因为：把它算作 Ready 是在撒谎，算作 Declared 又低估了 ——
    /// 它离能用只差一次真实调用。
    Unverified,
    /// 契约在，实现没有。缺什么写在 `blocked_by`
    Declared,
}

/// 工具分组。界面上按它归类 —— 二十几个工具平铺一片没法看
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Group {
    /// 读项目、找东西、算账
    Read,
    /// 改项目内容
    Write,
    /// 提示词的合成与翻译
    Prompt,
    /// 出图、出视频、配音配乐
    Generate,
    /// 镜头与布光台
    Camera,
    /// 成片与导出
    Deliver,
    /// 查外部资料
    Research,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub group: Group,
    /// 给模型看的描述 —— 它照这句话判断该不该用这个工具
    pub description: &'static str,
    pub risk: Risk,
    pub runs_in: RunsIn,
    pub status: Status,
    /// 还没实现时，缺的是什么
    pub blocked_by: Option<&'static str>,
    /// 参数的 JSON Schema
    pub schema: Value,
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": props, "required": required })
}

/// 全部工具。id 与前端 `domain/agent/tools.ts` 的 ToolId 一一对应，有 parity 测试。
///
/// 清单是按**这个产品真的要干的事**列的，不是通用 agent 工具箱。
/// 没实现的如实标 `Declared` 并写清缺什么 —— 一张看起来都能用的清单
/// 比一张诚实的短清单更糟。
pub fn all() -> Vec<ToolSpec> {
    let t = |id, name, group, description, risk, runs_in, status, blocked_by, schema| ToolSpec {
        id, name, group, description, risk, runs_in, status, blocked_by, schema,
    };
    use Group::*;
    use RunsIn::{Browser, Rust};
    use Risk::{Egress, Read as R, Spend, Write as W};
    use Status::{Declared, Ready, Unverified};

    // 没实现时的共同原因，写一次。
    // 原来这儿写的是「写类工具与前端 store 的同步」—— 那个问题已经由
    // Outcome::Patch 解决了（只有一个写入者）。剩下这两个卡的是别的东西：
    // 项目里根本还没有「时间线」和「字幕」这两份数据，剪辑页那三条轨是写死的占位。
    // 配音卡的不是「还没写」，是协议对不上：TTS 多数同步返回音频字节，
    // 不是「提交 → 轮询 → 拿 URL」。硬套那套协议只会拿到一个永远轮询不到的
    // 任务号。要先把「同步拿字节 + 存进项目目录」那条机制做出来。
    const TTS: &str = "配音不走异步任务协议 —— 多数厂商是同步返回音频字节。\
                       要先做「同步取字节 + 落进项目目录」那条机制，再接具体厂商";
    const NO_TL: &str = "项目里还没有时间线/字幕的数据模型 —— 剪辑页的轨道现在是写死的占位，\
                         得先把这两份数据落进项目（store + 落盘 + 界面），工具才有东西可写";
    const ADAPTER: &str = "协议已实现并测过，但厂商字段映射（task_id 在哪个字段等）没对过真实文档 —— 接第一家时拿真 key 调一次，照报错改 generate::adapters 里那一两行";

    vec![
        /* ---------------- 读 ---------------- */
        t("project.read", "读项目", Read,
          "读当前项目的大纲、剧本、资产、分镜。需要知道项目里已经有什么时用它，不要凭空假设。",
          R, Rust, Ready, None,
          obj(json!({ "part": { "type": "string", "enum": ["all", "outline", "script", "assets", "shots"],
              "description": "只读需要的那部分，整份项目可能很长" } }), &["part"])),

        t("project.search", "找内容", Read,
          "在项目的大纲、剧本、资产、分镜里按关键词找。想知道「某个角色在哪几场出现」这类问题用它，比把整份项目读进来省。",
          R, Rust, Ready, None,
          obj(json!({ "q": { "type": "string", "description": "关键词" },
              "limit": { "type": "integer", "minimum": 1, "maximum": 50 } }), &["q"])),

        t("metrics.read", "读记账", Read,
          "读生成次数、判定结果与积分消耗，按景别归因。回答成本与命中率问题时用它。",
          R, Rust, Ready, None, obj(json!({}), &[])),

        t("cost.estimate", "估花费", Read,
          "在真花之前算这一步大概要多少积分。要出图出视频前先用它报个数，别让人事后才知道花了多少。",
          R, Rust, Ready, None,
          obj(json!({ "kind": { "type": "string", "enum": ["image", "video", "audio"] },
              "count": { "type": "integer", "minimum": 1 },
              "batch": { "type": "integer", "minimum": 1, "maximum": 4 } }), &["kind", "count"])),

        /* ---------------- 写项目 ---------------- */
        t("outline.write", "写大纲", Write,
          "起草或补充幕与场次。场次键由程序统一重编，不要自己编号。",
          W, Rust, Ready, None,
          obj(json!({ "acts": { "type": "array", "description": "幕数组，形状同 outline.md" } }), &["acts"])),

        t("script.write", "写剧本", Write,
          "写正文块，或改写已有的一块（给 edit.id）。编错的 id 会被当场拒掉，不会静默丢。",
          W, Rust, Ready, None,
          obj(json!({
              "blocks": { "type": "array", "description": "要新增的正文块",
                  "items": obj(json!({ "label": { "type": "string" }, "body": { "type": "string" },
                      "type": { "type": "string", "enum": ["text", "character", "outline"] } }), &["label", "body"]) },
              "edit": obj(json!({ "id": { "type": "string" }, "body": { "type": "string" } }), &["id", "body"]),
          }), &[])),

        t("asset.write", "建资产", Write,
          "新建角色/场景/道具。aid 由程序按分组编号，不要自己编；同名的会被拒。",
          W, Rust, Ready, None,
          obj(json!({ "assets": { "type": "array", "items": obj(json!({
              "group": { "type": "string", "enum": ["角色", "场景", "道具"] },
              "name": { "type": "string" }, "desc": { "type": "string" },
              "voice": { "type": "string", "description": "角色音色，可选" },
          }), &["group", "name"]) } }), &["assets"])),

        t("asset.lock", "资产定稿", Write,
          "锁定资产版本，锁定后分镜才能引用它。资产不存在会直接报错。",
          W, Rust, Ready, None,
          obj(json!({ "aid": { "type": "string" } }), &["aid"])),

        t("shot.write", "写分镜", Write,
          "拆镜、改镜头字段与资产引用。镜号由程序分配，不要自己编。",
          W, Rust, Ready, None,
          obj(json!({ "shots": { "type": "array" } }), &["shots"])),

        /* ---------------- 提示词 ---------------- */
        // **只读**。分镜提示词是从画风/引用/本镜内容算出来的派生值，
        // 落盘反而会让它和源头对不上 —— 要改提示词就去改源头。
        // 注册表里它原来标着「会改项目」，那是错的。
        t("prompt.compile", "合成提示词", Prompt,
          "看这几镜真正会发出去的提示词长什么样（画风 + 引用资产描述 + 本镜内容）。它是算出来的，改提示词要改源头。",
          R, Rust, Ready, None,
          obj(json!({ "shotIds": { "type": "array", "items": { "type": "string" },
              "description": "不给就合成全部" } }), &[])),

        t("prompt.translate", "提示词中译英", Prompt,
          "把中文描述译成出图模型认的英文提示词。只译画面里看得见的东西，不译情节与心理。",
          R, Rust, Ready, None,
          obj(json!({ "text": { "type": "string" } }), &["text"])),

        t("style.apply", "换画风", Prompt,
          "把项目画风换成另一种，并重算所有受影响的提示词。节点级单独指定过画风的不跟着走。画风名要在项目的可选清单里，编不出来。",
          W, Rust, Ready, None,
          obj(json!({ "style": { "type": "string" } }), &["style"])),

        /* ---------------- 生成 ---------------- */
        t("image.generate", "出图", Generate,
          "按提示词生成形状照或关键帧。要花积分。",
          Spend, Rust, Unverified, Some(ADAPTER),
          obj(json!({ "prompt": { "type": "string" }, "ratio": { "type": "string" },
              "batch": { "type": "integer", "minimum": 1, "maximum": 4 },
              "refs": { "type": "array", "items": { "type": "string" }, "description": "参考图的资产 aid" } }),
              &["prompt"])),

        t("image.edit", "改图", Generate,
          "局部重绘或扩图。改一处不重出整张，比重跑一次省。要说清改成什么样 —— 空指令只会重出一张随机图。",
          Spend, Rust, Unverified, Some(ADAPTER),
          obj(json!({ "assetId": { "type": "string" }, "viewName": { "type": "string" },
              "instruction": { "type": "string", "description": "要改成什么样" },
              "mask": { "type": "string", "description": "可选，要改的区域" } }),
              &["assetId", "instruction"])),

        t("image.upscale", "放大", Generate,
          "把选中的候选图放大到成片分辨率。定稿之后再放大，不要每版都放。倍数只能是 2 或 4。",
          Spend, Rust, Unverified, Some(ADAPTER),
          obj(json!({ "assetId": { "type": "string" }, "scale": { "type": "integer", "enum": [2, 4] } }),
              &["assetId"])),

        t("video.generate", "出视频", Generate,
          "关键帧 → 视频片段。要花积分，而且比出图贵得多。",
          Spend, Rust, Unverified, Some(ADAPTER),
          obj(json!({ "shotId": { "type": "string" }, "dur": { "type": "number" },
              "firstFrame": { "type": "string", "description": "首帧图，可选" } }), &["shotId"])),

        t("video.extend", "续接片段", Generate,
          "把已有片段往后续几秒，尾帧接着长。比重出一条省。一次最多 10 秒 —— 要更长就分几次接，每次都能先看一眼。",
          Spend, Rust, Unverified, Some(ADAPTER),
          obj(json!({ "shotId": { "type": "string" }, "seconds": { "type": "number" } }),
              &["shotId", "seconds"])),

        t("audio.tts", "配音", Generate,
          "把台词读成语音。音色在资产里按角色配。",
          Spend, Rust, Declared, Some(TTS),
          obj(json!({ "text": { "type": "string" }, "voice": { "type": "string" },
              "speed": { "type": "number" } }), &["text"])),

        t("audio.music", "配乐", Generate,
          "按情绪与时长生成背景音乐。",
          Spend, Rust, Unverified, Some(ADAPTER),
          obj(json!({ "mood": { "type": "string" }, "seconds": { "type": "number" } }),
              &["mood", "seconds"])),

        t("audio.sfx", "音效", Generate,
          "生成单个音效，比如雨声、脚步、关门。",
          Spend, Rust, Unverified, Some(ADAPTER),
          obj(json!({ "desc": { "type": "string" }, "seconds": { "type": "number" } }), &["desc"])),

        /* ---------------- 镜头 ---------------- */
        // status 答「这个能力实现了没有」，runs_in 答「在哪儿跑」。
        // 布光台是浏览器里的 WebGL，前端已经实现并接上了 —— 拿 status 再说一遍
        // 「Rust 没实现」会让界面把一个能用的工具标成灰的。
        t("stage.render", "渲参考图", Camera,
          "用布光台的白模离屏渲一张机位参考图。本地渲染，不花钱 —— 先把机位定死再出图，比多摇几次便宜。",
          R, Browser, Ready, None,
          obj(json!({ "shotId": { "type": "string" } }), &["shotId"])),

        t("shot.rig", "设机位光线", Camera,
          "改这一镜的机位、焦距、光位。只写要改的字段，没写的保持原样。改完可以用渲参考图看效果。",
          W, Rust, Ready, None,
          obj(json!({ "shotId": { "type": "string" },
              "rig": { "type": "object", "description": "机位与灯光参数" } }), &["shotId", "rig"])),

        /* ---------------- 成片 ---------------- */
        t("edit.timeline", "排时间线", Deliver,
          "把判定可用的片段按场次与节拍排进时间线。",
          W, Rust, Declared, Some(NO_TL),
          obj(json!({ "beatMs": { "type": "number", "description": "卡点间隔，可选" } }), &[])),

        t("edit.subtitle", "生成字幕", Deliver,
          "按剧本正文与配音时间轴生成字幕。",
          W, Rust, Declared, Some(NO_TL),
          obj(json!({ "lang": { "type": "string" } }), &[])),

        t("file.export", "导出文件", Deliver,
          "把剧本导成 .md 或成片导成 .mp4。东西会离开这台机器。",
          Egress, Rust, Declared,
          Some("导出路径要用户选，不能由 Agent 决定写到哪儿"),
          obj(json!({ "what": { "type": "string", "enum": ["script", "film", "shots"] } }), &["what"])),

        /* ---------------- 查资料 ---------------- */
        t("web.search", "搜网页", Research,
          "查外部资料。做广告片要查产品卖点、做历史题材要查考据时用它。",
          Egress, Rust, Declared,
          Some("会把查询词发出本机，要先想清楚哪些内容不该进搜索框"),
          obj(json!({ "q": { "type": "string" }, "limit": { "type": "integer" } }), &["q"])),

        t("web.fetch", "读网页", Research,
          "读一个指定网址的正文。",
          Egress, Rust, Declared, Some("同 web.search"),
          obj(json!({ "url": { "type": "string" } }), &["url"])),
    ]
}

/// 走异步任务协议的那几个。**配音不在里面** —— 它多数是同步返回音频字节，
/// 见 `generate::adapters::of` 上的说明。
pub const GENERATE_TOOLS: &[&str] = &[
    "image.generate", "image.edit", "image.upscale",
    "video.generate", "video.extend",
    "audio.music", "audio.sfx",
];

pub fn spec(id: &str) -> Option<ToolSpec> {
    all().into_iter().find(|t| t.id == id)
}

/// 一次工具调用的结果。**「要人点头」是正常结果，不是错误** ——
/// 它会变成界面上一张待确认的卡，而不是一条报错。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Outcome {
    Ok { value: Value },
    /// **写类工具不落盘，返回一份补丁。**
    ///
    /// 为什么不让 Rust 直接写：前端 store 是界面的活数据，autosave 会把它
    /// 写回盘。Rust 也写的话就有两个写入者 —— Rust 刚写完，autosave 拿着
    /// store 里的旧数据一覆盖，改动就没了。这种丢更新很难查，因为两边看
    /// 各自都「成功」了。
    ///
    /// 所以写入者只有一个（前端），Rust 这边做它真正擅长的：**校验与编号**。
    /// 补丁走原来那条「产物 → 人采纳 → applyAgentPatch → 一条撤销记录」，
    /// 权限闸门、撤销、diff 全都不用另做一套。
    Patch { tool: String, patch: Value },
    /// 超出自主上限，等人点头
    NeedsApproval { tool: String, risk: Risk, why: String },
    /// 契约在、实现还没有。**这是「等人写代码」**，与下面那条不是一回事
    NotImplemented { tool: String, blocked_by: String },
    /// 实现有，但缺配置（没配模型、没填密钥、厂商没适配）。
    ///
    /// 和 `NotImplemented` 分开是因为**要做的事完全不同**：这条是「去设置里配一下」，
    /// 那条是「等人把它写出来」。混成一条的话，界面只能说「用不了」，
    /// 而用户手上明明有能解决的办法。
    NeedsSetup { tool: String, missing: String },
    /// 这个工具不在 Rust 侧跑
    Elsewhere { tool: String, runs_in: RunsIn },
}

/// 调度一次工具调用。
///
/// 顺序刻意是「先查有没有这个工具 → 再过闸门 → 最后才看实现了没有」：
/// 一个没实现的高风险工具，也应该先因为越权被挡，而不是先告诉调用方「还没做」——
/// 否则将来补上实现，拦截行为会悄悄变。
///
/// `by` 见 [`By`]：`Agent` 要过自主上限，`Human` 是人点过同意，放行这一次。
/// 生成类工具要的东西：用哪个模型、端点、密钥。
/// **密钥只在这儿传一次，不进 Outcome、不进日志。**
pub struct GenCtx<'a> {
    pub model: &'a ModelRef,
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub api: TaskApi,
    pub timeout: std::time::Duration,
}

/// 一次调用可能要用到的外部上下文。**两类工具要的东西不一样**：
/// 出图出视频要异步任务接口（`gen`），译提示词要文本模型（`chat`）。
///
/// 聚成一个参数而不是往 `dispatch` 上再挂一个 `Option` —— 后面还会有别的
/// （音频、搜索服务），一个个加参数迟早排错顺序。
#[derive(Default)]
pub struct Ctx<'a> {
    /// 异步任务接口（出图出视频）。字段名不叫 gen —— 那是 edition 2024 的保留字
    pub task: Option<GenCtx<'a>>,
    pub chat: Option<crate::prompt::ChatCtx<'a>>,
}

impl<'a> Ctx<'a> {
    pub fn task(g: GenCtx<'a>) -> Self {
        Self { task: Some(g), chat: None }
    }
    pub fn chat(c: crate::prompt::ChatCtx<'a>) -> Self {
        Self { task: None, chat: Some(c) }
    }
}

pub async fn dispatch(
    root: &Path,
    project_id: &str,
    tool_id: &str,
    args: Value,
    auto_max: Option<Risk>,
    by: By,
    ctx: Ctx<'_>,
) -> Result<Outcome> {
    let Some(t) = spec(tool_id) else {
        return Err(Error::UnknownTool(tool_id.to_string()));
    };

    if by == By::Agent && !auto_allowed(t.risk, auto_max) {
        return Ok(Outcome::NeedsApproval {
            tool: t.id.into(),
            risk: t.risk,
            why: format!("「{}」{}，超出这个 Agent 的自主上限", t.name, why_of(t.risk)),
        });
    }

    if t.runs_in == RunsIn::Browser {
        return Ok(Outcome::Elsewhere { tool: t.id.into(), runs_in: t.runs_in });
    }

    // 生成类：有 GenCtx 才跑得起来。没有就说清缺什么，不要假装跑了
    if GENERATE_TOOLS.contains(&t.id) {
        let Some(g) = ctx.task else {
            return Ok(Outcome::NeedsSetup {
                tool: t.id.into(),
                missing: format!(
                    "{}要一个{}模型和它的密钥，还要这家的接口适配 —— 去「模型设置」接入一家、加上模型，再在这位 Agent 的配置里选上",
                    t.name,
                    match t.id.split('.').next().unwrap_or("") {
                        "image" => "图片",
                        "video" => "视频",
                        _ => "音频",
                    }
                ),
            });
        };
        let urls = run_generate(t.id, &g, &args).await?;
        return Ok(Outcome::Ok { value: json!({ "urls": urls, "model": g.model.model }) });
    }

    // 译提示词：要文本模型。同理 —— 缺了就说缺了
    if t.id == "prompt.translate" {
        let Some(c) = ctx.chat else {
            return Ok(Outcome::NeedsSetup {
                tool: t.id.into(),
                missing: "译提示词要一个文本模型和它的密钥 —— 去「模型设置」接入一家、加上模型".into(),
            });
        };
        return Ok(Outcome::Ok { value: crate::prompt::translate(&c, &args).await? });
    }

    if t.status != Status::Ready {
        return Ok(Outcome::NotImplemented {
            tool: t.id.into(),
            blocked_by: t.blocked_by.unwrap_or("还没实现").into(),
        });
    }

    // 写类工具：算出补丁交回去，不落盘（见 Outcome::Patch 上的说明）
    if let Some(patch) = crate::patch::of(root, project_id, t.id, &args)? {
        return Ok(Outcome::Patch { tool: t.id.into(), patch });
    }

    let value = match t.id {
        "project.read" => read_project(root, project_id, &args)?,
        "project.search" => search_project(root, project_id, &args)?,
        "metrics.read" => read_metrics(root, project_id)?,
        "cost.estimate" => estimate_cost(&args)?,
        "prompt.compile" => crate::prompt::compile(root, project_id, &args)?,
        // status == Ready 的工具必须在这儿有分支，否则是注册表和实现对不上
        other => return Err(Error::UnknownTool(format!("{other} 标成已实现却没有实现"))),
    };
    Ok(Outcome::Ok { value })
}

fn why_of(r: Risk) -> &'static str {
    match r {
        Risk::Read => "只读",
        Risk::Write => "会改项目",
        Risk::Spend => "要花积分",
        Risk::Egress => "会把东西送出这台机器",
    }
}

/// 只读需要的那部分 —— 整份项目可能很长，塞进上下文是浪费
fn read_project(root: &Path, id: &str, args: &Value) -> Result<Value> {
    let b = project::load(root, id)?;
    let part = args.get("part").and_then(Value::as_str).unwrap_or("all");
    Ok(match part {
        "outline" => json!({ "acts": b.acts }),
        "script" => json!({ "blocks": b.blocks }),
        "assets" => json!({ "assets": b.assets }),
        "shots" => json!({ "shots": b.shots }),
        _ => json!({
            "meta": b.meta, "acts": b.acts, "blocks": b.blocks,
            "assets": b.assets, "shots": b.shots,
        }),
    })
}

/// 出图/出视频：拼 body → 走异步任务协议。
///
/// body 的形状按各家来，与 `generate::adapters` 里的字段路径成对 ——
/// 那张表还没对过真实文档，接第一家时一起改。
async fn run_generate(tool: &str, ctx: &GenCtx<'_>, args: &Value) -> Result<Vec<String>> {
    let body = gen_body(tool, &ctx.model.model, args)?;
    generate::run(
        Job {
            api: &ctx.api,
            base_url: ctx.base_url,
            api_key: ctx.api_key,
            body,
            timeout: ctx.timeout,
        },
        || false,
    )
    .await
}

/// 每个生成类工具的请求体。**纯函数**，所以每条参数校验都能单测 ——
/// 这些校验拦的是「白花一次钱」，最该被测到。
///
/// 字段名按各家的 OpenAI 风格拼（prompt / n / size…），与 `generate::adapters`
/// 那张表成对 —— 那张表没对过真实文档，接第一家时一起改。
fn gen_body(tool: &str, model: &str, args: &Value) -> Result<Value> {
    let text = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let mut body = json!({ "model": model });
    let o = body.as_object_mut().unwrap();

    match tool {
        "image.generate" => {
            let prompt = text("prompt");
            if prompt.is_empty() {
                return Err(Error::Generate("提示词是空的 —— 不拿空提示词去花钱".into()));
            }
            o.insert("prompt".into(), json!(prompt));
            if let Some(r) = args.get("ratio") {
                o.insert("size".into(), r.clone());
            }
            // batch 封顶 4：这是花钱的东西，别让一个笔误变成四十张图
            let n = args.get("batch").and_then(Value::as_u64).unwrap_or(1).clamp(1, 4);
            o.insert("n".into(), json!(n));
        }

        "image.edit" => {
            // 改哪张、改成什么样 —— 两样缺一样，这次调用就是在烧钱换一张随机图
            let asset = text("assetId");
            let instruction = text("instruction");
            if asset.is_empty() {
                return Err(Error::Generate("没说改哪个资产的图".into()));
            }
            if instruction.is_empty() {
                return Err(Error::Generate("没说要改成什么样 —— 空指令只会重出一张随机图".into()));
            }
            o.insert("asset_id".into(), json!(asset));
            o.insert("prompt".into(), json!(instruction));
            let view = text("viewName");
            if !view.is_empty() {
                o.insert("view".into(), json!(view));
            }
            if let Some(m) = args.get("mask").filter(|x| !x.is_null()) {
                o.insert("mask".into(), m.clone());
            }
            o.insert("n".into(), json!(1));
        }

        "image.upscale" => {
            let asset = text("assetId");
            if asset.is_empty() {
                return Err(Error::Generate("没说放大哪个资产的图".into()));
            }
            // 只有 2 和 4 —— 别的倍数各家都不收，发过去是白跑一次
            let scale = args.get("scale").and_then(Value::as_u64).unwrap_or(2);
            if scale != 2 && scale != 4 {
                return Err(Error::Generate(format!("放大倍数只能是 2 或 4，给的是 {scale}")));
            }
            o.insert("asset_id".into(), json!(asset));
            o.insert("scale".into(), json!(scale));
        }

        "video.generate" => {
            let shot = text("shotId");
            if shot.is_empty() {
                return Err(Error::Generate("没说给哪一镜出视频".into()));
            }
            o.insert("shot_id".into(), json!(shot));
            if let Some(d) = args.get("dur") {
                o.insert("duration".into(), d.clone());
            }
            let first = text("firstFrame");
            if !first.is_empty() {
                o.insert("first_frame".into(), json!(first));
            }
        }

        "video.extend" => {
            let shot = text("shotId");
            if shot.is_empty() {
                return Err(Error::Generate("没说续接哪一镜".into()));
            }
            // 续接是按秒计费的东西。上限 10 秒是刻意的：要更长就分几次接，
            // 每次都能看一眼 —— 一次续 60 秒，不满意就是 60 秒的钱
            let sec = args.get("seconds").and_then(Value::as_f64).unwrap_or(0.0);
            if !(0.5..=10.0).contains(&sec) {
                return Err(Error::Generate(format!(
                    "续接时长要在 0.5–10 秒之间，给的是 {sec} —— 要更长就分几次接，每次都能先看一眼"
                )));
            }
            o.insert("shot_id".into(), json!(shot));
            o.insert("seconds".into(), json!(sec));
        }

        "audio.music" | "audio.sfx" => {
            let key = if tool == "audio.music" { "mood" } else { "desc" };
            let what = text(key);
            if what.is_empty() {
                return Err(Error::Generate(
                    if tool == "audio.music" { "没说要什么情绪的音乐" } else { "没说要什么音效" }.into(),
                ));
            }
            let sec = args.get("seconds").and_then(Value::as_f64).unwrap_or(0.0);
            if !(0.5..=300.0).contains(&sec) {
                return Err(Error::Generate(format!("时长要在 0.5–300 秒之间，给的是 {sec}")));
            }
            o.insert("prompt".into(), json!(what));
            o.insert("seconds".into(), json!(sec));
        }

        other => return Err(Error::Generate(format!("{other} 不是生成类工具"))),
    }
    Ok(body)
}

/// 在项目里找关键词。返回**命中在哪儿**而不是整段内容 —— 让模型自己决定要不要细读
fn search_project(root: &Path, id: &str, args: &Value) -> Result<Value> {
    let q = args.get("q").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    if q.is_empty() {
        return Err(Error::Store("找什么？关键词不能为空".into()));
    }
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(20) as usize;
    let b = project::load(root, id)?;
    let mut hits: Vec<Value> = Vec::new();
    let mut hit = |where_: &str, key: &str, text: &str| {
        if hits.len() < limit && text.to_lowercase().contains(&q) {
            hits.push(json!({ "where": where_, "key": key, "text": text }));
        }
    };
    for a in &b.acts {
        hit("outline", &a.t, &a.t);
        for x in &a.beats {
            hit("outline", &x.k, &x.t);
        }
    }
    for blk in &b.blocks {
        hit("script", &blk.label, &blk.body);
    }
    if let Some(groups) = b.assets.as_object() {
        for (g, list) in groups {
            for a in list.as_array().unwrap_or(&vec![]) {
                let name = a.get("name").and_then(Value::as_str).unwrap_or("");
                let desc = a.get("desc").and_then(Value::as_str).unwrap_or("");
                hit(g, name, &format!("{name} {desc}"));
            }
        }
    }
    for sh in b.shots.as_array().unwrap_or(&vec![]) {
        let sid = sh.get("id").and_then(Value::as_str).unwrap_or("");
        let d = sh.get("desc").and_then(Value::as_str).unwrap_or("");
        let own = sh.get("own").and_then(Value::as_str).unwrap_or("");
        hit("shots", sid, &format!("{d} {own}"));
    }
    Ok(json!({ "q": q, "hits": hits.len(), "results": hits }))
}

/// 花钱之前先报个数。**价目表是这里的，不是模型编的** ——
/// 让模型自己估价会报出一个听着合理但没根据的数字。
fn estimate_cost(args: &Value) -> Result<Value> {
    let kind = args.get("kind").and_then(Value::as_str).unwrap_or("");
    let count = args.get("count").and_then(Value::as_u64).unwrap_or(1);
    let batch = args.get("batch").and_then(Value::as_u64).unwrap_or(1).clamp(1, 4);
    let unit = match kind {
        "image" => 3,
        "video" => 12,
        "audio" => 1,
        other => return Err(Error::Store(format!("不认识的生成类型：{other}"))),
    };
    let total = unit * count * batch;
    Ok(json!({
        "kind": kind, "unit": unit, "count": count, "batch": batch, "credits": total,
        "note": "按当前价目表估算；真实消耗以厂商返回为准"
    }))
}

/// 记账：从 shots.json 算命中率与消耗。**算不出就说算不出**，不要编一个数
fn read_metrics(root: &Path, id: &str) -> Result<Value> {
    let b = project::load(root, id)?;
    let shots = b.shots.as_array().cloned().unwrap_or_default();
    let takes: u64 = shots.iter().filter_map(|s| s.get("takes")?.as_u64()).sum();
    let usable = shots.iter().filter(|s| s.get("verdict").and_then(Value::as_str) == Some("ok")).count();
    let judged = shots.iter().filter(|s| s.get("verdict").is_some_and(|v| !v.is_null())).count();
    let spent = b.meta.budget.saturating_sub(b.meta.credits);
    Ok(json!({
        "shots": shots.len(),
        "takes": takes,
        "usable": usable,
        "judged": judged,
        "hitRate": if takes > 0 { Some((usable as f64 / takes as f64 * 100.0).round()) } else { None },
        "spent": spent,
        "credits": b.meta.credits,
        "note": if judged == 0 { "还没有判定数据，命中率算不出来" } else { "" },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::policy::risk_of_tool;
    use crate::md::{Act, Beat};
    use crate::project::{Bundle, Meta};
    use tempfile::TempDir;

    fn setup() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let b = Bundle {
            meta: Meta { id: "p1".into(), proj: "猫".into(), credits: 106, budget: 120, ..Meta::default() },
            acts: vec![Act {
                id: "a1".into(), t: "第一幕".into(), span: "0:00–1:00".into(),
                beats: vec![Beat { id: "b1".into(), k: "场景1".into(), t: "窗边画猫".into() }],
            }],
            blocks: vec![],
            assets: json!({ "角色": [{ "aid": "CHAR-001" }] }),
            shots: json!([
                { "id": "s1-1", "takes": 3, "verdict": "ok" },
                { "id": "s1-2", "takes": 2, "verdict": "redo" },
                { "id": "s1-3", "takes": 0, "verdict": null }
            ]),
        };
        project::save(tmp.path(), &b).unwrap();
        tmp
    }

    #[tokio::test]
    async fn 读项目能只读一部分_整份太长塞进上下文是浪费() {
        let tmp = setup();
        let o = dispatch(tmp.path(), "p1", "project.read", json!({ "part": "outline" }), None, By::Agent, Ctx::default())
            .await.unwrap();
        let Outcome::Ok { value } = o else { panic!("{o:?}") };
        assert!(value.get("acts").is_some());
        assert!(value.get("shots").is_none(), "只要大纲就别把分镜也给它");
    }

    #[tokio::test]
    async fn 读项目_all_给全份() {
        let tmp = setup();
        let o = dispatch(tmp.path(), "p1", "project.read", json!({ "part": "all" }), None, By::Agent, Ctx::default()).await.unwrap();
        let Outcome::Ok { value } = o else { panic!() };
        for k in ["meta", "acts", "blocks", "assets", "shots"] {
            assert!(value.get(k).is_some(), "缺 {k}");
        }
    }

    #[tokio::test]
    async fn 记账算出的数对得上() {
        let tmp = setup();
        let Outcome::Ok { value } = dispatch(tmp.path(), "p1", "metrics.read", json!({}), None, By::Agent, Ctx::default()).await.unwrap()
            else { panic!() };
        assert_eq!(value["shots"], 3);
        assert_eq!(value["takes"], 5);      // 3 + 2 + 0
        assert_eq!(value["usable"], 1);
        assert_eq!(value["spent"], 14);     // 120 - 106
        assert_eq!(value["hitRate"], 20.0); // 1/5
    }

    #[tokio::test]
    async fn 没有判定数据时说算不出_不编一个命中率() {
        let tmp = TempDir::new().unwrap();
        project::save(tmp.path(), &Bundle {
            meta: Meta { id: "空".into(), ..Meta::default() },
            shots: json!([]), ..Default::default()
        }).unwrap();
        let Outcome::Ok { value } = dispatch(tmp.path(), "空", "metrics.read", json!({}), None, By::Agent, Ctx::default()).await.unwrap()
            else { panic!() };
        assert!(value["hitRate"].is_null());
        assert!(value["note"].as_str().unwrap().contains("算不出"));
    }

    #[tokio::test]
    async fn 超出自主上限的工具不执行_返回要人点头() {
        let tmp = setup();
        // 出厂上限是 write，出图是 spend
        let o = dispatch(tmp.path(), "p1", "image.generate", json!({ "prompt": "x" }), None, By::Agent, Ctx::default()).await.unwrap();
        match o {
            Outcome::NeedsApproval { tool, risk, why } => {
                assert_eq!(tool, "image.generate");
                assert_eq!(risk, Risk::Spend);
                assert!(why.contains("积分"));
            }
            x => panic!("该被挡住，实际 {x:?}"),
        }
    }

    #[tokio::test]
    async fn 闸门在实现检查之前_没实现的高风险工具也先因为越权被挡() {
        let tmp = setup();
        // image.generate 既没实现、风险又超标。必须报越权而不是「还没做」——
        // 否则将来补上实现，拦截行为会悄悄变
        let o = dispatch(tmp.path(), "p1", "image.generate", json!({}), None, By::Agent, Ctx::default()).await.unwrap();
        assert!(matches!(o, Outcome::NeedsApproval { .. }));
    }

    #[tokio::test]
    async fn 上限放开但没给模型密钥时_如实说缺什么_不假装跑了() {
        let tmp = setup();
        let o = dispatch(tmp.path(), "p1", "image.generate", json!({ "prompt": "cat" }),
            Some(Risk::Spend), By::Agent, Ctx::default()).await.unwrap();
        // 缺配置是 NeedsSetup，不是 NotImplemented —— 用户手上有能解决的办法，
        // 界面要说「去配一下」，而不是「用不了」
        match o {
            Outcome::NeedsSetup { tool, missing } => {
                assert_eq!(tool, "image.generate");
                assert!(missing.contains("模型设置"), "{missing}");
            }
            x => panic!("{x:?}"),
        }
    }

    #[test]
    fn 未验证这一档要说清它离能用差什么() {
        let list: Vec<_> = all().into_iter().filter(|t| t.status == Status::Unverified).collect();
        assert!(!list.is_empty(), "出图出视频应该在这一档");
        for t in list {
            let b = t.blocked_by.unwrap_or("");
            assert!(b.contains("没对过") && b.contains("真 key"), "{}: {b}", t.id);
        }
    }

    #[tokio::test]
    async fn 出本机的工具_自主上限调到最高也得先问人() {
        let tmp = setup();
        for m in [None, Some(Risk::Write), Some(Risk::Spend), Some(Risk::Egress)] {
            let o = dispatch(tmp.path(), "p1", "file.export", json!({ "what": "script" }), m, By::Agent, Ctx::default())
                .await.unwrap();
            assert!(matches!(o, Outcome::NeedsApproval { .. }), "上限 {m:?} 下没挡住：{o:?}");
        }
    }

    /// 人点过同意之后必须真的跑得起来。
    ///
    /// 这条守的是一个曾经真存在的洞：`auto_allowed` 回答的是「能不能不问就干」，
    /// egress 那档它永远是 false。把它当成唯一闸门时，人点了同意也照样被挡，
    /// 于是 egress 类工具的实现全是死代码 —— 而且没有任何测试会发现。
    #[tokio::test]
    async fn 人点过同意的那一次要能跑_不然_egress_工具全是死代码() {
        let tmp = setup();
        let o = dispatch(tmp.path(), "p1", "file.export", json!({ "what": "script" }), None, By::Human, Ctx::default())
            .await.unwrap();
        assert!(!matches!(o, Outcome::NeedsApproval { .. }), "人都点了同意还挡：{o:?}");
    }

    #[tokio::test]
    async fn 浏览器里跑的工具明说在别处跑() {
        let tmp = setup();
        let o = dispatch(tmp.path(), "p1", "stage.render", json!({ "shotId": "s1-1" }), None, By::Agent, Ctx::default()).await.unwrap();
        match o {
            Outcome::Elsewhere { runs_in, .. } => assert_eq!(runs_in, RunsIn::Browser),
            x => panic!("{x:?}"),
        }
    }

    #[tokio::test]
    async fn 不存在的工具报错_而不是悄悄当成没实现() {
        let tmp = setup();
        let e = dispatch(tmp.path(), "p1", "rm.rf", json!({}), None, By::Agent, Ctx::default()).await.unwrap_err();
        assert_eq!(e.code(), "unknown_tool");
    }

    /// 注册表与实现不能对不上。**真调一遍**，而不是照一张手写清单核 ——
    /// 清单会跟着改，忘了改清单这个守卫就变成摆设（原来那版就是）。
    /// 参数故意给空：会走到各自的校验里报「缺什么」，恰好证明分支是通的；
    /// 没实现的会返回 NotImplemented 或撞上 dispatch 末尾那条兜底错误。
    /// 用 `By::Human` 是为了连 egress 那几个也能走到这一步。
    #[tokio::test]
    async fn 标成已实现的工具真能调到_否则注册表在说谎() {
        let tmp = setup();
        for t in all().into_iter().filter(|t| t.status == Status::Ready) {
            match dispatch(tmp.path(), "p1", t.id, json!({}), None, By::Human, Ctx::default()).await {
                Ok(Outcome::NotImplemented { tool, .. }) => panic!("{tool} 标成 Ready 却说没实现"),
                Err(e) => assert_ne!(e.code(), "unknown_tool", "{}：{e}", t.id),
                Ok(_) => {}
            }
        }
    }

    /// 起个假厂商，验证「工具调用 → 闸门 → 真发 HTTP → 拿回结果」整条链
    async fn fake_image_provider() -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = l.accept().await {
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let body = if req.starts_with("POST") {
                        // 顺带验证 body 真的带上了提示词与 batch
                        assert!(req.contains("\"prompt\""), "提交里没有 prompt");
                        json!({ "data": { "task_id": "t-9" } })
                    } else {
                        json!({ "data": { "status": "succeeded", "urls": ["http://img/1.png"] } })
                    };
                    let sbody = body.to_string();
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        sbody.len(), sbody);
                    let _ = sock.write_all(resp.as_bytes()).await;
                });
            }
        });
        format!("http://{addr}")
    }

    fn gen_ctx<'a>(base: &'a str, model: &'a ModelRef) -> GenCtx<'a> {
        GenCtx {
            model,
            base_url: base,
            api_key: "sk-test",
            api: TaskApi {
                submit_path: "/gen".into(), poll_path: "/gen/{id}".into(),
                id_at: "data.task_id".into(), status_at: "data.status".into(),
                done_when: vec!["succeeded".into()], failed_when: vec!["failed".into()],
                urls_at: "data.urls".into(), error_at: "error.message".into(),
            },
            timeout: std::time::Duration::from_secs(20),
        }
    }

    #[tokio::test]
    async fn 出图整条链跑通_闸门放行后真发请求拿回图() {
        let tmp = setup();
        let base = fake_image_provider().await;
        let m = ModelRef { provider: "volcengine".into(), model: "doubao-seedream".into() };
        let o = dispatch(tmp.path(), "p1", "image.generate",
            json!({ "prompt": "a cat in the rain", "batch": 2 }),
            Some(Risk::Spend), By::Agent, Ctx::task(gen_ctx(&base, &m))).await.unwrap();
        let Outcome::Ok { value } = o else { panic!("{o:?}") };
        assert_eq!(value["urls"][0], "http://img/1.png");
        assert_eq!(value["model"], "doubao-seedream");
    }

    #[tokio::test]
    async fn 出图仍然过闸门_上限没放开时连请求都不发() {
        let tmp = setup();
        let base = fake_image_provider().await;
        let m = ModelRef { provider: "volcengine".into(), model: "x".into() };
        // 出厂上限是 write，出图是 spend
        let o = dispatch(tmp.path(), "p1", "image.generate", json!({ "prompt": "x" }),
            None, By::Agent, Ctx::task(gen_ctx(&base, &m))).await.unwrap();
        assert!(matches!(o, Outcome::NeedsApproval { .. }), "该被挡住，实际 {o:?}");
    }

    #[tokio::test]
    async fn 空提示词不拿去花钱() {
        let tmp = setup();
        let base = fake_image_provider().await;
        let m = ModelRef { provider: "volcengine".into(), model: "x".into() };
        let e = dispatch(tmp.path(), "p1", "image.generate", json!({ "prompt": "   " }),
            Some(Risk::Spend), By::Agent, Ctx::task(gen_ctx(&base, &m))).await.unwrap_err();
        assert!(e.to_string().contains("空的"));
    }

    #[tokio::test]
    async fn 写类工具返回补丁_不落盘_只有一个写入者() {
        let tmp = setup();
        let before = std::fs::read_to_string(tmp.path().join("projects/p1/outline.md")).unwrap();
        let o = dispatch(tmp.path(), "p1", "outline.write", json!({
            "acts": [{ "id": "", "t": "新的一幕", "span": "0:00–1:00",
                       "beats": [{ "id": "", "k": "随便写的", "t": "一场" }] }]
        }), None, By::Agent, Ctx::default()).await.unwrap();
        match o {
            Outcome::Patch { tool, patch } => {
                assert_eq!(tool, "outline.write");
                assert_eq!(patch["t"], "acts");
            }
            x => panic!("{x:?}"),
        }
        // 盘上一个字没动 —— 写入者只有前端那一个
        let after = std::fs::read_to_string(tmp.path().join("projects/p1/outline.md")).unwrap();
        assert_eq!(before, after, "写类工具不该落盘，否则和 autosave 抢着写会丢更新");
    }

    #[tokio::test]
    async fn 场次键由程序重编_不信模型编的() {
        let tmp = setup();
        let Outcome::Patch { patch, .. } = dispatch(tmp.path(), "p1", "outline.write", json!({
            "acts": [{ "id": "", "t": "幕", "span": "",
                       "beats": [{ "id": "", "k": "模型瞎写的", "t": "甲" },
                                 { "id": "", "k": "模型瞎写的", "t": "乙" }] }]
        }), None, By::Agent, Ctx::default()).await.unwrap() else { panic!() };
        // seed 里已有 1 场，所以接着编 2、3
        assert_eq!(patch["acts"][0]["beats"][0]["k"], "场景2");
        assert_eq!(patch["acts"][0]["beats"][1]["k"], "场景3");
    }

    #[tokio::test]
    async fn 镜号不与已有的撞车_撞了会覆盖别人的镜头() {
        let tmp = setup();
        // seed 里已有 s1-1 s1-2 s1-3
        let Outcome::Patch { patch, .. } = dispatch(tmp.path(), "p1", "shot.write", json!({
            "shots": [{ "sceneKey": "场景1", "desc": "新的" },
                      { "sceneKey": "场景1", "desc": "又一个" }]
        }), None, By::Agent, Ctx::default()).await.unwrap() else { panic!() };
        let ids: Vec<&str> = patch["shots"].as_array().unwrap().iter()
            .map(|s| s["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["s1-4", "s1-5"]);
    }

    #[tokio::test]
    async fn 空大纲不算产物_直接报错() {
        let tmp = setup();
        let e = dispatch(tmp.path(), "p1", "outline.write", json!({ "acts": [] }), None, By::Agent, Ctx::default())
            .await.unwrap_err();
        assert!(e.to_string().contains("空大纲"));
    }

    #[tokio::test]
    async fn 锁不存在的资产直接报错_而不是让分镜引一个空的() {
        let tmp = setup();
        let e = dispatch(tmp.path(), "p1", "asset.lock", json!({ "aid": "CHAR-999" }), None, By::Agent, Ctx::default())
            .await.unwrap_err();
        assert!(e.to_string().contains("CHAR-999"));
        // 存在的能锁
        let o = dispatch(tmp.path(), "p1", "asset.lock", json!({ "aid": "CHAR-001" }), None, By::Agent, Ctx::default())
            .await.unwrap();
        assert!(matches!(o, Outcome::Patch { .. }));
    }

    #[tokio::test]
    async fn 写类工具照样过闸门_上限只读时挡住() {
        let tmp = setup();
        let o = dispatch(tmp.path(), "p1", "outline.write",
            json!({ "acts": [{ "id": "", "t": "x", "span": "", "beats": [] }] }),
            Some(Risk::Read), By::Agent, Ctx::default()).await.unwrap();
        assert!(matches!(o, Outcome::NeedsApproval { .. }));
    }

    /* ---- 生成类请求体：这些校验拦的是「白花一次钱」 ---- */

    #[test]
    fn 改图必须说清改成什么样() {
        assert!(gen_body("image.edit", "m", &json!({ "assetId": "c1" })).is_err());
        let e = gen_body("image.edit", "m", &json!({ "assetId": "c1", "instruction": " " })).unwrap_err();
        assert!(e.to_string().contains("随机图"), "{e}");
        let b = gen_body("image.edit", "m", &json!({
            "assetId": "c1", "viewName": "正面", "instruction": "把外套换成红色"
        })).unwrap();
        assert_eq!(b["asset_id"], "c1");
        assert_eq!(b["prompt"], "把外套换成红色");
        assert_eq!(b["view"], "正面");
        assert_eq!(b["n"], 1, "改图一次就一张，不该批量");
    }

    #[test]
    fn 放大倍数只收_2_和_4() {
        for bad in [1, 3, 8] {
            let e = gen_body("image.upscale", "m", &json!({ "assetId": "c1", "scale": bad })).unwrap_err();
            assert!(e.to_string().contains("2 或 4"), "{e}");
        }
        assert_eq!(gen_body("image.upscale", "m", &json!({ "assetId": "c1", "scale": 4 })).unwrap()["scale"], 4);
        // 不给就按 2 —— 放大这件事有个安全的默认值
        assert_eq!(gen_body("image.upscale", "m", &json!({ "assetId": "c1" })).unwrap()["scale"], 2);
    }

    #[test]
    fn 续接时长封顶_10_秒_要更长就分几次接() {
        for bad in [0.0, 0.2, 11.0, 60.0] {
            let e = gen_body("video.extend", "m", &json!({ "shotId": "s1-1", "seconds": bad })).unwrap_err();
            assert!(e.to_string().contains("0.5–10"), "{bad}: {e}");
        }
        let b = gen_body("video.extend", "m", &json!({ "shotId": "s1-1", "seconds": 3 })).unwrap();
        assert_eq!(b["seconds"], 3.0);
    }

    #[test]
    fn 音乐音效要说清要什么_还要给时长() {
        assert!(gen_body("audio.music", "m", &json!({ "seconds": 30 })).is_err());
        assert!(gen_body("audio.music", "m", &json!({ "mood": "温暖" })).is_err(), "没给时长");
        let b = gen_body("audio.music", "m", &json!({ "mood": "温暖", "seconds": 30 })).unwrap();
        assert_eq!(b["prompt"], "温暖");
        let b = gen_body("audio.sfx", "m", &json!({ "desc": "雨声", "seconds": 4 })).unwrap();
        assert_eq!(b["prompt"], "雨声");
    }

    #[test]
    fn 配音不在异步任务那组里() {
        assert!(!GENERATE_TOOLS.contains(&"audio.tts"));
        assert!(gen_body("audio.tts", "m", &json!({ "text": "你好" })).is_err());
    }

    #[test]
    fn 异步任务那组里的每个都拼得出请求体() {
        for t in GENERATE_TOOLS {
            // 给一份「什么都有」的参数，每个工具挑自己要的
            let args = json!({
                "prompt": "a cat", "assetId": "c1", "instruction": "换颜色", "scale": 2,
                "shotId": "s1-1", "seconds": 3, "mood": "温暖", "desc": "雨声", "dur": 2,
            });
            gen_body(t, "m", &args).unwrap_or_else(|e| panic!("{t}: {e}"));
        }
    }

    #[test]
    fn 工具_id_不重复() {
        let mut ids: Vec<&str> = all().iter().map(|t| t.id).collect();
        let n = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), n, "有重复的工具 id");
    }

    #[tokio::test]
    async fn 找内容返回命中在哪儿_不把整份项目倒出来() {
        let tmp = setup();
        let Outcome::Ok { value } = dispatch(tmp.path(), "p1", "project.search",
            json!({ "q": "画猫" }), None, By::Agent, Ctx::default()).await.unwrap() else { panic!() };
        assert_eq!(value["hits"], 1);
        assert_eq!(value["results"][0]["where"], "outline");
        assert_eq!(value["results"][0]["key"], "场景1");
    }

    #[tokio::test]
    async fn 找内容_关键词为空时报错_而不是把全部倒出来() {
        let tmp = setup();
        assert!(dispatch(tmp.path(), "p1", "project.search", json!({ "q": "  " }), None, By::Agent, Ctx::default()).await.is_err());
    }

    #[tokio::test]
    async fn 估花费按价目表算_不让模型自己编一个数() {
        let tmp = setup();
        let Outcome::Ok { value } = dispatch(tmp.path(), "p1", "cost.estimate",
            json!({ "kind": "video", "count": 18 }), None, By::Agent, Ctx::default()).await.unwrap() else { panic!() };
        assert_eq!(value["credits"], 216);   // 12 × 18 × 1
        let Outcome::Ok { value } = dispatch(tmp.path(), "p1", "cost.estimate",
            json!({ "kind": "image", "count": 4, "batch": 2 }), None, By::Agent, Ctx::default()).await.unwrap() else { panic!() };
        assert_eq!(value["credits"], 24);    // 3 × 4 × 2
    }

    #[tokio::test]
    async fn 估花费是只读的_自主模式下不用等人点头() {
        let tmp = setup();
        // 「先报个数」这件事本身不该被闸门挡住，否则报数也要人点头就没意义了
        let o = dispatch(tmp.path(), "p1", "cost.estimate", json!({ "kind": "image", "count": 1 }), None, By::Agent, Ctx::default())
            .await.unwrap();
        assert!(matches!(o, Outcome::Ok { .. }));
    }

    #[test]
    fn 出图出视频配音都归到生成组_界面好分类() {
        for id in ["image.generate", "video.generate", "audio.tts", "audio.music"] {
            assert_eq!(spec(id).unwrap().group, Group::Generate, "{id}");
        }
    }

    #[test]
    fn 查网页归到出本机那一档_查询词会发出去() {
        for id in ["web.search", "web.fetch"] {
            assert_eq!(spec(id).unwrap().risk, Risk::Egress, "{id}");
        }
    }

    #[test]
    fn 每个工具都有描述和_schema_模型才知道怎么用() {
        for t in all() {
            assert!(t.description.len() > 10, "{} 的描述太短，模型判断不了该不该用", t.id);
            assert_eq!(t.schema["type"], "object", "{}", t.id);
            assert!(t.schema.get("properties").is_some(), "{}", t.id);
        }
    }

    #[test]
    fn 没实现的工具都说得出缺什么() {
        for t in all().into_iter().filter(|t| t.status != Status::Ready) {
            assert!(t.blocked_by.is_some_and(|b| b.len() > 8), "{} 没说清缺什么", t.id);
        }
    }

    #[test]
    fn 工具风险与_policy_一致_不在两处各写一份() {
        for t in all() {
            assert_eq!(t.risk, risk_of_tool(t.id), "{}", t.id);
        }
    }
}
