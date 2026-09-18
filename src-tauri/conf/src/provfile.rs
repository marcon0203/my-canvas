//! 一家供应商一个 YAML 文件。
//!
//! ```text
//! <workspace>/providers/
//! ├── deepseek.yaml        文件名就是 id
//! ├── volcengine.yaml
//! └── custom.yaml          自建网关/Ollama 走这一家
//! ```
//!
//! ```yaml
//! baseUrl: https://api.deepseek.com
//! apikey: sk-xxxxxxxxxxxxxxxx
//! text:
//!   model-list:
//!     - deepseek-chat                  # 只写 id
//!     - id: deepseek-reasoner          # 要补别的字段就展开写
//!       name: R1（思考）
//!       context: 65536
//! image:
//!   model-list: []
//! ```
//!
//! # 为什么是这个形状
//!
//! **一家一个文件。** 接入一家 = 多一个文件，删一家 = 删文件。和 skill 那套
//! 一致（skill 是磁盘上的一个目录，不是代码里的枚举）。原来是一个大
//! `providers.json`，加一家要去改那份文件里的一个键。
//!
//! **这一层不认识「支持哪几家」。** 它只管读写文件，id 合法不合法（能不能当
//! 文件名）它查，是不是内置目录里那几家它不查 —— 那是上层的事。
//! 目前界面只显示目录里有的那几家，一个陌生 id 的文件会被如实报成
//! 「不认识这家」而不是让设置页崩掉；「丢个文件进去就是全新一家」还没做。
//!
//! **YAML 不是 JSON。** 这份东西人要直接拿编辑器改 —— 注释、不用引号、
//! 不用管尾逗号。项目里其他给人读改的东西（大纲、剧本）也是这个理由走
//! Markdown 而不是 JSON。
//!
//! **模型按 modality 分组，不是每项写 `modality:`。** `text` / `image` /
//! `video` / `audio` 决定 Rust 侧走哪个适配器 —— 文本走 chat/completions，
//! 图片视频走「提交拿 task_id 再轮询」那套。分组写法让它不可能忘写，
//! 也不可能写错成一个不认识的值。
//!
//! # api key 就在这个文件里
//!
//! 原来在系统钥匙串。代价是**每次点进设置页都弹一次系统密码**，配了几家弹几次：
//! 界面要显示尾号，而 keyring 那条路上没有「只问在不在、不读内容」的接口，
//! 于是为了算四个字符把每一把明文都读了一遍，而读钥匙串条目就会触发系统授权框。
//! 一个本地创作工具不该付这个代价 —— Claude Code、Codex 也都是本地文件。
//!
//! **文件权限 0600**，只有当前用户能读。工作空间会被放进网盘目录这件事是知道的，
//! 这是明确选择的取舍：key 跟着工作空间走，换机器拷过去就能用。

use studio_error::{Error, Result};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 模型清单里的一项。
///
/// 两种写法都认：`- deepseek-chat` 只给 id，`- {id: …, name: …}` 补别的字段。
/// **保留用户写的那种形式** —— 界面上改一处就把他手写的 `- deepseek-chat`
/// 重排成三行 map，是在动他没让你动的东西。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum Model {
    /// 只写了个 id
    Id(String),
    Full(ModelFull),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFull {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 上下文窗口（token），文本模型才有
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// 这个模型支持什么（`refImage` / `stream` / `tools` …）。
    ///
    /// **不写 ≠ 都不支持**：不写的时候前端按 modality 给一组默认值 ——
    /// 手写这份文件的人不该为了让检查过去背这几个键名。
    /// 写成 `caps: []` 才是「明确都不支持」。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caps: Option<Vec<String>>,
}

impl Model {
    pub fn id(&self) -> &str {
        match self {
            Model::Id(s) => s,
            Model::Full(m) => &m.id,
        }
    }
    /// 显示名。没写就拿 id 顶上 —— 界面上不能是空的
    pub fn name(&self) -> &str {
        match self {
            Model::Id(s) => s,
            Model::Full(m) => m.name.as_deref().filter(|s| !s.is_empty()).unwrap_or(&m.id),
        }
    }
    pub fn context(&self) -> Option<u32> {
        match self {
            Model::Id(_) => None,
            Model::Full(m) => m.context,
        }
    }
    pub fn note(&self) -> Option<&str> {
        match self {
            Model::Id(_) => None,
            Model::Full(m) => m.note.as_deref(),
        }
    }
    pub fn caps(&self) -> Option<&[String]> {
        match self {
            Model::Id(_) => None,
            Model::Full(m) => m.caps.as_deref(),
        }
    }
}

