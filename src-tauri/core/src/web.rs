//! 读网页：把一个网址的正文取回来，交给模型读。
//!
//! # 这里的每条限制都是为了「别把模型的上下文喂坏」
//!
//! 一个网页取回来可能是几百 KB 的 HTML，里面 90% 是脚本、样式、导航和广告。
//! 原样塞进上下文的后果不是报错，是**模型开始回答网页里的无关内容** ——
//! 那种错很难看出来，因为它看起来像是模型自己糊了。
//!
//! 所以：只收 http(s)、限响应体大小、剥掉 script/style、再限正文长度，
//! 截断了就如实说截断了。
//!
//! # 这是出网工具
//!
//! 风险档是 `Egress`，永远要人点头（见 `policy::auto_allowed`）——
//! 网址可能是模型从别处读来的，而请求一发出去就带上了这台机器的 IP。

use crate::error::{Error, Result};
use serde_json::{Value, json};
use std::time::Duration;

/// 响应体上限。超了就截断读，不整份收 —— 一个几十 MB 的页面能把内存吃光
pub const MAX_BYTES: usize = 2 * 1024 * 1024;

/// 交给模型的正文上限（字符）。**按字符不按字节**：一个中文字三字节，
/// 按字节截会把字切成一半，输出里出现乱码
pub const MAX_CHARS: usize = 40_000;

/// 只收这两种协议。
///
/// 挡的不是拼写错误，是 `file:///etc/passwd` 和 `http://169.254.169.254/`
/// 这类东西：网址常常是模型从某个页面里读来的，不能当成可信输入。
fn check_url(url: &str) -> Result<()> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err(Error::Store(format!(
            "只读 http/https 的网址，给的是「{u}」—— file:// 之类的本地路径不从这儿读"
        )));
    }
    if u.len() < 12 {
        return Err(Error::Store(format!("网址不完整：{u}")));
    }
    Ok(())
}

/// HTML → 正文。
///
/// 手写而不是引一个 HTML 解析库：这里要的不是正确的 DOM，是「把看得见的字
/// 留下」。script/style 的内容必须整段丢掉 —— 那里面的 JS 字符串混进正文，
/// 模型会把它当成页面在说的话。
pub fn text_of_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 4);
    let mut i = 0;

    // 整段跳过的标签：里面的内容不是给人看的。**必须整段丢** ——
    // script 里的 JS 字符串混进正文，模型会把它当成页面在说的话
    const SKIP: &[(&str, &str)] = &[
        ("<script", "</script>"),
        ("<style", "</style>"),
        ("<head", "</head>"),
        ("<noscript", "</noscript>"),
        ("<svg", "</svg>"),
        ("<!--", "-->"),
    ];
    // 块级标签换行，行内标签只当空格 —— 段落粘成一坨读起来更糟
    const BREAKS: &[&str] = &[
        "<p", "</p", "<br", "<div", "</div", "<li", "</li", "<tr", "</tr", "</table",
        "<h1", "<h2", "<h3", "<h4", "</h1", "</h2", "</h3", "</h4",
    ];

    while i < html.len() {
        let rest = &html[i..];
        if !rest.starts_with('<') {
            let ch = rest.chars().next().unwrap_or(' ');
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        // 按字符取前缀，不按字节：`&rest[..16]` 会切在多字节字符中间直接 panic
        let lower: String = rest.chars().take(16).flat_map(char::to_lowercase).collect();

        if let Some((_, close)) = SKIP.iter().find(|(open, _)| lower.starts_with(open)) {
            // 没有闭合标签时丢掉剩下全部 —— 半截 script 更不该进正文
            let end = rest.to_ascii_lowercase().find(close).map(|p| p + close.len());
            i += end.unwrap_or(rest.len());
            continue;
        }

        out.push(if BREAKS.iter().any(|t| lower.starts_with(t)) { '\n' } else { ' ' });
        // 找不到 `>` 说明标签没闭合，后面整段丢掉
        i += rest.find('>').map(|p| p + 1).unwrap_or(rest.len());
    }

    // 只解常见这几个。全套实体表没必要 —— 剩下的原样留着也读得懂
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    // 压空白：HTML 里的缩进会变成成片的空格，白占上下文
    let mut lines: Vec<String> = Vec::new();
    for raw in out.lines() {
        let line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            continue;
        }
        lines.push(line);
    }
    lines.join("\n")
}

