//! 写类工具的产物：**一份补丁，不是一次写盘**。
//!
//! 为什么不直接写文件，见 `tools::Outcome::Patch` 上那段说明 ——
//! 前端 store 是界面的活数据，autosave 会把它写回盘；Rust 也写就有两个
//! 写入者，谁后写谁赢，丢更新还很难查。
//!
//! 所以这一层只做 Rust 真正比模型强的事：
//!
//! | | 模型做不好的地方 |
//! |---|---|
//! | **编号** | 场次键、镜号、资产 aid 都要跨项目唯一。模型会重复、会跳号 |
//! | **存在性** | 引用一个不存在的资产/镜头是静默错误，跑到出图那步才炸 |
//! | **值域** | 机位角度、亮度、色温超出范围会渲出一张黑图 |
//! | **拒绝空产物** | 空大纲、空镜头、空正文不是产物，是模型跑偏了 |
//!
//! 补丁形状与前端 `domain/agent/types.ts` 的 `ProposalPatch` 一一对应，
//! 有 parity 测试盯着 —— 一份前端看不懂的补丁等于没产出。

use crate::error::{Error, Result};
use crate::md::Act;
use crate::project::{self, Bundle};
use serde_json::{Value, json};

/// 画风名 → 英文片段。与前端 `domain/prompt/vocabulary.ts` 的 STYLEMAP 同一份，
/// 有 parity 测试。查不到的画风名原样带上 —— 用户自定义的风格名也该能用。
pub const STYLEMAP: &[(&str, &str)] = &[
    ("温暖手绘", "warm hand-painted"),
    ("3D 动画", "3D animated render"),
    ("日式赛璐璐", "anime cel shading"),
    ("水彩绘本", "watercolor storybook style"),
    ("厚涂写实", "thick impasto painting"),
    ("胶片质感", "film photography, grainy"),
    ("黏土定格", "claymation stop-motion"),
    ("像素风", "pixel art"),
];

pub fn style_frag(style: &str) -> String {
    STYLEMAP
        .iter()
        .find(|(k, _)| *k == style)
        .map(|(_, v)| (*v).to_string())
        .unwrap_or_else(|| style.to_string())
}

/// 资产分组 → aid 前缀。与前端 `AID_PREFIX` 同一份
pub fn aid_prefix(group: &str) -> Option<&'static str> {
    match group {
        "角色" => Some("CHAR"),
        "场景" => Some("SCENE"),
        "道具" => Some("PROP"),
        _ => None,
    }
}