/// 一个 modality 下的模型。单独一层是为了 `model-list` 这个键名 ——
/// 写成 `text: [a, b]` 的话，以后这一组要加别的字段（限流、单价）就没地方放
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Group {
    #[serde(rename = "model-list", default, skip_serializing_if = "Vec::is_empty")]
    pub model_list: Vec<Model>,
}

impl Group {
    pub fn is_empty(&self) -> bool {
        self.model_list.is_empty()
    }
}

fn yes() -> bool {
    true
}

/// 一家供应商的配置。
///
/// 除了 `enabled`，**所有字段都可以不写** —— 一个只有 `apikey:` 一行的文件是
/// 合法的（端点用内置目录里那家的默认值）。手写这份东西的人不该被迫填一堆
/// 他不关心的键。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvFile {
    /// 改过的端点。不写就用内置目录里那家的默认值；自定义端点必须写
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// api key。**明文，靠文件权限 0600 保护**，见模块说明
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apikey: Option<String>,
    /// 显示名。内置那几家不用写（目录里有）；自己接的一家写了界面上才好看
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 停用的那家不出现在模型选择里。不写 = 启用
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Group::is_empty")]
    pub text: Group,
    #[serde(default, skip_serializing_if = "Group::is_empty")]
    pub image: Group,
    #[serde(default, skip_serializing_if = "Group::is_empty")]
    pub video: Group,
    #[serde(default, skip_serializing_if = "Group::is_empty")]
    pub audio: Group,
}

impl Default for ProvFile {
    fn default() -> Self {
        Self {
            base_url: None,
            apikey: None,
            name: None,
            enabled: true,
            text: Group::default(),
            image: Group::default(),
            video: Group::default(),
            audio: Group::default(),
        }
    }
}

/// 四种 modality 的名字。列在一处，界面和遍历都照着它
pub const MODALITIES: [&str; 4] = ["text", "image", "video", "audio"];

impl ProvFile {
    pub fn group(&self, modality: &str) -> Option<&Group> {
        match modality {
            "text" => Some(&self.text),
            "image" => Some(&self.image),
            "video" => Some(&self.video),
            "audio" => Some(&self.audio),
            _ => None,
        }
    }

    pub fn group_mut(&mut self, modality: &str) -> Option<&mut Group> {
        match modality {
            "text" => Some(&mut self.text),
            "image" => Some(&mut self.image),
            "video" => Some(&mut self.video),
            "audio" => Some(&mut self.audio),
            _ => None,
        }
    }

    pub fn has_key(&self) -> bool {
        self.apikey.as_deref().is_some_and(|k| !k.trim().is_empty())
    }
}

/* ---------------- 落盘 ---------------- */

/// 放在工作空间下的哪个目录
pub const DIR: &str = "providers";

/// 文件后缀。只认 `.yaml` 一种 —— 同时认 `.yml` 的话，一个目录里可能出现
/// `deepseek.yaml` 和 `deepseek.yml` 两份，而「哪份说话算数」没有好答案
pub const EXT: &str = "yaml";

pub fn dir(root: &Path) -> PathBuf {
    root.join(DIR)
}

/// id 是不是能当文件名。
///
/// 路径分隔符和 `..` 必须挡住：这个 id 一路来自 IPC 参数，
/// 放过去就是「往工作空间外面写文件」。空的也挡 —— 那会写成一个只有后缀的文件。
pub fn valid_id(id: &str) -> bool {
    let t = id.trim();
    !t.is_empty()
        && t == id
        && t != "."
        && t != ".."
        && !t.contains('/')
        && !t.contains('\\')
        && !t.contains('\0')
}

fn check_id(id: &str) -> Result<()> {
    if valid_id(id) {
        Ok(())
    } else {
        Err(Error::UnknownProvider(id.into()))
    }
}

pub fn path(root: &Path, id: &str) -> Result<PathBuf> {
    check_id(id)?;
    Ok(dir(root).join(format!("{id}.{EXT}")))
}

