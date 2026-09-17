//! 大纲与剧本的 Markdown 编解码。
//!
//! 为什么是 Markdown 而不是 JSON：**这两样东西人要直接读、直接改**。
//! 用户可以用任何编辑器打开 `outline.md` 调一场戏的顺序，存盘后应用照单全收。
//! 结构化的东西（资产、分镜、记账）还是 JSON —— 那些不是拿来手写的。
//!
//! 往返必须无损：`parse(emit(x)) == x`。测试里对真实形状逐条核。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Beat {
    pub id: String,
    /// 场次键，如「场景1」
    pub k: String,
    pub t: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Act {
    pub id: String,
    pub t: String,
    pub span: String,
    pub beats: Vec<Beat>,
}

/// 时间跨度长这样：`0:00–1:20`（注意是 en dash）或 `0:00-1:20`
fn is_span(s: &str) -> bool {
    let t = s.trim();
    let Some((a, b)) = t.split_once('–').or_else(|| t.split_once('-')) else { return false };
    let ok = |p: &str| {
        p.split_once(':')
            .is_some_and(|(m, s)| !m.is_empty() && m.chars().all(|c| c.is_ascii_digit())
                && s.len() == 2 && s.chars().all(|c| c.is_ascii_digit()))
    };
    ok(a) && ok(b)
}

/// 幕 → `## 标题 · 0:00–1:20`，场 → `- **场景1** 这一场干什么`
pub fn emit_outline(acts: &[Act]) -> String {
    let mut out = String::from("# 大纲\n");
    for a in acts {
        out.push('\n');
        if a.span.trim().is_empty() {
            out.push_str(&format!("## {}\n\n", a.t.trim()));
        } else {
            out.push_str(&format!("## {} · {}\n\n", a.t.trim(), a.span.trim()));
        }
        for b in &a.beats {
            out.push_str(&format!("- **{}** {}\n", b.k.trim(), b.t.trim()));
        }
    }
    out
}

/// 解析大纲。
///
/// **id 不写进文件，按位置重新生成**（a1.. / b1..）。
/// 写进去等于让人手改文件时还得维护一串没有意义的编号；而 id 在这个应用里
/// 只做 UI 选中用，真正跨表引用的是场次键 `k`（Shot.sceneKey 对的就是它）。
pub fn parse_outline(text: &str) -> Vec<Act> {
    let mut acts: Vec<Act> = Vec::new();
    let mut beat_n = 0usize;
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("## ") {
            let (title, span) = match rest.rsplit_once(" · ") {
                Some((a, b)) if is_span(b) => (a.trim(), b.trim()),
                _ => (rest.trim(), ""),
            };
            acts.push(Act {
                id: format!("a{}", acts.len() + 1),
                t: title.to_string(),
                span: span.to_string(),
                beats: Vec::new(),
            });
        } else if let Some(rest) = t.strip_prefix("- ") {
            let Some(act) = acts.last_mut() else { continue };
            let (k, body) = match rest.strip_prefix("**").and_then(|r| r.split_once("**")) {
                Some((k, body)) => (k.trim().to_string(), body.trim().to_string()),
                // 人手写时可能没加粗，宽容一点：第一个空格前当场次键
                None => match rest.split_once(char::is_whitespace) {
                    Some((k, body)) => (k.trim().to_string(), body.trim().to_string()),
                    None => (rest.trim().to_string(), String::new()),
                },
            };
            beat_n += 1;
            act.beats.push(Beat { id: format!("b{beat_n}"), k, t: body });
        }
    }
    acts
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DocBlock {
    pub id: String,
    /// character / outline / text
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    pub body: String,
}

/// 一个剧本块 → 一个 .md 文件。frontmatter 放它的类型与标题，正文原样。
pub fn emit_block(b: &DocBlock) -> String {
    format!(
        "---\ntype: {}\nlabel: {}\n---\n\n{}\n",
        b.kind.trim(),
        b.label.trim(),
        b.body.trim()
    )
}

/// 把一份 Markdown 切成 frontmatter 与正文。
///
/// 只认开头的 `---` 围栏。没有围栏就是整篇都是正文 —— 调用方据此判断
/// 「这份文件有没有元信息」，而不是拿正文去猜。
///
/// 放在 md 而不是 skills：**frontmatter 是 Markdown 的写法**，SKILL.md 和
/// 剧本块都用它。原来它在 skills 里，于是 md 反过来依赖 skills ——
/// 一条方向错了的边，拆包时才会疼。
pub fn split_front(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix("---")?.trim_start_matches(['\r']).strip_prefix('\n')?;
    let end = rest.find("\n---")?;
    let body = rest[end + 4..].trim_start_matches(['\r', '\n']);
    Some((&rest[..end], body))
}

/// 解析一个剧本块。`id` 由调用方按文件名给 —— 与大纲同理，不写进文件。
pub fn parse_block(id: &str, text: &str) -> DocBlock {
    let (front, body) = match split_front(text) {
        Some(x) => x,
        None => return DocBlock { id: id.into(), kind: "text".into(), label: id.into(), body: text.trim().into() },
    };
    let mut kind = "text".to_string();
    let mut label = id.to_string();
    for line in front.lines() {
        if let Some((k, v)) = line.split_once(':') {
            match k.trim() {
                "type" => kind = v.trim().to_string(),
                "label" => label = v.trim().to_string(),
                _ => {}
            }
        }
    }
    DocBlock { id: id.into(), kind, label, body: body.trim().to_string() }
}