fn str_of(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

/// 读项目。**读不到不算错** —— 新项目还没落盘时也该能写第一份产物
fn bundle(root: &std::path::Path, id: &str) -> Bundle {
    project::load(root, id).unwrap_or_default()
}

/// 写类工具 → 补丁。`None` 表示这个工具不是写类的，由调用方继续往下找。
pub fn of(root: &std::path::Path, id: &str, tool: &str, args: &Value) -> Result<Option<Value>> {
    Ok(Some(match tool {
        "outline.write" => outline_write(root, id, args)?,
        "script.write" => script_write(root, id, args)?,
        "asset.write" => asset_write(root, id, args)?,
        "asset.lock" => asset_lock(root, id, args)?,
        "shot.write" => shot_write(root, id, args)?,
        "shot.rig" => shot_rig(root, id, args)?,
        "style.apply" => style_apply(root, id, args)?,
        _ => return Ok(None),
    }))
}

/* ---------------- 大纲 ---------------- */

fn outline_write(root: &std::path::Path, id: &str, args: &Value) -> Result<Value> {
    let mut acts: Vec<Act> =
        serde_json::from_value(args.get("acts").cloned().unwrap_or(Value::Null))
            .map_err(|e| Error::Store(format!("acts 形状不对：{e}")))?;
    if acts.is_empty() {
        return Err(Error::Store("没有幕 —— 空大纲不是一份产物".into()));
    }
    // 场次键统一重编，跨幕连续。模型自己编会重复、会跳号
    let existing: usize = bundle(root, id).acts.iter().map(|a| a.beats.len()).sum();
    let mut n = existing + 1;
    for a in acts.iter_mut() {
        for b in a.beats.iter_mut() {
            b.k = format!("场景{n}");
            n += 1;
        }
    }
    Ok(json!({ "t": "acts", "acts": acts }))
}

/* ---------------- 剧本 ---------------- */

/// 写正文块，或改写已有的一块。
///
/// 两件事合成一个工具是因为在模型那边它们是同一个念头（「把这段写出来」），
/// 分成两个工具它会挑错。这边按 `edit` 在不在分流：
/// 改写要**验那块真的存在** —— 模型给个编错的 id，补丁打上去就静默丢了。
fn script_write(root: &std::path::Path, id: &str, args: &Value) -> Result<Value> {
    let b = bundle(root, id);

    if let Some(e) = args.get("edit").filter(|x| !x.is_null()) {
        let bid = str_of(e, "id");
        let body = e.get("body").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if bid.is_empty() {
            return Err(Error::Store("要改哪一块？没给 id".into()));
        }
        if body.is_empty() {
            return Err(Error::Store("改写后的正文是空的 —— 清空一块内容不该走这条".into()));
        }
        if !b.blocks.iter().any(|x| x.id == bid) {
            return Err(Error::Store(format!("剧本里没有 {bid} 这一块")));
        }
        return Ok(json!({ "t": "blockBody", "id": bid, "body": body }));
    }

    let list = args.get("blocks").and_then(Value::as_array).cloned().unwrap_or_default();
    if list.is_empty() {
        return Err(Error::Store("没有正文块 —— 空剧本不是一份产物".into()));
    }
    // 块 id 由这儿给：模型给的 id 会和已有的撞，撞了前端按 id 查就查到旧的那块。
    // 前缀用 `d`，与 project::load 按文件顺序重编的那套一致 —— 换个前缀的话，
    // 这批块存盘再读回来 id 就变了，之后拿旧 id 去改写会找不到。
    let mut used: Vec<String> = b.blocks.iter().map(|x| x.id.clone()).collect();
    let mut out = Vec::new();
    for blk in list {
        let label = str_of(&blk, "label");
        let body = blk.get("body").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if body.is_empty() {
            return Err(Error::Store(format!("「{label}」的正文是空的")));
        }
        // type 只有这三种，前端按它选渲染方式；给个不认识的会渲成空白
        let kind = match str_of(&blk, "type").as_str() {
            "character" => "character",
            "outline" => "outline",
            "" | "text" => "text",
            other => return Err(Error::Store(format!("不认识的块类型：{other}"))),
        };
        let mut n = used.len() + 1;
        let mut bid = format!("d{n}");
        while used.contains(&bid) {
            n += 1;
            bid = format!("d{n}");
        }
        used.push(bid.clone());
        out.push(json!({
            "id": bid, "type": kind,
            "label": if label.is_empty() { "未命名".to_string() } else { label },
            "body": body,
        }));
    }
    Ok(json!({ "t": "blocks", "blocks": out }))
}

/* ---------------- 资产 ---------------- */

/// 全部已有 aid（跨三个分组）
fn all_aids(b: &Bundle) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(groups) = b.assets.as_object() {
        for list in groups.values() {
            for a in list.as_array().unwrap_or(&vec![]) {
                if let Some(s) = a.get("aid").and_then(Value::as_str) {
                    out.push(s.to_string());
                }
            }
        }
    }
    out
}