/// 读一家。**文件不存在返回 None**，不是错误 —— 那就是「这家还没接入」
pub fn read(root: &Path, id: &str) -> Result<Option<ProvFile>> {
    let p = path(root, id)?;
    let raw = match std::fs::read_to_string(&p) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(Error::Store(format!("读不了 {}：{e}", p.display()))),
    };
    // 空文件当成「全默认」：手动 `touch` 出来一个是常事，
    // 报个「格式不对」会让人以为自己写错了
    if raw.trim().is_empty() {
        return Ok(Some(ProvFile::default()));
    }
    serde_yaml_ng::from_str(&raw)
        .map(Some)
        .map_err(|e| Error::Store(format!("{} 格式不对：{e}", p.display())))
}

/// 列出接入过的所有家，按 id 排序。
///
/// **一份坏文件不该让整页打不开**：解析失败的那家单独报出来，其余照常返回。
/// 全都读不出来才是错误。
pub struct Listing {
    pub files: BTreeMap<String, ProvFile>,
    /// (id, 为什么读不了)。界面上如实说哪份文件坏了
    pub bad: Vec<(String, String)>,
}

pub fn list(root: &Path) -> Result<Listing> {
    let d = dir(root);
    let mut files = BTreeMap::new();
    let mut bad = Vec::new();
    let rd = match std::fs::read_dir(&d) {
        Ok(rd) => rd,
        // 目录还没建 = 一家都没接入，不是错误
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Listing { files, bad }),
        Err(e) => return Err(Error::Store(format!("读不了 {}：{e}", d.display()))),
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.extension().and_then(|s| s.to_str()) != Some(EXT) {
            continue;
        }
        let Some(id) = p.file_stem().and_then(|s| s.to_str()) else { continue };
        if !valid_id(id) {
            continue;
        }
        match read(root, id) {
            Ok(Some(f)) => {
                files.insert(id.to_string(), f);
            }
            Ok(None) => {}
            Err(e) => bad.push((id.to_string(), e.to_string())),
        }
    }
    Ok(Listing { files, bad })
}

/// 写一家，权限 0600。
///
/// **不复用 `store::write_atomic`** —— 它那个临时文件是按默认权限（通常 0644）
/// 建的，哪怕最终文件是 0600，中间那一瞬 apikey 是全局可读的。
/// 这里从 `OpenOptions` 就带上 0600，再 rename。
///
/// Windows 上没有这套权限位，`mode` 不起作用；那边靠用户目录本身的 ACL。
pub fn save(root: &Path, id: &str, file: &ProvFile) -> Result<()> {
    let p = path(root, id)?;
    let d = dir(root);
    std::fs::create_dir_all(&d)
        .map_err(|e| Error::Store(format!("建不了 {}：{e}", d.display())))?;

    let body = serde_yaml_ng::to_string(file)
        .map_err(|e| Error::Store(format!("序列化 {id} 失败：{e}")))?;
    let tmp = p.with_extension(format!("{EXT}.tmp"));

    let mut opt = std::fs::OpenOptions::new();
    opt.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opt.mode(0o600);
    }
    {
        use std::io::Write;
        let mut f = opt
            .open(&tmp)
            .map_err(|e| Error::Store(format!("写不了 {}：{e}", tmp.display())))?;
        f.write_all(body.as_bytes())
            .and_then(|()| f.sync_all())
            .map_err(|e| Error::Store(format!("写不了 {}：{e}", tmp.display())))?;
    }
    // 已经存在的文件权限可能是早先版本或用户自己建的，rename 之前再压一次
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        Error::Store(format!("落盘 {} 失败：{e}", p.display()))
    })
}

/// 删一家 = 删文件。**文件本来就没有不算错** —— 结果是一样的
pub fn remove(root: &Path, id: &str) -> Result<()> {
    let p = path(root, id)?;
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(Error::Store(format!("删不了 {}：{e}", p.display()))),
    }
}

/// 取某一家的 apikey。**这是明文的出口**，调用点一眼可数
pub fn apikey(root: &Path, id: &str) -> Result<String> {
    read(root, id)?
        .and_then(|f| f.apikey)
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| Error::NoKey(id.into()))
}

/* ---------------- 进出 IPC 的两个形状 ---------------- */