/// 文件名：把路径分隔符之类的字符换掉，其余保留 —— 中文文件名是可以的，
/// 用户打开目录时要认得出哪个文件是哪一场。
pub fn safe_name(s: &str) -> String {
    let cleaned: String = s
        .trim()
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0') { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim_matches(['.', ' ']).to_string();
    if cleaned.is_empty() { "未命名".into() } else { cleaned }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<Act> {
        vec![
            Act {
                id: "a1".into(), t: "不会离开的朋友".into(), span: "0:00–1:20".into(),
                beats: vec![
                    Beat { id: "b1".into(), k: "场景1".into(), t: "窗边画猫，光点进入额头".into() },
                    Beat { id: "b2".into(), k: "场景2".into(), t: "蒙太奇：多年陪伴".into() },
                ],
            },
            Act {
                id: "a2".into(), t: "被世界遗忘的猫".into(), span: "1:20–2:30".into(),
                beats: vec![Beat { id: "b3".into(), k: "场景3".into(), t: "年糕生病，雨夜送医".into() }],
            },
        ]
    }

    #[test]
    fn 大纲往返无损() {
        let acts = sample();
        assert_eq!(parse_outline(&emit_outline(&acts)), acts);
    }

    #[test]
    fn 产出的是人能读能改的_markdown() {
        let md = emit_outline(&sample());
        assert!(md.contains("## 不会离开的朋友 · 0:00–1:20"));
        assert!(md.contains("- **场景1** 窗边画猫，光点进入额头"));
        assert!(!md.contains("\"id\""), "不该有 JSON 味的东西漏进来");
    }

    #[test]
    fn 手改过的文件也认_没加粗也能解析() {
        let acts = parse_outline("# 大纲\n\n## 第一幕 · 0:00–1:00\n\n- 场景1 我手写的一场\n");
        assert_eq!(acts[0].beats[0].k, "场景1");
        assert_eq!(acts[0].beats[0].t, "我手写的一场");
    }

    #[test]
    fn 标题里带间隔号但后面不是时间_不当成_span() {
        let acts = parse_outline("## 猫 · 狗 · 鱼\n");
        assert_eq!(acts[0].t, "猫 · 狗 · 鱼");
        assert_eq!(acts[0].span, "");
    }

    #[test]
    fn 没有_span_的幕也能往返() {
        let acts = vec![Act { id: "a1".into(), t: "无名幕".into(), span: String::new(), beats: vec![] }];
        assert_eq!(parse_outline(&emit_outline(&acts)), acts);
    }

    #[test]
    fn id_按位置重生成_跨幕连续() {
        let acts = parse_outline(
            "## 甲\n- **场景1** x\n- **场景2** y\n## 乙\n- **场景3** z\n",
        );
        assert_eq!(acts[0].id, "a1");
        assert_eq!(acts[1].id, "a2");
        let ids: Vec<_> = acts.iter().flat_map(|a| a.beats.iter().map(|b| b.id.clone())).collect();
        assert_eq!(ids, ["b1", "b2", "b3"]);
    }

    #[test]
    fn 场次键在_不写_id_也不影响跨表引用() {
        // Shot.sceneKey 对的是 k，不是 id —— 所以重生成 id 是安全的
        let acts = parse_outline(&emit_outline(&sample()));
        let keys: Vec<_> = acts.iter().flat_map(|a| a.beats.iter().map(|b| b.k.clone())).collect();
        assert_eq!(keys, ["场景1", "场景2", "场景3"]);
    }

    #[test]
    fn 剧本块往返无损() {
        let b = DocBlock {
            id: "d1".into(), kind: "text".into(),
            label: "场景3 · 年糕生病".into(),
            body: "雨很大。\n\n艾米抱着猫跑。".into(),
        };
        assert_eq!(parse_block("d1", &emit_block(&b)), b);
    }

    #[test]
    fn 没有_frontmatter_的_md_当成纯正文_不丢内容() {
        let b = parse_block("d1", "就是一段正文\n第二行");
        assert_eq!(b.body, "就是一段正文\n第二行");
        assert_eq!(b.kind, "text");
    }

    #[test]
    fn 正文里出现_三横线_不会被吃掉() {
        let b = DocBlock {
            id: "d1".into(), kind: "text".into(), label: "分隔".into(),
            body: "上半段\n\n---\n\n下半段".into(),
        };
        assert_eq!(parse_block("d1", &emit_block(&b)).body, b.body);
    }

    #[test]
    fn 文件名去掉路径分隔符_但保留中文() {
        assert_eq!(safe_name("场景3 · 年糕生病"), "场景3 · 年糕生病");
        assert_eq!(safe_name("a/b\\c:d"), "a_b_c_d");
        assert_eq!(safe_name("  ..  "), "未命名");
    }
}