/// 建资产。
///
/// 补丁里只给 **aid / 分组 / 名字 / 描述**，形状照那一堆（每个视角的 rig、
/// 画风、提示词）由前端的工厂补 —— 资产的形状归前端 domain 管，
/// 在 Rust 这边照抄一份迟早和它对不上。
fn asset_write(root: &std::path::Path, id: &str, args: &Value) -> Result<Value> {
    let list = args.get("assets").and_then(Value::as_array).cloned().unwrap_or_default();
    if list.is_empty() {
        return Err(Error::Store("没有要建的资产".into()));
    }
    let b = bundle(root, id);
    let mut aids = all_aids(&b);
    let names: Vec<String> = b
        .assets
        .as_object()
        .map(|g| {
            g.values()
                .flat_map(|l| l.as_array().cloned().unwrap_or_default())
                .filter_map(|a| a.get("name")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let mut out = Vec::new();
    let mut added: Vec<String> = Vec::new();
    for a in list {
        let group = str_of(&a, "group");
        let Some(prefix) = aid_prefix(&group) else {
            return Err(Error::Store(format!(
                "分组只能是 角色 / 场景 / 道具，给的是「{group}」"
            )));
        };
        let name = str_of(&a, "name");
        if name.is_empty() {
            return Err(Error::Store("资产没有名字".into()));
        }
        // 同名资产会让「这一镜引的是哪个」说不清，分镜引用按 aid，人看的是名字
        if names.contains(&name) || added.contains(&name) {
            return Err(Error::Store(format!("资产库里已经有「{name}」了")));
        }
        added.push(name.clone());

        let mut n = 1;
        let mut aid = format!("{prefix}-{n:03}");
        while aids.contains(&aid) {
            n += 1;
            aid = format!("{prefix}-{n:03}");
        }
        aids.push(aid.clone());

        let desc = str_of(&a, "desc");
        out.push(json!({
            "group": group, "aid": aid, "name": name,
            "desc": if desc.is_empty() { "待补描述".to_string() } else { desc },
            "voice": a.get("voice").and_then(Value::as_str).unwrap_or(""),
        }));
    }
    Ok(json!({ "t": "assetsDraft", "add": out }))
}

fn asset_lock(root: &std::path::Path, id: &str, args: &Value) -> Result<Value> {
    let aid = str_of(args, "aid");
    if aid.is_empty() {
        return Err(Error::Store("没说锁哪个资产".into()));
    }
    // 引用一个不存在的资产是静默错误：分镜引上了，出图时才发现没有
    if !all_aids(&project::load(root, id)?).contains(&aid) {
        return Err(Error::Store(format!("资产库里没有 {aid}")));
    }
    Ok(json!({ "t": "assetLock", "aid": aid }))
}

/* ---------------- 分镜 ---------------- */

fn shot_ids(b: &Bundle) -> Vec<String> {
    b.shots
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.get("id")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn shot_write(root: &std::path::Path, id: &str, args: &Value) -> Result<Value> {
    let shots = args.get("shots").and_then(Value::as_array).cloned().unwrap_or_default();
    if shots.is_empty() {
        return Err(Error::Store("没有镜头".into()));
    }
    let b = bundle(root, id);
    let mut used = shot_ids(&b);
    let mut out = Vec::new();
    for mut sh in shots {
        let scene = sh.get("sceneKey").and_then(Value::as_str).unwrap_or("场景1").to_string();
        let num: String = scene.chars().filter(char::is_ascii_digit).collect();
        let num = if num.is_empty() { "1".to_string() } else { num };
        let mut k = 1;
        let mut sid = format!("s{num}-{k}");
        while used.contains(&sid) {
            k += 1;
            sid = format!("s{num}-{k}");
        }
        used.push(sid.clone());
        if let Some(o) = sh.as_object_mut() {
            o.insert("id".into(), json!(sid));
        }
        out.push(sh);
    }
    Ok(json!({ "t": "shots", "shots": out }))
}

/// 机位与灯光的值域。超出范围不会报错，只会渲出一张黑图或一个诡异角度 ——
/// 那种错查起来最费时间，所以在这儿就夹住。
const RANGES: &[(&str, f64, f64)] = &[
    ("az", -180.0, 180.0),
    ("el", -35.0, 55.0),
    ("lightAz", -180.0, 180.0),
    ("lightEl", -90.0, 90.0),
    ("bright", 10.0, 100.0),
    ("kelvin", 2000.0, 8000.0),
    ("ambient", 0.0, 100.0),
    ("dist", 0.0, 5.0),
    ("distFine", -0.5, 0.5),
];

/// 设机位光线。**只改给到的字段**，没给的保持原样 ——
/// 整份 rig 覆盖会把用户在布光台上调过的东西悄悄抹掉。
fn shot_rig(root: &std::path::Path, id: &str, args: &Value) -> Result<Value> {
    let sid = str_of(args, "shotId");
    if sid.is_empty() {
        return Err(Error::Store("没说改哪一镜".into()));
    }
    if !shot_ids(&project::load(root, id)?).contains(&sid) {
        return Err(Error::Store(format!("分镜里没有 {sid}")));
    }
    let Some(rig) = args.get("rig").and_then(Value::as_object) else {
        return Err(Error::Store("没给机位参数".into()));
    };
    if rig.is_empty() {
        return Err(Error::Store("机位参数是空的 —— 没有要改的东西".into()));
    }
    let mut patch = serde_json::Map::new();
    for (k, v) in rig {
        if let Some((_, lo, hi)) = RANGES.iter().find(|(n, _, _)| n == k) {
            let Some(x) = v.as_f64() else {
                return Err(Error::Store(format!("{k} 要是个数，给的是 {v}")));
            };
            if x < *lo || x > *hi {
                return Err(Error::Store(format!("{k}={x} 超出 [{lo}, {hi}]")));
            }
        }
        patch.insert(k.clone(), v.clone());
    }
    Ok(json!({ "t": "shotRig", "edits": [{ "id": sid, "rig": patch }] }))
}

/* ---------------- 画风 ---------------- */

/// 换画风。节点级单独指定过画风的镜头不跟着走 —— 那是前端应用补丁时的事，
/// 这儿只负责确认这个画风名是认得的，并给出它对应的英文片段。
fn style_apply(root: &std::path::Path, id: &str, args: &Value) -> Result<Value> {
    let style = str_of(args, "style");
    if style.is_empty() {
        return Err(Error::Store("没说换成哪个画风".into()));
    }
    let b = bundle(root, id);
    let known = STYLEMAP.iter().any(|(k, _)| *k == style) || b.meta.styles.contains(&style);
    if !known {
        // 编一个画风名出来，出图时会当成普通提示词词组混进去，画面莫名其妙
        return Err(Error::Store(format!(
            "不认识的画风「{style}」—— 可选：{}",
            b.meta
                .styles
                .iter()
                .map(String::as_str)
                .chain(STYLEMAP.iter().map(|(k, _)| *k))
                .collect::<Vec<_>>()
                .join("、")
        )));
    }
    if style == b.meta.style {
        return Err(Error::Store(format!("现在就是「{style}」，没有要改的")));
    }
    Ok(json!({ "t": "style", "style": style, "stylePrompt": style_frag(&style) }))
}

/* ---------------- 样本：给前端 store 测试喂真补丁 ---------------- */

/// 生成样本用的临时项目 + 每个写类工具的调用参数 → 一份 `工具 → 补丁` 的表。
///
/// 前端 `src/store/patch.test.ts` 拿这份 JSON 喂给 store，验「Rust 算出来的补丁
/// 前端真能应用」。**两侧各写一份形状定义，对不上时是静默失败**：界面会
/// 「采纳成功」而项目里什么都没变，不报错也不留日志。所以那边不手写 JSON。
///
/// 落成文件而不是让前端测试去调 cargo：那样每跑一次前端测试都要编一遍 Rust，
/// 而且没装 Rust 的环境会静静跳过 —— 一个会静静跳过的守卫等于没有。
pub fn samples() -> Value {
    let tmp = std::env::temp_dir().join(format!(
        "hitv-patch-samples-{}-{:?}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let _ = std::fs::remove_dir_all(&tmp);

    // 与前端 mock 的 p1 对齐：一幕一场、一个正文块、一个角色、一镜
    let b = Bundle {
        meta: crate::project::Meta {
            id: "p1".into(),
            style: "水彩绘本".into(),
            styles: vec!["水彩绘本".into(), "胶片质感".into()],
            ..Default::default()
        },
        acts: vec![crate::md::Act {
            id: "a1".into(),
            t: "第一幕".into(),
            span: "0:00–1:00".into(),
            beats: vec![crate::md::Beat { id: "b1".into(), k: "场景1".into(), t: "窗边".into() }],
        }],
        blocks: vec![crate::md::DocBlock {
            id: "d1".into(),
            kind: "text".into(),
            label: "正文".into(),
            body: "原有正文".into(),
        }],
        assets: json!({ "角色": [{ "aid": "CHAR-001", "name": "艾米" }], "场景": [], "道具": [] }),
        shots: json!([{ "id": "s1-1", "sceneKey": "场景1" }]),
    };
    project::save(&tmp, &b).expect("写临时项目");

    let calls: &[(&str, Value)] = &[
        ("outline.write", json!({ "acts": [
            { "id": "", "t": "新一幕", "span": "0:00–0:40", "beats": [{ "id": "", "k": "", "t": "开场" }] }
        ] })),
        ("script.write", json!({ "blocks": [{ "label": "场景2", "body": "新写的一段正文" }] })),
        ("asset.write", json!({ "assets": [{ "group": "角色", "name": "小林", "desc": "十岁，安静" }] })),
        ("asset.lock", json!({ "aid": "CHAR-001" })),
        ("shot.write", json!({ "shots": [{ "sceneKey": "场景1", "size": "中景", "desc": "推近" }] })),
        ("shot.rig", json!({ "shotId": "s1-1", "rig": { "az": 30, "bright": 65 } })),
        ("style.apply", json!({ "style": "胶片质感" })),
    ];

    let mut out = serde_json::Map::new();
    for (tool, args) in calls {
        let p = of(&tmp, "p1", tool, args)
            .unwrap_or_else(|e| panic!("{tool}：{e}"))
            .unwrap_or_else(|| panic!("{tool} 不是写类工具？"));
        out.insert((*tool).to_string(), p);
    }
    let _ = std::fs::remove_dir_all(&tmp);
    Value::Object(out)
}

/// 样本的落盘形式。缩进与末尾换行固定下来，否则每次生成都是一个假 diff
pub fn samples_json(v: &Value) -> String {
    format!("{}\n", serde_json::to_string_pretty(v).expect("样本序列化"))
}

/// fixture 文件相对 core crate 的位置
pub const SAMPLES_PATH: &str = "../../src/store/__fixtures__/rust-patches.json";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::md::{Act, Beat, DocBlock};
    use crate::project::Meta;
    use tempfile::TempDir;

    fn setup() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let b = Bundle {
            meta: Meta {
                id: "p1".into(),
                style: "水彩绘本".into(),
                styles: vec!["水彩绘本".into(), "胶片质感".into()],
                ..Meta::default()
            },
            acts: vec![Act {
                id: "a1".into(),
                t: "第一幕".into(),
                span: "0:00–1:00".into(),
                beats: vec![Beat { id: "b1".into(), k: "场景1".into(), t: "窗边".into() }],
            }],
            blocks: vec![DocBlock {
                id: "d1".into(),
                kind: "text".into(),
                label: "场景1".into(),
                body: "旧正文".into(),
            }],
            assets: json!({ "角色": [{ "aid": "CHAR-001", "name": "艾米" }], "场景": [], "道具": [] }),
            shots: json!([{ "id": "s1-1", "sceneKey": "场景1" }]),
        };
        project::save(tmp.path(), &b).unwrap();
        tmp
    }

    fn p(tmp: &TempDir, tool: &str, args: Value) -> Result<Value> {
        of(tmp.path(), "p1", tool, &args).map(|x| x.expect("这个工具应该是写类的"))
    }

    /* ---- 剧本 ---- */

    #[test]
    fn 写剧本_块id接着已有的编_不和旧块撞() {
        let tmp = setup();
        let v = p(&tmp, "script.write", json!({ "blocks": [
            { "label": "场景2", "body": "新正文" },
            { "label": "场景3", "body": "再一段", "type": "outline" },
        ] })).unwrap();
        assert_eq!(v["t"], "blocks");
        assert_eq!(v["blocks"][0]["id"], "d2");
        assert_eq!(v["blocks"][1]["id"], "d3");
        assert_eq!(v["blocks"][1]["type"], "outline");
    }

    #[test]
    fn 写剧本_空正文不是产物() {
        let tmp = setup();
        assert!(p(&tmp, "script.write", json!({ "blocks": [] })).is_err());
        assert!(p(&tmp, "script.write", json!({ "blocks": [{ "label": "x", "body": "  " }] })).is_err());
    }

    #[test]
    fn 写剧本_不认识的块类型直接拒() {
        let tmp = setup();
        // 给个不认识的 type，前端会渲成空白 —— 静默出错比报错糟
        let e = p(&tmp, "script.write", json!({ "blocks": [{ "label": "x", "body": "y", "type": "怪" }] }))
            .unwrap_err();
        assert!(e.to_string().contains("不认识的块类型"));
    }

    #[test]
    fn 改写剧本_块不存在时报错_不静默丢补丁() {
        let tmp = setup();
        let v = p(&tmp, "script.write", json!({ "edit": { "id": "d1", "body": "润色后" } })).unwrap();
        assert_eq!(v["t"], "blockBody");
        assert_eq!(v["body"], "润色后");

        let e = p(&tmp, "script.write", json!({ "edit": { "id": "d9", "body": "x" } })).unwrap_err();
        assert!(e.to_string().contains("没有 d9"));
    }

    /* ---- 资产 ---- */

    #[test]
    fn 建资产_aid接着已有的编_三个分组各自一套号() {
        let tmp = setup();
        let v = p(&tmp, "asset.write", json!({ "assets": [
            { "group": "角色", "name": "小林", "desc": "十岁" },
            { "group": "场景", "name": "旧书店" },
            { "group": "角色", "name": "母亲" },
        ] })).unwrap();
        assert_eq!(v["t"], "assetsDraft");
        assert_eq!(v["add"][0]["aid"], "CHAR-002"); // CHAR-001 已占
        assert_eq!(v["add"][1]["aid"], "SCENE-001");
        assert_eq!(v["add"][2]["aid"], "CHAR-003");
        assert_eq!(v["add"][1]["desc"], "待补描述");
    }

    #[test]
    fn 建资产_同名的拦住_引用时说不清是哪个() {
        let tmp = setup();
        let e = p(&tmp, "asset.write", json!({ "assets": [{ "group": "角色", "name": "艾米" }] }))
            .unwrap_err();
        assert!(e.to_string().contains("已经有"));
        // 同一批里重名也要拦
        let e = p(&tmp, "asset.write", json!({ "assets": [
            { "group": "角色", "name": "小林" }, { "group": "道具", "name": "小林" },
        ] })).unwrap_err();
        assert!(e.to_string().contains("已经有"));
    }

    #[test]
    fn 建资产_分组只能是那三个() {
        let tmp = setup();
        let e = p(&tmp, "asset.write", json!({ "assets": [{ "group": "音乐", "name": "x" }] }))
            .unwrap_err();
        assert!(e.to_string().contains("角色"));
    }

    /* ---- 机位 ---- */

    #[test]
    fn 设机位_只改给到的字段_不覆盖整份rig() {
        let tmp = setup();
        let v = p(&tmp, "shot.rig", json!({ "shotId": "s1-1", "rig": { "az": 30, "bright": 65 } })).unwrap();
        assert_eq!(v["t"], "shotRig");
        assert_eq!(v["edits"][0]["id"], "s1-1");
        assert_eq!(v["edits"][0]["rig"]["az"], 30);
        // 没给的字段不出现在补丁里 —— 出现就等于把用户调过的值抹回默认
        assert!(v["edits"][0]["rig"].get("el").is_none());
    }

    #[test]
    fn 设机位_值域外的值当场拒_否则渲出一张黑图() {
        let tmp = setup();
        for bad in [json!({ "el": 80 }), json!({ "bright": 0 }), json!({ "kelvin": 12000 })] {
            let e = p(&tmp, "shot.rig", json!({ "shotId": "s1-1", "rig": bad })).unwrap_err();
            assert!(e.to_string().contains("超出"), "{e}");
        }
        let e = p(&tmp, "shot.rig", json!({ "shotId": "s1-1", "rig": { "az": "左边" } })).unwrap_err();
        assert!(e.to_string().contains("要是个数"));
    }

    #[test]
    fn 设机位_镜头不存在时报错() {
        let tmp = setup();
        let e = p(&tmp, "shot.rig", json!({ "shotId": "s9-9", "rig": { "az": 0 } })).unwrap_err();
        assert!(e.to_string().contains("没有 s9-9"));
        assert!(p(&tmp, "shot.rig", json!({ "shotId": "s1-1", "rig": {} })).is_err());
    }

    /* ---- 画风 ---- */

    #[test]
    fn 换画风_给出英文片段() {
        let tmp = setup();
        let v = p(&tmp, "style.apply", json!({ "style": "胶片质感" })).unwrap();
        assert_eq!(v["t"], "style");
        assert_eq!(v["stylePrompt"], "film photography, grainy");
    }

    #[test]
    fn 换画风_编出来的画风名拦住_否则混进提示词() {
        let tmp = setup();
        let e = p(&tmp, "style.apply", json!({ "style": "赛博朋克水墨" })).unwrap_err();
        assert!(e.to_string().contains("不认识的画风"));
        // 已经是这个画风就不出产物 —— 一张什么都没改的补丁卡是噪音
        let e = p(&tmp, "style.apply", json!({ "style": "水彩绘本" })).unwrap_err();
        assert!(e.to_string().contains("没有要改的"));
    }

    #[test]
    fn 项目里自定义的画风名也认() {
        let tmp = TempDir::new().unwrap();
        project::save(tmp.path(), &Bundle {
            meta: Meta { id: "p1".into(), style: "水彩绘本".into(), styles: vec!["我的风格".into()], ..Meta::default() },
            ..Default::default()
        }).unwrap();
        let v = p(&tmp, "style.apply", json!({ "style": "我的风格" })).unwrap();
        // 词表里查不到就原样带上，让用户自己写的风格名也能用
        assert_eq!(v["stylePrompt"], "我的风格");
    }

    /* ---- 不是写类的 ---- */

    /// fixture 与当前实现必须一致。
    ///
    /// 前端的 store 测试吃的是那个文件；忘了重新生成的话，它验的是一份过期的
    /// 形状 —— 通过了也说明不了什么。所以这条在 Rust 侧把话说死。
    #[test]
    fn 样本文件与当前实现一致_否则前端验的是过期形状() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SAMPLES_PATH);
        let want = samples_json(&samples());
        let got = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            got, want,
            "补丁形状变了但 {} 没跟着更新 —— 跑 `npm run fixtures` 重新生成",
            path.display()
        );
    }

    #[test]
    fn 读类工具在这儿返回_none_由调用方继续找() {
        let tmp = setup();
        assert!(of(tmp.path(), "p1", "project.read", &json!({})).unwrap().is_none());
    }
}