/// 送去前端的那份。**没有 apikey 字段** —— 这是刻意的。
///
/// 明文只有一个方向能走：用户刚打的那串经 `Patch` 进来。出去的只有
/// 「配没配」和脱敏尾号。少一个字段，就少一条「哪天有人顺手把它带出去」的路。
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    pub enabled: bool,
    pub has_key: bool,
    /// 脱敏尾号，给人确认「是不是那把 key」
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_hint: Option<String>,
    /// 四种 modality 各一串。**统一成展开形式** —— 界面要 id 也要名字，
    /// 让它自己去分辨「这项是字符串还是对象」没有意义
    pub text: Vec<ModelFull>,
    pub image: Vec<ModelFull>,
    pub video: Vec<ModelFull>,
    pub audio: Vec<ModelFull>,
}

/// 尾号提示。短 key 全遮 —— 否则等于把 key 印在界面上
pub fn hint_of(key: &str) -> String {
    let n = key.chars().count();
    if n <= 8 {
        "••••".into()
    } else {
        format!("••••{}", key.chars().skip(n - 4).collect::<String>())
    }
}

fn expand(g: &Group) -> Vec<ModelFull> {
    g.model_list
        .iter()
        .map(|m| ModelFull {
            id: m.id().to_string(),
            name: Some(m.name().to_string()),
            context: m.context(),
            note: m.note().map(str::to_string),
            caps: m.caps().map(|c| c.to_vec()),
        })
        .collect()
}

impl View {
    pub fn of(id: &str, f: &ProvFile) -> Self {
        Self {
            id: id.to_string(),
            name: f.name.clone(),
            base_url: f.base_url.clone(),
            enabled: f.enabled,
            has_key: f.has_key(),
            key_hint: f.apikey.as_deref().map(str::trim).filter(|k| !k.is_empty()).map(hint_of),
            text: expand(&f.text),
            image: expand(&f.image),
            video: expand(&f.video),
            audio: expand(&f.audio),
        }
    }
}

/// 前端要改什么。**`None` = 这一项不动** —— 界面上改一个端点不该顺带
/// 把模型清单和 key 一起重写一遍。
///
/// 要清掉一项就给空串：`baseUrl: ""` 是「用回内置默认」，
/// `apikey: ""` 是「把这把 key 删了」。
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Patch {
    pub base_url: Option<String>,
    /// 明文**只走这个方向**。出去的那份（`View`）没有这个字段
    pub apikey: Option<String>,
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub text: Option<Vec<ModelFull>>,
    pub image: Option<Vec<ModelFull>>,
    pub video: Option<Vec<ModelFull>>,
    pub audio: Option<Vec<ModelFull>>,
}

/// 只有 id、别的都没填 → 存回去写成简写那种。
///
/// 这条规则让「界面上改了一下，手写的 `- deepseek-chat` 变成三行 map」
/// 不会发生。代价是反过来：手写的 `- id: deepseek-chat`（展开但只有 id）
/// 会被收成 `- deepseek-chat`。那是等价的写法，收一下比涨一倍好。
fn shrink(m: ModelFull) -> Model {
    let bare = m.context.is_none()
        && m.caps.is_none()
        && m.note.as_deref().is_none_or(str::is_empty)
        && m.name.as_deref().is_none_or(|n| n.is_empty() || n == m.id);
    if bare { Model::Id(m.id) } else { Model::Full(m) }
}

fn set_group(g: &mut Group, list: Vec<ModelFull>) {
    g.model_list = list.into_iter().map(shrink).collect();
}

