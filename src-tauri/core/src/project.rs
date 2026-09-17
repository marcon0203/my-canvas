//! 项目落盘：一个项目就是 `<workspace>/projects/<id>/` 下的一组文件。
//!
//! 人要直接读改的走 Markdown（大纲、剧本），结构化记录走 JSON（资产、分镜）。
//! 所以打开这个目录能看懂里面是什么，而不是一个打不开的 .db。

use crate::error::{Error, Result};
use crate::md::{self, Act, DocBlock};
use crate::store::{read_json, read_text, write_json, write_text};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 项目元信息。`serde(default)` 到处都是 —— 用户手改 project.json 漏了字段
/// 不该让项目打不开。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Meta {
    pub id: String,
    pub proj: String,
    /// 画幅，如 9:16
    pub ratio: String,
    pub style: String,
    pub style_prompt: String,
    pub styles: Vec<String>,
    pub credits: u32,
    pub budget: u32,
    /// RFC3339；只用来排「最近的项目」
    pub updated_at: String,
    pub kind: String,
}

impl Default for Meta {
    fn default() -> Self {
        Self {
            id: String::new(),
            proj: "未命名项目".into(),
            ratio: "9:16".into(),
            style: "水彩绘本".into(),
            style_prompt: "watercolor storybook, soft edges, film grain".into(),
            styles: vec!["水彩绘本".into(), "胶片质感".into(), "赛璐璐".into()],
            credits: 120,
            budget: 120,
            updated_at: String::new(),
            kind: "短剧".into(),
        }
    }
}

/// 一个项目的全部内容。资产与分镜保持成 `serde_json::Value` ——
/// 它们的形状归前端 domain 管，Rust 这层只负责**原样存取**，
/// 加一个字段不用同步改两边。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub meta: Meta,
    pub acts: Vec<Act>,
    pub blocks: Vec<DocBlock>,
    #[serde(default)]
    pub assets: serde_json::Value,
    #[serde(default)]
    pub shots: serde_json::Value,
}

pub fn projects_dir(root: &Path) -> PathBuf {
    root.join("projects")
}

pub fn project_dir(root: &Path, id: &str) -> Result<PathBuf> {
    let safe = md::safe_name(id);
    if safe != id || id.is_empty() {
        return Err(Error::Store(format!("项目 id 不合法：{id}")));
    }
    Ok(projects_dir(root).join(id))
}

/// 存。**剧本一场一个 .md**，改过的那一场才会变，diff 看得清。
pub fn save(root: &Path, b: &Bundle) -> Result<()> {
    let dir = project_dir(root, &b.meta.id)?;
    write_json(&dir.join("project.json"), &b.meta)?;
    write_text(&dir.join("outline.md"), &md::emit_outline(&b.acts))?;
    write_json(&dir.join("assets.json"), &b.assets)?;
    write_json(&dir.join("shots.json"), &b.shots)?;

    // 剧本目录整块重建：块被删掉时，留着旧文件会让它下次又冒出来
    let script = dir.join("script");
    if script.is_dir() {
        std::fs::remove_dir_all(&script)
            .map_err(|e| Error::Store(format!("清理 script 失败：{e}")))?;
    }
    for (i, blk) in b.blocks.iter().enumerate() {
        // 序号前缀保证目录里的顺序就是剧本顺序，否则按文件名排会乱
        let name = format!("{:02}-{}.md", i + 1, md::safe_name(&blk.label));
        write_text(&script.join(name), &md::emit_block(blk))?;
    }
    Ok(())
}

/// 读。缺文件按空处理 —— 新建的项目只有 project.json，别的还没写出来。
pub fn load(root: &Path, id: &str) -> Result<Bundle> {
    let dir = project_dir(root, id)?;
    if !dir.is_dir() {
        return Err(Error::Store(format!("找不到项目 {id}")));
    }
    let mut meta: Meta = read_json(&dir.join("project.json"))?;
    meta.id = id.to_string();     // 目录名是权威，文件里写错了以目录为准

    let acts = md::parse_outline(&read_text(&dir.join("outline.md"))?);

    let mut blocks = Vec::new();
    let script = dir.join("script");
    if script.is_dir() {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&script)
            .map_err(|e| Error::Store(format!("读 script 失败：{e}")))?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "md"))
            .collect();
        files.sort();             // 靠 01- 02- 前缀排回剧本顺序
        for (i, f) in files.iter().enumerate() {
            blocks.push(md::parse_block(&format!("d{}", i + 1), &read_text(f)?));
        }
    }

    Ok(Bundle {
        meta,
        acts,
        blocks,
        assets: read_json(&dir.join("assets.json"))?,
        shots: read_json(&dir.join("shots.json"))?,
    })
}

