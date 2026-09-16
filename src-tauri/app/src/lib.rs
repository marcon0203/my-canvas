//! IPC 绑定。这一层**不放逻辑** —— 每个命令都薄到只做「转发 + 错误透传」，
//! 真正的实现在 studio-core，那边没有 GUI 依赖，能单独测。
//!
//! 命令面刻意与前端 `src/api/` 的接缝对齐：前端换 transport 时不用改调用方。

use std::collections::HashMap;
use studio_core::Result;
use studio_core::agent::{self, AgentSpec};
use studio_core::config::{AgentConfig, ModelRef, ProviderSetting};
use studio_core::outline::OutlineInput;
use studio_core::run::{self, RunEvent};
use studio_core::shotprompt::PromptInput;
use studio_core::skills::{Root, SkillMeta, SkillStore, SkillWarning};
use studio_core::workspace::{self, Workspace};
use studio_core::project::{self, Bundle, Meta};
use studio_core::store::{self, ConfigFile};
use studio_core::vault::{self, KeyStatus};

/* ---------------- 密钥：明文只进钥匙串，出不来 ---------------- */

#[tauri::command]
fn vault_set(provider: String, key: String) -> Result<KeyStatus> {
    vault::set(&provider, &key)
}

#[tauri::command]
fn vault_clear(provider: String) -> Result<KeyStatus> {
    vault::clear(&provider)
}

#[tauri::command]
fn vault_status(providers: Vec<String>) -> Result<Vec<KeyStatus>> {
    providers.iter().map(|p| vault::status(p)).collect()
}

/* ---------------- 配置：落在工作空间里，不进数据库 ---------------- */

/// 读一份配置。**密钥不在这里** —— 它在系统钥匙串，工作空间整个复制走也带不走。
#[tauri::command]
fn config_load(which: String, workspace: Option<String>) -> Result<serde_json::Value> {
    let file = ConfigFile::parse(&which)
        .ok_or_else(|| studio_core::Error::Store(format!("没有这份配置：{which}")))?;
    let w = ws(workspace.as_deref())?;
    store::read_json(&store::config_path(&w.root, file))
}

#[tauri::command]
fn config_save(
    which: String,
    value: serde_json::Value,
    workspace: Option<String>,
) -> Result<()> {
    let file = ConfigFile::parse(&which)
        .ok_or_else(|| studio_core::Error::Store(format!("没有这份配置：{which}")))?;
    let w = ws(workspace.as_deref())?;
    w.ensure()?;
    store::write_json(&store::config_path(&w.root, file), &value)
}

/* ---------------- 项目：目录 + Markdown + JSON ---------------- */

#[tauri::command]
fn project_list(workspace: Option<String>) -> Result<Vec<Meta>> {
    Ok(project::list(&ws(workspace.as_deref())?.root))
}

#[tauri::command]
fn project_load(id: String, workspace: Option<String>) -> Result<Bundle> {
    project::load(&ws(workspace.as_deref())?.root, &id)
}

#[tauri::command]
fn project_save(bundle: Bundle, workspace: Option<String>) -> Result<()> {
    let w = ws(workspace.as_deref())?;
    w.ensure()?;
    std::fs::create_dir_all(project::projects_dir(&w.root))
        .map_err(|e| studio_core::Error::Store(format!("建不了 projects 目录：{e}")))?;
    project::save(&w.root, &bundle)
}

#[tauri::command]
fn project_delete(id: String, workspace: Option<String>) -> Result<()> {
    project::delete(&ws(workspace.as_deref())?.root, &id)
}

/* ---------------- Skill ---------------- */

/// 解析工作空间。路径由前端传进来（它负责持久化），这里只校验。
fn ws(configured: Option<&str>) -> Result<Workspace> {
    workspace::resolve(configured, &workspace::home()?)
}

/// 扫描 skill 目录，**只解析 frontmatter**（第 1 级）。
///
/// 顺序就是覆盖顺序：**工作空间里的盖过内置的** —— 用户放一个同名目录
/// 就能改掉内置行为，这是 skill 相对硬编码的意义所在。
fn roots(app: &tauri::AppHandle, configured: Option<&str>) -> Vec<Root> {
    use tauri::Manager;
    let mut out = Vec::new();
    if let Ok(p) = app.path().resolve("skills", tauri::path::BaseDirectory::Resource) {
        out.push(Root { name: "内置".into(), path: p });
    }
    if let Ok(w) = ws(configured) {
        out.push(Root { name: "工作空间".into(), path: w.skills() });
    }
    out
}