/// 空串当成「清掉这一项」，其余原样（两头空白剃掉）
fn clean(v: String) -> Option<String> {
    let t = v.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// 改一家：读 → 按 patch 改 → 写回。
///
/// **读改写而不是整份覆盖**：patch 里没给的字段保持磁盘上原样，
/// 包括用户手写的简写形式，以及这一轮不涉及的那把 key。
///
/// 文件还不存在时从默认值开始 —— 「接入一家」和「改一家」是同一条路。
pub fn apply(root: &Path, id: &str, patch: &Patch) -> Result<ProvFile> {
    let mut f = read(root, id)?.unwrap_or_default();
    if let Some(v) = patch.base_url.clone() {
        f.base_url = clean(v);
    }
    if let Some(v) = patch.apikey.clone() {
        f.apikey = clean(v);
    }
    if let Some(v) = patch.name.clone() {
        f.name = clean(v);
    }
    if let Some(v) = patch.enabled {
        f.enabled = v;
    }
    for (m, list) in [
        ("text", &patch.text),
        ("image", &patch.image),
        ("video", &patch.video),
        ("audio", &patch.audio),
    ] {
        if let Some(l) = list
            && let Some(g) = f.group_mut(m)
        {
            set_group(g, l.clone());
        }
    }
    save(root, id, &f)?;
    Ok(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::TempDir::new().unwrap()
    }

    fn write_raw(root: &Path, id: &str, body: &str) {
        std::fs::create_dir_all(dir(root)).unwrap();
        std::fs::write(dir(root).join(format!("{id}.yaml")), body).unwrap();
    }

    /// 用户手写的那一份 —— 这是契约，照着模块开头那段例子
    const SAMPLE: &str = "\
baseUrl: https://api.deepseek.com
apikey: sk-1234567890ab
text:
  model-list:
    - deepseek-chat
    - id: deepseek-reasoner
      name: R1（思考）
      context: 65536
image:
  model-list: []
";

    #[test]
    fn 手写的那份能解析_两种写法都认() {
        let t = tmp();
        write_raw(t.path(), "deepseek", SAMPLE);
        let f = read(t.path(), "deepseek").unwrap().unwrap();

        assert_eq!(f.base_url.as_deref(), Some("https://api.deepseek.com"));
        assert_eq!(f.apikey.as_deref(), Some("sk-1234567890ab"));
        assert!(f.enabled, "不写 enabled 就是启用");

        let m = &f.text.model_list;
        assert_eq!(m.len(), 2);
        // 只写 id 那种：名字拿 id 顶上，界面上不会是空的
        assert_eq!(m[0].id(), "deepseek-chat");
        assert_eq!(m[0].name(), "deepseek-chat");
        assert_eq!(m[0].context(), None);
        // 展开写那种
        assert_eq!(m[1].id(), "deepseek-reasoner");
        assert_eq!(m[1].name(), "R1（思考）");
        assert_eq!(m[1].context(), Some(65536));

        assert!(f.image.is_empty());
    }

    #[test]
    fn 只写一行_apikey_也是合法的() {
        let t = tmp();
        write_raw(t.path(), "deepseek", "apikey: sk-x\n");
        let f = read(t.path(), "deepseek").unwrap().unwrap();
        assert!(f.has_key());
        assert_eq!(f.base_url, None, "端点没写就该是空，由内置目录兜底");
        assert!(f.enabled);
    }

    /// **用户手写的那种简写要保住。**
    ///
    /// 界面上改一处（比如换个 key）就把他写的 `- deepseek-chat` 重排成三行 map，
    /// 是在动他没让你动的东西。所以 Model 是个 untagged 枚举而不是统一结构。
    #[test]
    fn 存回去不把简写重排成三行() {
        let t = tmp();
        write_raw(t.path(), "deepseek", SAMPLE);
        let mut f = read(t.path(), "deepseek").unwrap().unwrap();
        f.apikey = Some("sk-换过了".into());
        save(t.path(), "deepseek", &f).unwrap();

        let raw = std::fs::read_to_string(path(t.path(), "deepseek").unwrap()).unwrap();
        assert!(raw.contains("- deepseek-chat"), "简写被重排了：\n{raw}");
        assert!(raw.contains("sk-换过了"));
        // 展开写的那个还是展开的
        assert!(raw.contains("deepseek-reasoner"));
        assert!(raw.contains("65536"));
    }

    #[test]
    fn 没写的字段不写回文件_不给人塞一堆_null() {
        let t = tmp();
        let f = ProvFile { apikey: Some("sk-x".into()), ..Default::default() };
        save(t.path(), "mine", &f).unwrap();
        let raw = std::fs::read_to_string(path(t.path(), "mine").unwrap()).unwrap();
        assert!(!raw.contains("null"), "不该有 null：\n{raw}");
        assert!(!raw.contains("image"), "空的那几组不该写出来：\n{raw}");
        assert!(raw.contains("apikey: sk-x"));
    }

    #[test]
    fn 读写往返() {
        let t = tmp();
        assert!(read(t.path(), "deepseek").unwrap().is_none(), "没接入过就是 None");
        assert!(matches!(apikey(t.path(), "deepseek"), Err(Error::NoKey(_))));

        let mut f = ProvFile { apikey: Some("sk-1234567890ab".into()), ..Default::default() };
        f.text.model_list.push(Model::Id("deepseek-chat".into()));
        save(t.path(), "deepseek", &f).unwrap();

        assert_eq!(read(t.path(), "deepseek").unwrap().unwrap(), f);
        assert_eq!(apikey(t.path(), "deepseek").unwrap(), "sk-1234567890ab");

        remove(t.path(), "deepseek").unwrap();
        assert!(read(t.path(), "deepseek").unwrap().is_none());
        // 删一个本来就没有的不报错 —— 结果是一样的
        assert!(remove(t.path(), "deepseek").is_ok());
    }

    #[test]
    fn 空的_apikey_算没配_不是配了个空串() {
        let t = tmp();
        write_raw(t.path(), "a", "apikey: ''\n");
        assert!(!read(t.path(), "a").unwrap().unwrap().has_key());
        write_raw(t.path(), "b", "apikey: '   '\n");
        assert!(matches!(apikey(t.path(), "b"), Err(Error::NoKey(_))));
    }

    #[test]
    fn 列出目录里的所有家_按_id_排序() {
        let t = tmp();
        assert_eq!(list(t.path()).unwrap().files.len(), 0, "目录还没建不是错误");

        for id in ["volcengine", "deepseek", "我的网关"] {
            save(t.path(), id, &ProvFile::default()).unwrap();
        }
        // 不是 .yaml 的不算
        write_raw(t.path(), "笔记", "随手记的");
        std::fs::rename(
            dir(t.path()).join("笔记.yaml"),
            dir(t.path()).join("笔记.txt"),
        )
        .unwrap();

        let got = list(t.path()).unwrap();
        assert_eq!(
            got.files.keys().cloned().collect::<Vec<_>>(),
            ["deepseek", "volcengine", "我的网关"]
        );
        assert!(got.bad.is_empty());
    }

    /// **一份坏文件不该让整页打不开。**
    ///
    /// 手写 YAML 写坏是常事（缩进差一格）。那时候如果整个 list 报错，
    /// 界面上就是「设置页打不开」，而人根本不知道是哪份文件。
    #[test]
    fn 一份写坏了_其余照常列出_坏的单独报() {
        let t = tmp();
        save(t.path(), "deepseek", &ProvFile { apikey: Some("sk-x".into()), ..Default::default() })
            .unwrap();
        write_raw(t.path(), "坏的", "text:\n  model-list: 这不是个列表\n   乱缩进");

        let got = list(t.path()).unwrap();
        assert!(got.files.contains_key("deepseek"), "好的那份还得在");
        assert_eq!(got.bad.len(), 1);
        assert_eq!(got.bad[0].0, "坏的");
        assert!(got.bad[0].1.contains("坏的.yaml"), "错误里要说清是哪份文件");
    }

    #[test]
    fn 空文件当成全默认_不报格式错() {
        let t = tmp();
        write_raw(t.path(), "a", "");
        write_raw(t.path(), "b", "  \n\n");
        for id in ["a", "b"] {
            let f = read(t.path(), id).unwrap().unwrap();
            assert_eq!(f, ProvFile::default(), "{id}");
        }
    }

    /// id 一路来自 IPC 参数。放过路径分隔符就是「往工作空间外面写文件」
    #[test]
    fn id_里带路径的一律挡住() {
        let t = tmp();
        for bad in ["../别处", "a/b", "a\\b", "..", ".", "", " ", " a"] {
            assert!(!valid_id(bad), "该挡住：{bad:?}");
            assert!(path(t.path(), bad).is_err(), "该挡住：{bad:?}");
            assert!(save(t.path(), bad, &ProvFile::default()).is_err(), "该挡住：{bad:?}");
            assert!(remove(t.path(), bad).is_err(), "该挡住：{bad:?}");
        }
        // 中文、连字符、点都是正常文件名
        for ok in ["deepseek", "我的网关", "my-gw", "gw.v2"] {
            assert!(valid_id(ok), "该放过：{ok}");
        }
    }

    /// apikey 是明文，文件权限必须 0600。
    ///
    /// **临时文件也要**：按默认权限建临时文件的话，哪怕最终文件是 0600，
    /// 中间那一瞬 key 是全局可读的。
    #[cfg(unix)]
    #[test]
    fn 文件权限是_0600_旧的_0644_也会被压回去() {
        use std::os::unix::fs::PermissionsExt;
        let t = tmp();
        write_raw(t.path(), "deepseek", "apikey: sk-x\n");
        let p = path(t.path(), "deepseek").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();

        let f = read(t.path(), "deepseek").unwrap().unwrap();
        save(t.path(), "deepseek", &f).unwrap();

        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "权限是 {mode:o}");
        assert!(!dir(t.path()).join("deepseek.yaml.tmp").exists(), "临时文件不该留下");
    }

    /* ---------------- 进出 IPC 的两个形状 ---------------- */

    /// **送去前端的那份不能带明文。** 这是整套设计的底线，钉成测试
    #[test]
    fn 送去前端的那份没有_apikey_字段() {
        let f = ProvFile {
            apikey: Some("sk-1234567890ab".into()),
            base_url: Some("https://x".into()),
            ..Default::default()
        };
        let v = serde_json::to_value(View::of("deepseek", &f)).unwrap();

        assert!(v.get("apikey").is_none(), "View 绝不能带明文");
        assert!(v.get("key").is_none());
        // 整段序列化里都不该出现那串明文 —— 换个字段名藏进去也算漏
        assert!(!v.to_string().contains("sk-1234567890ab"), "明文漏进 View 了：{v}");
        assert_eq!(v["hasKey"], true);
        assert_eq!(v["keyHint"], "••••90ab");
    }

    #[test]
    fn 尾号只露最后四位_短密钥全遮() {
        assert_eq!(hint_of("sk-1234567890ab"), "••••90ab");
        assert_eq!(hint_of("short"), "••••");
        assert_eq!(hint_of(""), "••••");
    }

    #[test]
    fn 没配_key_的那家没有尾号_而不是一串点() {
        let v = View::of("a", &ProvFile::default());
        assert!(!v.has_key);
        assert_eq!(v.key_hint, None);
    }

    #[test]
    fn 送去前端的模型统一展开_名字没写就拿_id_顶上() {
        let t = tmp();
        write_raw(t.path(), "deepseek", SAMPLE);
        let f = read(t.path(), "deepseek").unwrap().unwrap();
        let v = View::of("deepseek", &f);
        assert_eq!(v.text[0].id, "deepseek-chat");
        assert_eq!(v.text[0].name.as_deref(), Some("deepseek-chat"), "界面上不能是空的");
        assert_eq!(v.text[1].name.as_deref(), Some("R1（思考）"));
        assert_eq!(v.text[1].context, Some(65536));
    }

    /// **patch 里没给的字段保持磁盘上原样。**
    ///
    /// 界面上改一个端点不该顺带把模型清单和 key 一起重写 —— 那种 bug 的症状是
    /// 「我改了个地址，key 没了」，而且很难想到是这儿。
    #[test]
    fn 改一项不动别的项() {
        let t = tmp();
        write_raw(t.path(), "deepseek", SAMPLE);

        let f = apply(t.path(), "deepseek", &Patch {
            base_url: Some("https://gw.internal".into()),
            ..Default::default()
        })
        .unwrap();

        assert_eq!(f.base_url.as_deref(), Some("https://gw.internal"));
        assert_eq!(f.apikey.as_deref(), Some("sk-1234567890ab"), "key 不该被动");
        assert_eq!(f.text.model_list.len(), 2, "模型清单不该被动");
        // 手写的简写形式也还在
        let raw = std::fs::read_to_string(path(t.path(), "deepseek").unwrap()).unwrap();
        assert!(raw.contains("- deepseek-chat"), "简写被重排了：\n{raw}");
    }

    #[test]
    fn 文件还不存在时_接入一家和改一家是同一条路() {
        let t = tmp();
        let f = apply(t.path(), "我的网关", &Patch {
            base_url: Some("http://127.0.0.1:11434/v1".into()),
            apikey: Some("sk-local".into()),
            name: Some("本地 Ollama".into()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(f.name.as_deref(), Some("本地 Ollama"));
        assert!(f.enabled, "新接的一家默认是启用的");
        assert_eq!(read(t.path(), "我的网关").unwrap().unwrap(), f);
    }

    #[test]
    fn 空串是清掉这一项_不是存一个空串() {
        let t = tmp();
        write_raw(t.path(), "deepseek", SAMPLE);

        let f = apply(t.path(), "deepseek", &Patch {
            base_url: Some("  ".into()),
            apikey: Some("".into()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(f.base_url, None, "端点清掉 = 用回内置默认");
        assert!(!f.has_key());
        // 文件里也不该留一个空字符串
        let raw = std::fs::read_to_string(path(t.path(), "deepseek").unwrap()).unwrap();
        assert!(!raw.contains("apikey"), "清掉了就不该还留着这个键：\n{raw}");
    }

    #[test]
    fn 换模型清单是整组替换_别的组不动() {
        let t = tmp();
        write_raw(t.path(), "volcengine", SAMPLE);
        let f = apply(t.path(), "volcengine", &Patch {
            image: Some(vec![ModelFull {
                id: "doubao-seedream".into(),
                name: Some("Seedream".into()),
                context: None,
                note: None,
                caps: None,
            }]),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(f.image.model_list.len(), 1);
        assert_eq!(f.text.model_list.len(), 2, "text 组不该被动");
    }

    /// 只有 id 就写简写。**这条决定了手写的文件被界面改过之后还好不好读**
    /// `caps` 不写和写成空列表是两件事。
    ///
    /// 不写 = 「我没说」，前端按 modality 给默认值；`caps: []` = 「明确都不支持」。
    /// 混成一件事的话，手写一份最简的文件就等于把所有能力都关掉，
    /// 而 Agent 配置页会说这个模型不支持 function calling —— 那是假的。
    #[test]
    fn caps_不写和写成空列表不是一件事() {
        let t = tmp();
        write_raw(
            t.path(),
            "a",
            r#"
text:
  model-list:
    - id: m1
    - id: m2
      caps: []
image:
  model-list:
    - id: m3
      caps: [refImage]
"#,
        );
        let f = read(t.path(), "a").unwrap().unwrap();
        assert_eq!(f.text.model_list[0].caps(), None, "没写就是没说");
        assert_eq!(f.text.model_list[1].caps(), Some(&[] as &[String]), "写了空列表是明确都不支持");
        assert_eq!(f.image.model_list[0].caps().unwrap(), ["refImage"]);

        // 存回去也要保住这个区别
        save(t.path(), "a", &f).unwrap();
        let raw = std::fs::read_to_string(path(t.path(), "a").unwrap()).unwrap();
        let back = read(t.path(), "a").unwrap().unwrap();
        assert_eq!(back, f, "往返丢了东西：\n{raw}");
    }

    #[test]
    fn 只有_id_的存成简写_有别的字段才展开() {
        let t = tmp();
        let f = apply(t.path(), "a", &Patch {
            text: Some(vec![
                // 只有 id
                ModelFull { id: "m1".into(), name: None, context: None, note: None, caps: None },
                // name 和 id 一样，等于没写
                ModelFull { id: "m2".into(), name: Some("m2".into()), context: None, note: None, caps: None },
                // 有真的额外信息
                ModelFull { id: "m3".into(), name: Some("三号".into()), context: None, note: None, caps: None },
                ModelFull { id: "m4".into(), name: None, context: Some(128000), note: None, caps: None },
            ]),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(f.text.model_list[0], Model::Id("m1".into()));
        assert_eq!(f.text.model_list[1], Model::Id("m2".into()), "名字和 id 一样就是没写");
        assert!(matches!(f.text.model_list[2], Model::Full(_)));
        assert!(matches!(f.text.model_list[3], Model::Full(_)));

        let raw = std::fs::read_to_string(path(t.path(), "a").unwrap()).unwrap();
        assert!(raw.contains("- m1"), "该是简写：\n{raw}");
        assert!(raw.contains("三号"));
        assert!(raw.contains("128000"));
    }

    #[test]
    fn 停用一家只改那一项() {
        let t = tmp();
        write_raw(t.path(), "deepseek", SAMPLE);
        let f = apply(t.path(), "deepseek", &Patch { enabled: Some(false), ..Default::default() })
            .unwrap();
        assert!(!f.enabled);
        assert!(f.has_key(), "停用不是删 key");
        // 再启用回来
        let f = apply(t.path(), "deepseek", &Patch { enabled: Some(true), ..Default::default() })
            .unwrap();
        assert!(f.enabled);
    }

    #[test]
    fn 四种_modality_都能拿到组_别的名字拿不到() {
        let mut f = ProvFile::default();
        for m in MODALITIES {
            assert!(f.group(m).is_some(), "{m}");
            f.group_mut(m).unwrap().model_list.push(Model::Id(format!("{m}-1")));
        }
        assert!(f.group("不存在的").is_none());
        assert_eq!(f.text.model_list[0].id(), "text-1");
        assert_eq!(f.audio.model_list[0].id(), "audio-1");
    }
}