/// 列出所有项目，最近改的在前。坏掉的项目**跳过但不让整个列表挂掉** ——
/// 一个项目的 json 坏了不该让首页打不开。
pub fn list(root: &Path) -> Vec<Meta> {
    let Ok(entries) = std::fs::read_dir(projects_dir(root)) else { return Vec::new() };
    let mut out: Vec<Meta> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter_map(|p| {
            let id = p.file_name()?.to_str()?.to_string();
            let mut m: Meta = read_json(&p.join("project.json")).ok()?;
            m.id = id;
            Some(m)
        })
        .collect();
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

pub fn delete(root: &Path, id: &str) -> Result<()> {
    let dir = project_dir(root, id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| Error::Store(format!("删不掉 {}：{e}", dir.display())))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::md::Beat;
    use tempfile::TempDir;

    fn bundle(id: &str) -> Bundle {
        Bundle {
            meta: Meta { id: id.into(), proj: "猫的梦".into(), updated_at: "2026-09-16T00:00:00Z".into(), ..Meta::default() },
            acts: vec![Act {
                id: "a1".into(), t: "第一幕".into(), span: "0:00–1:20".into(),
                beats: vec![Beat { id: "b1".into(), k: "场景1".into(), t: "窗边画猫".into() }],
            }],
            blocks: vec![
                DocBlock { id: "d1".into(), kind: "text".into(), label: "场景1 · 窗边".into(), body: "雨很大。".into() },
                DocBlock { id: "d2".into(), kind: "outline".into(), label: "场景2 · 送医".into(), body: "夜里。".into() },
            ],
            assets: serde_json::json!({ "角色": [{ "aid": "CHAR-001" }] }),
            shots: serde_json::json!([{ "id": "s1-1", "sceneKey": "场景1" }]),
        }
    }

    #[test]
    fn 存了能原样读回来() {
        let tmp = TempDir::new().unwrap();
        let b = bundle("p1");
        save(tmp.path(), &b).unwrap();
        assert_eq!(load(tmp.path(), "p1").unwrap(), b);
    }

    #[test]
    fn 目录里是人能看懂的文件_不是一个打不开的库() {
        let tmp = TempDir::new().unwrap();
        save(tmp.path(), &bundle("p1")).unwrap();
        let dir = tmp.path().join("projects/p1");
        assert!(dir.join("project.json").is_file());
        assert!(dir.join("outline.md").is_file());
        assert!(dir.join("assets.json").is_file());
        assert!(dir.join("shots.json").is_file());
        // 剧本一场一个 md，文件名带得出是哪一场
        let names: Vec<String> = std::fs::read_dir(dir.join("script")).unwrap()
            .flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert!(names.iter().any(|n| n.contains("窗边")), "{names:?}");
    }

    #[test]
    fn 剧本文件顺序就是剧本顺序() {
        let tmp = TempDir::new().unwrap();
        save(tmp.path(), &bundle("p1")).unwrap();
        let got = load(tmp.path(), "p1").unwrap();
        assert_eq!(got.blocks[0].label, "场景1 · 窗边");
        assert_eq!(got.blocks[1].label, "场景2 · 送医");
    }

    #[test]
    fn 手改_outline_md_下次读就变了() {
        let tmp = TempDir::new().unwrap();
        save(tmp.path(), &bundle("p1")).unwrap();
        let p = tmp.path().join("projects/p1/outline.md");
        std::fs::write(&p, "# 大纲\n\n## 我改的幕 · 0:00–0:30\n\n- **场景1** 我手写的\n").unwrap();
        let got = load(tmp.path(), "p1").unwrap();
        assert_eq!(got.acts[0].t, "我改的幕");
        assert_eq!(got.acts[0].beats[0].t, "我手写的");
    }

    #[test]
    fn 删掉一个剧本块后旧文件不会残留() {
        let tmp = TempDir::new().unwrap();
        let mut b = bundle("p1");
        save(tmp.path(), &b).unwrap();
        b.blocks.pop();
        save(tmp.path(), &b).unwrap();
        assert_eq!(load(tmp.path(), "p1").unwrap().blocks.len(), 1);
        let names: Vec<String> = std::fs::read_dir(tmp.path().join("projects/p1/script")).unwrap()
            .flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert!(!names.iter().any(|n| n.contains("送医")), "删掉的块留下了文件：{names:?}");
    }

    #[test]
    fn 新建的项目只有_project_json_也能读() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("projects/新的");
        std::fs::create_dir_all(&dir).unwrap();
        write_json(&dir.join("project.json"), &Meta { id: "新的".into(), ..Meta::default() }).unwrap();
        let got = load(tmp.path(), "新的").unwrap();
        assert!(got.acts.is_empty() && got.blocks.is_empty());
        assert_eq!(got.meta.proj, "未命名项目");
    }

    #[test]
    fn 目录名是权威_文件里的_id_写错了以目录为准() {
        let tmp = TempDir::new().unwrap();
        let mut b = bundle("p1");
        save(tmp.path(), &b).unwrap();
        b.meta.id = "写错了".into();
        write_json(&tmp.path().join("projects/p1/project.json"), &b.meta).unwrap();
        assert_eq!(load(tmp.path(), "p1").unwrap().meta.id, "p1");
    }

    #[test]
    fn 列表按更新时间倒序_最近的在前() {
        let tmp = TempDir::new().unwrap();
        for (id, t) in [("旧", "2026-01-01T00:00:00Z"), ("新", "2026-09-01T00:00:00Z")] {
            let mut b = bundle(id);
            b.meta.updated_at = t.into();
            save(tmp.path(), &b).unwrap();
        }
        assert_eq!(list(tmp.path()).iter().map(|m| m.id.clone()).collect::<Vec<_>>(), ["新", "旧"]);
    }

    #[test]
    fn 一个项目坏了不让整个列表挂掉() {
        let tmp = TempDir::new().unwrap();
        save(tmp.path(), &bundle("好的")).unwrap();
        let bad = tmp.path().join("projects/坏的");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join("project.json"), "{ 不是 json").unwrap();
        let l = list(tmp.path());
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].id, "好的");
    }

    #[test]
    fn 项目_id_里带路径分隔符会被拒_挡住写到目录外() {
        let tmp = TempDir::new().unwrap();
        for bad in ["../逃出去", "a/b", ""] {
            assert!(project_dir(tmp.path(), bad).is_err(), "{bad} 该被拒");
        }
    }

    #[test]
    fn 读不存在的项目报错_而不是给个空壳() {
        let tmp = TempDir::new().unwrap();
        assert!(load(tmp.path(), "查无此项").is_err());
    }

    #[test]
    fn 删掉项目后列表里就没有了_删不存在的不报错() {
        let tmp = TempDir::new().unwrap();
        save(tmp.path(), &bundle("p1")).unwrap();
        delete(tmp.path(), "p1").unwrap();
        assert!(list(tmp.path()).is_empty());
        delete(tmp.path(), "p1").unwrap();
    }

    /* ---- 导出 ---- */

    fn full() -> (TempDir, ()) {
        let tmp = TempDir::new().unwrap();
        save(tmp.path(), &Bundle {
            meta: Meta { id: "p1".into(), proj: "猫 的 梦".into(), ..Meta::default() },
            acts: vec![Act {
                id: "a1".into(), t: "第一幕".into(), span: "0:00–1:00".into(),
                beats: vec![Beat { id: "b1".into(), k: "场景1".into(), t: "窗边".into() }],
            }],
            blocks: vec![DocBlock {
                id: "d1".into(), kind: "text".into(), label: "正文".into(), body: "第一段".into(),
            }],
            assets: serde_json::json!({}),
            shots: serde_json::json!([
                { "id": "s1-1", "sceneKey": "场景1", "size": "中景", "dur": 2.5,
                  "desc": "推近，她转头", "own": "a girl turns, soft light", "refs": ["CHAR-001"] }
            ]),
        }).unwrap();
        (tmp, ())
    }

    #[test]
    fn 导出大纲与剧本是_markdown() {
        let (tmp, _) = full();
        let (name, mime, text) = export(tmp.path(), "p1", "outline").unwrap();
        assert!(name.ends_with("-大纲.md"), "{name}");
        assert_eq!(mime, "text/markdown");
        assert!(text.contains("第一幕"));

        let (name, _, text) = export(tmp.path(), "p1", "script").unwrap();
        assert!(name.ends_with("-剧本.md"), "{name}");
        assert!(text.contains("# 猫 的 梦") || text.contains("猫"));
        assert!(text.contains("第一段"));
    }

    #[test]
    fn 分镜表导成_csv_且带逗号的字段会被转义() {
        let (tmp, _) = full();
        let (name, mime, text) = export(tmp.path(), "p1", "shots").unwrap();
        assert!(name.ends_with(".csv"), "{name}");
        assert_eq!(mime, "text/csv");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], "镜号,场次,景别,时长,内容,提示词,引用");
        // 不转义的话，一条带逗号的提示词就能把整张表错位 —— 而且错位后
        // 看起来仍然是一张正常的表。所以这里按 CSV 规则真解一遍列数
        assert!(lines[1].contains("\"a girl turns, soft light\""), "带逗号的没转义：{}", lines[1]);
        assert_eq!(fields(lines[0]).len(), 7);
        assert_eq!(fields(lines[1]).len(), 7, "列数对不上，说明有字段没转义：{}", lines[1]);
        assert_eq!(fields(lines[1])[5], "a girl turns, soft light");
    }

    /// 按 CSV 规则切一行（只够测试用：认双引号包裹与 "" 转义）
    fn fields(line: &str) -> Vec<String> {
        let mut out = vec![String::new()];
        let mut quoted = false;
        let mut chars = line.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '"' if quoted && chars.peek() == Some(&'"') => {
                    chars.next();
                    out.last_mut().unwrap().push('"');
                }
                '"' => quoted = !quoted,
                ',' if !quoted => out.push(String::new()),
                _ => out.last_mut().unwrap().push(c),
            }
        }
        out
    }

    #[test]
    fn 空剧本空分镜说清没东西可导_不给一个空文件() {
        let tmp = TempDir::new().unwrap();
        save(tmp.path(), &Bundle {
            meta: Meta { id: "空".into(), ..Meta::default() },
            shots: serde_json::json!([]), ..Default::default()
        }).unwrap();
        for what in ["script", "shots"] {
            let e = export(tmp.path(), "空", what).unwrap_err();
            assert!(e.to_string().contains("没有东西可导"), "{what}: {e}");
        }
    }

    #[test]
    fn 成片导出如实说没有渲染管线_而不是给一个空_mp4() {
        let (tmp, _) = full();
        let e = export(tmp.path(), "p1", "film").unwrap_err();
        assert!(e.to_string().contains("渲染管线"), "{e}");
        let e = export(tmp.path(), "p1", "怪东西").unwrap_err();
        assert!(e.to_string().contains("不认识的导出类型"));
    }
}