/* ---------------- 工作空间 ---------------- */

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInfo {
    root: String,
    source: workspace::Source,
    /// 默认路径，界面上要能说明「不填就是这个」
    default_root: String,
    exists: bool,
    writable: bool,
    /// 子目录清单：名字、说明、现在是否真的在用、是否已经建出来
    subdirs: Vec<SubdirInfo>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SubdirInfo {
    name: String,
    desc: String,
    used: bool,
    exists: bool,
}

fn info_of(w: &Workspace, home: &std::path::Path) -> WorkspaceInfo {
    WorkspaceInfo {
        root: w.root.display().to_string(),
        source: w.source,
        default_root: home.join(workspace::DEFAULT_DIR).display().to_string(),
        exists: w.root.is_dir(),
        writable: w.writable(),
        subdirs: workspace::SUBDIRS
            .iter()
            .map(|(name, desc, used)| SubdirInfo {
                name: (*name).into(),
                desc: (*desc).into(),
                used: *used,
                exists: w.root.join(name).is_dir(),
            })
            .collect(),
    }
}

/// 当前工作空间的情况。界面打开设置时问一次。
#[tauri::command]
fn workspace_info(configured: Option<String>) -> Result<WorkspaceInfo> {
    let home = workspace::home()?;
    let w = workspace::resolve(configured.as_deref(), &home)?;
    Ok(info_of(&w, &home))
}

/// 校验一个用户填的路径，并把目录建出来。
///
/// **只建不搬**：换工作空间不会把旧目录里的东西搬过来，也不会删旧的。
/// 替用户搬数据是在拿他的东西冒险，那件事该他自己决定。
#[tauri::command]
fn workspace_prepare(path: String) -> Result<WorkspaceInfo> {
    let home = workspace::home()?;
    let root = workspace::validate(&path, &home)?;
    let w = Workspace { root, source: workspace::Source::User };
    w.ensure()?;
    Ok(info_of(&w, &home))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillList {
    skills: Vec<SkillMeta>,
    warnings: Vec<SkillWarning>,
}

/// 列出装了哪些 skill。**不含正文** —— 正文是第 2 级，界面要看再单独要。
#[tauri::command]
fn skills_list(app: tauri::AppHandle, workspace: Option<String>) -> SkillList {
    let st = SkillStore::scan(&roots(&app, workspace.as_deref()));
    SkillList { skills: st.all().to_vec(), warnings: st.warnings().to_vec() }
}

/// 读某个 skill 的正文（第 2 级）。界面上「看看它到底写了什么」用这个。
#[tauri::command]
fn skill_body(app: tauri::AppHandle, name: String, workspace: Option<String>) -> Result<String> {
    SkillStore::scan(&roots(&app, workspace.as_deref())).body(&name)
}

/// 读 skill 里的附件（第 3 级）。路径穿越由 core 挡，这层只转发。
#[tauri::command]
fn skill_resource(
    app: tauri::AppHandle,
    name: String,
    rel: String,
    workspace: Option<String>,
) -> Result<String> {
    SkillStore::scan(&roots(&app, workspace.as_deref())).resource(&name, &rel)
}

/* ---------------- Agent ---------------- */

/// 只解析不跑 —— 让设置界面能在「还没花钱」的时候就把配置问题暴露出来。
#[tauri::command]
fn agent_resolve(
    cfg: AgentConfig,
    fallback_preamble: String,
    globals: HashMap<String, ModelRef>,
    providers: HashMap<String, ProviderSetting>,
) -> Result<AgentSpec> {
    agent::resolve(&cfg, &fallback_preamble, &globals, &providers)
}

/// 起草大纲。
///
/// 这里**只做转发**：事件类型与编排都在 studio_core::run —— 那边能编译能测，
/// 而这一层在没有 GUI 系统库的机器上编译不了，放逻辑等于没被检查过。
#[tauri::command]
async fn agent_outline_draft(
    cfg: AgentConfig,
    fallback_preamble: String,
    globals: HashMap<String, ModelRef>,
    providers: HashMap<String, ProviderSetting>,
    input: OutlineInput,
    skill: Option<String>,
    workspace: Option<String>,
    on_event: tauri::ipc::Channel<RunEvent>,
    app: tauri::AppHandle,
) {
    let skills = SkillStore::scan(&roots(&app, workspace.as_deref()));
    run::outline_draft(
        run::OutlineRun {
            cfg: &cfg,
            fallback_preamble: &fallback_preamble,
            globals: &globals,
            providers: &providers,
            input: &input,
            skills: &skills,
            skill: skill.as_deref(),
        },
        move |e: RunEvent| {
            let _ = on_event.send(e);
        },
        run::SystemKeys,
    )
    .await;
}

/// 补写提示词。与起草大纲同一套编排，只换输入与产物。
#[tauri::command]
async fn agent_shots_prompt(
    cfg: AgentConfig,
    fallback_preamble: String,
    globals: HashMap<String, ModelRef>,
    providers: HashMap<String, ProviderSetting>,
    input: PromptInput,
    skill: Option<String>,
    workspace: Option<String>,
    on_event: tauri::ipc::Channel<RunEvent>,
    app: tauri::AppHandle,
) {
    let skills = SkillStore::scan(&roots(&app, workspace.as_deref()));
    run::shots_prompt(
        run::PromptRun {
            cfg: &cfg,
            fallback_preamble: &fallback_preamble,
            globals: &globals,
            providers: &providers,
            input: &input,
            skills: &skills,
            skill: skill.as_deref(),
        },
        move |e: RunEvent| {
            let _ = on_event.send(e);
        },
        run::SystemKeys,
    )
    .await;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            vault_set,
            vault_clear,
            vault_status,
            agent_resolve,
            agent_outline_draft,
            agent_shots_prompt,
            skills_list,
            skill_body,
            skill_resource,
            workspace_info,
            workspace_prepare,
            config_load,
            config_save,
            project_list,
            project_load,
            project_save,
            project_delete,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