/// 取一个网址的正文。
pub async fn fetch(url: &str, timeout: Duration) -> Result<Value> {
    check_url(url)?;
    let client = reqwest::Client::builder()
        .timeout(timeout)
        // 重定向跟随有上限：跟着一条无限重定向能一直转下去
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| Error::Store(format!("建 HTTP 客户端失败：{e}")))?;

    let resp = client
        .get(url.trim())
        .header("accept", "text/html,text/plain;q=0.9,*/*;q=0.1")
        .send()
        .await
        .map_err(|e| Error::Store(format!("取不到这个网址：{e}")))?;

    let status = resp.status();
    let final_url = resp.url().to_string();
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !status.is_success() {
        return Err(Error::Store(format!("{final_url} 返回 HTTP {status}")));
    }
    // 图片、压缩包、PDF：取回来也读不了，别浪费一次下载
    let readable = ctype.is_empty()
        || ctype.starts_with("text/")
        || ctype.contains("json")
        || ctype.contains("xml");
    if !readable {
        return Err(Error::Store(format!(
            "{final_url} 是 {ctype} —— 这个工具只读文本网页"
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| Error::Store(format!("读响应失败：{e}")))?;
    let truncated_bytes = bytes.len() > MAX_BYTES;
    let slice = &bytes[..bytes.len().min(MAX_BYTES)];
    // 截断可能切在多字节字符中间，from_utf8_lossy 不会因此失败
    let raw = String::from_utf8_lossy(slice);

    let text = if ctype.starts_with("text/plain") || ctype.contains("json") {
        raw.trim().to_string()
    } else {
        text_of_html(&raw)
    };

    let total = text.chars().count();
    let cut = total > MAX_CHARS;
    let body: String = if cut { text.chars().take(MAX_CHARS).collect() } else { text };

    Ok(json!({
        "url": final_url,
        "contentType": ctype,
        "chars": body.chars().count(),
        "text": body,
        // 截断了要说 —— 模型据此知道「后面还有」，而不是当成读完了
        "truncated": cut || truncated_bytes,
        "note": if cut || truncated_bytes {
            format!("正文超过 {MAX_CHARS} 字或响应超过 {}MB，只取了前一段", MAX_BYTES / 1024 / 1024)
        } else {
            String::new()
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 只收_http_与_https() {
        for bad in ["file:///etc/passwd", "ftp://x/y", "javascript:alert(1)", "/etc/passwd"] {
            let e = check_url(bad).unwrap_err();
            assert!(e.to_string().contains("http"), "{bad}: {e}");
        }
        assert!(check_url("https://example.com/a").is_ok());
        assert!(check_url(" http://example.com ").is_ok(), "两边空白要容忍");
    }

    #[test]
    fn 脚本与样式整段丢掉_不能混进正文() {
        let html = r#"<html><head><title>T</title><style>.a{color:red}</style></head>
            <body><script>var s="这句是 JS 里的字符串";</script><p>正文一</p><p>正文二</p></body></html>"#;
        let t = text_of_html(html);
        assert!(t.contains("正文一") && t.contains("正文二"));
        assert!(!t.contains("JS 里的字符串"), "JS 字符串混进正文了：{t}");
        assert!(!t.contains("color:red"));
        assert!(!t.contains("<"), "还留着标签：{t}");
    }

    #[test]
    fn 没闭合的_script_丢掉剩下全部_而不是当正文() {
        let t = text_of_html("<p>前面</p><script>var x = 1; 后面全是脚本");
        assert!(t.contains("前面"));
        assert!(!t.contains("var x"));
    }

    #[test]
    fn 块级标签换行_行内标签当空格() {
        let t = text_of_html("<p>第一段</p><p>第二段</p><span>同</span><b>一行</b>");
        let lines: Vec<&str> = t.lines().collect();
        assert_eq!(lines[0], "第一段");
        assert_eq!(lines[1], "第二段");
        assert!(lines[2].contains("同") && lines[2].contains("一行"));
    }

    #[test]
    fn 压掉缩进空白_不白占上下文() {
        let t = text_of_html("<p>   a     b   </p>\n\n\n<p>c</p>");
        assert_eq!(t, "a b\nc");
    }

    #[test]
    fn 常见实体解开() {
        assert_eq!(text_of_html("<p>a&nbsp;&amp;&lt;b&gt;</p>"), "a &<b>");
    }

    #[test]
    fn 注释不进正文() {
        let t = text_of_html("<p>看得见</p><!-- 看不见的注释 -->");
        assert!(t.contains("看得见"));
        assert!(!t.contains("注释"));
    }
}

/// 拿真 HTTP 跑一遍。
///
/// 纯函数测得再全，也测不到「非文本类型会不会白下载一遍」「截断标记到底有没有
/// 打上」这些只在真跑起来才暴露的问题。localhost 不走代理，所以这里能起个
/// 假服务真发请求。
#[cfg(test)]
mod http_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// 起一个按路径返回不同东西的假站点，返回它的 base_url
    async fn site() -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = l.accept().await {
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 2048];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();

                    let (status, ctype, body) = match path.as_str() {
                        "/page" => (200, "text/html; charset=utf-8",
                            "<html><head><style>x{}</style></head><body><p>标题</p>\
                             <script>var a=1</script><p>正文在这里</p></body></html>".to_string()),
                        "/plain" => (200, "text/plain", "就是一段纯文本".to_string()),
                        "/big" => (200, "text/html",
                            format!("<p>{}</p>", "字".repeat(MAX_CHARS + 500))),
                        "/img" => (200, "image/png", "\u{fffd}PNG…".to_string()),
                        "/404" => (404, "text/html", "<p>没有这个页面</p>".to_string()),
                        _ => (200, "text/html", "<p>ok</p>".to_string()),
                    };
                    let head = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(body.as_bytes()).await;
                    let _ = sock.flush().await;
                });
            }
        });
        format!("http://{addr}")
    }

    fn t() -> Duration {
        Duration::from_secs(5)
    }

    #[tokio::test]
    async fn 取回正文_剥掉脚本样式() {
        let base = site().await;
        let v = fetch(&format!("{base}/page"), t()).await.unwrap();
        let text = v["text"].as_str().unwrap();
        assert!(text.contains("正文在这里"));
        assert!(!text.contains("var a=1"), "脚本进正文了：{text}");
        assert_eq!(v["truncated"], false);
        assert!(v["chars"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn 纯文本不走_html_剥离() {
        let base = site().await;
        let v = fetch(&format!("{base}/plain"), t()).await.unwrap();
        assert_eq!(v["text"], "就是一段纯文本");
    }

    #[tokio::test]
    async fn 超长正文截断并如实标出来() {
        let base = site().await;
        let v = fetch(&format!("{base}/big"), t()).await.unwrap();
        assert_eq!(v["truncated"], true);
        // 截断了要说 —— 模型据此知道「后面还有」，而不是当成读完了
        assert!(v["note"].as_str().unwrap().contains("只取了前一段"));
        assert!(v["chars"].as_u64().unwrap() <= MAX_CHARS as u64);
        // 按字符截，不按字节：按字节会把一个中文切成一半，输出里就是乱码
        assert!(!v["text"].as_str().unwrap().contains('\u{fffd}'));
    }

    #[tokio::test]
    async fn 图片这类读不了的类型直接说_不当成正文() {
        let base = site().await;
        let e = fetch(&format!("{base}/img"), t()).await.unwrap_err();
        assert!(e.to_string().contains("只读文本网页"), "{e}");
    }

    #[tokio::test]
    async fn 非_2xx_报出状态码_而不是把错误页当正文() {
        let base = site().await;
        let e = fetch(&format!("{base}/404"), t()).await.unwrap_err();
        assert!(e.to_string().contains("404"), "{e}");
        assert!(!e.to_string().contains("没有这个页面"), "把错误页正文当成结果了");
    }

    #[tokio::test]
    async fn 连不上时报错_不挂死() {
        // 一个没人监听的端口
        let e = fetch("http://127.0.0.1:1/x", Duration::from_millis(500)).await.unwrap_err();
        assert!(e.to_string().contains("取不到"), "{e}");
    }
}