/* ---------------- 导出 ---------------- */

/// 导出一份可以拿走的文件：**只产生内容，不决定写到哪儿。**
///
/// 路径必须由用户选（系统保存对话框）—— 让 Agent 决定往哪个目录写，
/// 等于给它一个任意写文件的能力，那是这个产品里最不该有的东西。
/// 所以这里返回 `(文件名建议, mime, 正文)`，由 app 层拿去弹对话框。
///
/// 成片（film）不在这里：那需要一条真的渲染管线（拼片段、转码、烧字幕），
/// 现在没有 —— 与其导出一个空 mp4，不如说清还没有。
pub fn export(root: &Path, id: &str, what: &str) -> Result<(String, String, String)> {
    let b = load(root, id)?;
    let stem = md::safe_name(&b.meta.proj);
    let stem = if stem.is_empty() { id.to_string() } else { stem };

    match what {
        "outline" => Ok((
            format!("{stem}-大纲.md"),
            "text/markdown".into(),
            md::emit_outline(&b.acts),
        )),

        "script" => {
            if b.blocks.is_empty() {
                return Err(Error::Store("剧本是空的 —— 没有东西可导".into()));
            }
            // 一个块一节，与磁盘上一场一个 .md 的分法一致
            let mut out = format!("# {}\n\n", b.meta.proj);
            for blk in &b.blocks {
                out.push_str(&format!("## {}\n\n{}\n\n", blk.label.trim(), blk.body.trim()));
            }
            Ok((format!("{stem}-剧本.md"), "text/markdown".into(), out))
        }

        "shots" => {
            let shots = b.shots.as_array().cloned().unwrap_or_default();
            if shots.is_empty() {
                return Err(Error::Store("还没有分镜 —— 没有东西可导".into()));
            }
            // 分镜表导成 CSV：它的用处是拿去排期、发给外包、对账，
            // 这些事都在表格软件里做，Markdown 表格反而更难用
            let mut out = String::from("镜号,场次,景别,时长,内容,提示词,引用\n");
            for s in &shots {
                let f = |k: &str| {
                    s.get(k)
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .to_string()
                };
                let refs = s
                    .get("refs")
                    .and_then(serde_json::Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str())
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default();
                let dur = s
                    .get("dur")
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(0.0);
                out.push_str(&format!(
                    "{},{},{},{},{},{},{}\n",
                    csv(&f("id")), csv(&f("sceneKey")), csv(&f("size")),
                    dur, csv(&f("desc")), csv(&f("own")), csv(&refs),
                ));
            }
            Ok((format!("{stem}-分镜表.csv"), "text/csv".into(), out))
        }

        "film" => Err(Error::Store(
            "成片导出还没有渲染管线（拼片段、转码、烧字幕都还没有）—— \
             现在能导的是大纲、剧本和分镜表"
                .into(),
        )),

        other => Err(Error::Store(format!(
            "不认识的导出类型「{other}」—— 能导 outline / script / shots"
        ))),
    }
}

/// CSV 转义。**不做的话一条带逗号的提示词就能把整张表错位**，
/// 而且错位后看起来仍然是一张正常的表 —— 那种错最难发现。
fn csv(v: &str) -> String {
    let one_line = v.replace('\n', " ").replace('\r', "");
    if one_line.contains(',') || one_line.contains('"') {
        format!("\"{}\"", one_line.replace('"', "\"\""))
    } else {
        one_line
    }

}
