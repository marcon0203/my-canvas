//! 把生成出来的图/视频下载到项目目录里。
//!
//! # 为什么必须落盘
//!
//! 生成类工具原来只把厂商返回的一串 URL 交上去，磁盘上什么都没有。那有三个后果：
//!
//! 1. **那些 URL 会过期。** 各家的结果链接大多几小时到几天就失效，
//!    过期之后项目里那一镜就成了一个打不开的链接
//! 2. **拼不了片。** 成片要 ffmpeg 读本地文件；让它去拉一串可能已经失效的
//!    远程链接，失败的时机是「等了半天最后一步炸」
//! 3. **花过的钱留不下来。** 出一次视频是真金白银，结果只存了个链接
//!
//! 所以生成完就下载，存进 `<workspace>/projects/<id>/media/`。
//!
//! # 文件名由我们编，不用厂商给的
//!
//! URL 里那段文件名是外部输入 —— 可能带 `../`、可能带路径分隔符、可能是
//! 一个几百字的串。这里的名字全部由调用方按「镜号/资产号 + 序号」生成，
//! 后缀按 `Content-Type` 定。**一个字节都不从 URL 里取。**
//!
//! # 限大小
//!
//! 一个片段封顶 [`MAX_BYTES`]。不限的话，一个返回了错误页面（或者干脆是个
//! 恶意大文件）的链接能把磁盘写满 —— 而这件事发生在后台，用户看不见。

use studio_error::{Error, Result};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// 单个文件封顶 256 MB。
///
/// 比 `web::MAX_BYTES`（2MB，那是读网页正文）大得多：这里下的是视频。
/// 几秒的短视频通常几 MB，256MB 是「明显不对」的那条线。
pub const MAX_BYTES: u64 = 256 * 1024 * 1024;

/// 项目目录下放媒体的子目录
pub const DIR: &str = "media";

pub fn dir(project_dir: &Path) -> PathBuf {
    project_dir.join(DIR)
}

/// 只收 http(s)。挡的是 `file:///etc/passwd` 这类 —— URL 来自厂商响应，
/// 不能当成可信输入
fn check_url(url: &str) -> Result<()> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err(Error::Generate(format!(
            "只从 http/https 下载，给的是「{u}」"
        )));
    }
    Ok(())
}

/// `Content-Type` → 后缀。
///
/// **认不出来就拒**，不要瞎猜一个 `.bin`：认不出来通常意味着拿到的不是媒体
/// （最常见的是厂商回了一个 HTML 错误页），存下来只会在拼片那一步才炸，
/// 而那时候已经看不出是哪一镜的问题了。
pub fn ext_of(content_type: &str) -> Result<&'static str> {
    let t = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    Ok(match t.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/mp4" | "audio/aac" => "m4a",
        other => {
            return Err(Error::Generate(format!(
                "下回来的不是媒体（Content-Type: {other}）—— 多半是厂商返回了一个错误页"
            )));
        }
    })
}

/// 文件名里只留这些字符，其余换成 `-`。
///
/// 名字由调用方生成（镜号、资产号、序号），本来就不该有奇怪字符；
/// 这一层是兜底 —— 万一哪天有人把模型给的字符串传进来，也落不到目录外面去。
pub fn safe_stem(stem: &str) -> String {
    let s: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "x".into() } else { s }
}

/// 下一个文件。`stem` 是不带后缀的名字，后缀由 `Content-Type` 定。
///
/// 返回**项目目录下的相对路径**（`media/s3-1.mp4`），不是绝对路径 ——
/// 项目目录整个搬走之后，记在 `shots.json` 里的路径还得是对的。
pub async fn fetch(
    project_dir: &Path,
    stem: &str,
    url: &str,
    timeout: Duration,
) -> Result<String> {
    check_url(url)?;
    let d = dir(project_dir);
    std::fs::create_dir_all(&d)
        .map_err(|e| Error::Generate(format!("建不了 {}：{e}", d.display())))?;

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| Error::Generate(format!("建不了下载连接：{e}")))?;
    let resp = client
        .get(url.trim())
        .send()
        .await
        .map_err(|e| Error::Generate(format!("下载失败：{e}")))?;
    if !resp.status().is_success() {
        return Err(Error::Generate(format!("下载失败：HTTP {}", resp.status())));
    }

    // Content-Length 先看一眼：能提前拒就别把几百兆下完再拒
    if let Some(n) = resp.content_length()
        && n > MAX_BYTES
    {
        return Err(Error::Generate(format!(
            "文件太大（{} MB），封顶 {} MB",
            n / 1024 / 1024,
            MAX_BYTES / 1024 / 1024
        )));
    }

    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let ext = ext_of(&ct)?;

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| Error::Generate(format!("下载中断：{e}")))?;
    // Content-Length 可能没给或者说谎，收完再核一遍
    if bytes.len() as u64 > MAX_BYTES {
        return Err(Error::Generate(format!(
            "文件太大（{} MB），封顶 {} MB",
            bytes.len() as u64 / 1024 / 1024,
            MAX_BYTES / 1024 / 1024
        )));
    }
    if bytes.is_empty() {
        return Err(Error::Generate("下回来是空的".into()));
    }

    let name = format!("{}.{ext}", safe_stem(stem));
    std::fs::write(d.join(&name), &bytes)
        .map_err(|e| Error::Generate(format!("写不了 {name}：{e}")))?;
    Ok(format!("{DIR}/{name}"))
}

/// 下一批。**一个失败就整批失败** —— 一镜缺一张图，后面的分镜/拼片都对不上，
/// 让它带着一个洞往下走比当场报错难查得多。
///
/// `stem_of` 按序号给名字：一次出 4 张图时是 `s3-1`…`s3-4`。
pub async fn fetch_all(
    project_dir: &Path,
    urls: &[String],
    stem_of: &dyn Fn(usize) -> String,
    timeout: Duration,
) -> Result<Vec<String>> {
    let mut out = Vec::with_capacity(urls.len());
    for (i, u) in urls.iter().enumerate() {
        out.push(fetch(project_dir, &stem_of(i), u, timeout).await?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 只从_http_下载() {
        for bad in ["file:///etc/passwd", "ftp://x/a", "data:image/png;base64,AAA", "/tmp/a.mp4"] {
            assert!(check_url(bad).is_err(), "该挡住：{bad}");
        }
        assert!(check_url("https://x.com/a.mp4").is_ok());
        assert!(check_url(" http://x.com/a.mp4 ").is_ok(), "两边空白要容忍");
    }

    #[test]
    fn 按_content_type_定后缀() {
        for (ct, ext) in [
            ("image/png", "png"),
            ("image/jpeg", "jpg"),
            ("video/mp4", "mp4"),
            ("audio/mpeg", "mp3"),
            // 带参数和大小写都要认
            ("VIDEO/MP4; charset=binary", "mp4"),
            ("image/webp;", "webp"),
        ] {
            assert_eq!(ext_of(ct).unwrap(), ext, "{ct}");
        }
    }

    /// **认不出来就拒，不瞎猜一个 .bin。**
    ///
    /// 认不出来最常见的情况是厂商回了一个 HTML 错误页。存下来只会在拼片那步
    /// 才炸，而那时候已经看不出是哪一镜的问题了。
    #[test]
    fn 不是媒体就当场拒_而不是存个_bin() {
        for ct in ["text/html", "application/json", "", "text/plain"] {
            let e = ext_of(ct).unwrap_err().to_string();
            assert!(e.contains("不是媒体"), "{ct}: {e}");
            assert!(e.contains("错误页"), "要说清最可能的原因：{e}");
        }
    }

    /// 名字全由调用方生成，这一层是兜底 —— 万一有人把模型给的串传进来，
    /// 也落不到目录外面去
    #[test]
    fn 文件名里的路径字符一律洗掉() {
        assert_eq!(safe_stem("../../etc/passwd"), "etc-passwd");
        assert_eq!(safe_stem("a/b\\c"), "a-b-c");
        assert_eq!(safe_stem("s3-1"), "s3-1");
        assert_eq!(safe_stem("角色_a1"), "角色_a1");
        assert_eq!(safe_stem(""), "x", "空名字要有个兜底");
        assert_eq!(safe_stem("///"), "x");
        assert_eq!(safe_stem(".."), "x");
    }
}

/// 对着一个假厂商真下一遍。
///
/// 这一组验的是纯函数验不到的那半：Content-Type 真的被读了、超大真的被拒了、
/// 落盘的路径真的是项目目录下的相对路径。
#[cfg(test)]
mod http_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// 假厂商的回法
    #[derive(Clone, Copy)]
    enum Mode {
        /// 一个正常的 mp4
        Mp4,
        /// 回一个 HTML 错误页（厂商出错时的常见形状）
        ErrorPage,
        /// Content-Length 说自己很大
        TooBig,
        /// Content-Length 不说，但真的下来很大
        LyingSize,
        Empty,
        NotFound,
    }

    async fn server(mode: Mode) -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = l.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = sock.read(&mut buf).await;
                    let (status, ct, body): (u16, &str, Vec<u8>) = match mode {
                        Mode::Mp4 => (200, "video/mp4", b"\x00\x00\x00\x18ftypmp42fake".to_vec()),
                        Mode::ErrorPage => (
                            200,
                            "text/html; charset=utf-8",
                            b"<html><body>quota exceeded</body></html>".to_vec(),
                        ),
                        Mode::TooBig => (200, "video/mp4", b"x".to_vec()),
                        Mode::LyingSize => {
                            (200, "video/mp4", vec![b'x'; (MAX_BYTES + 16) as usize])
                        }
                        Mode::Empty => (200, "video/mp4", Vec::new()),
                        Mode::NotFound => (404, "text/plain", b"no".to_vec()),
                    };
                    // TooBig 那一档：Content-Length 谎报成超限，body 只有一个字节 ——
                    // 验的是「提前拒，不把几百兆下完」
                    let len = if matches!(mode, Mode::TooBig) {
                        MAX_BYTES + 1
                    } else {
                        body.len() as u64
                    };
                    let head = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: {ct}\r\nContent-Length: {len}\r\n\
                         Connection: close\r\n\r\n"
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(&body).await;
                    let _ = sock.flush().await;
                });
            }
        });
        format!("http://{addr}/r.mp4")
    }

    const T: Duration = Duration::from_secs(10);

    #[tokio::test]
    async fn 下回来存进项目的_media_目录_返回相对路径() {
        let t = tempfile::TempDir::new().unwrap();
        let url = server(Mode::Mp4).await;
        let got = fetch(t.path(), "s3-1", &url, T).await.unwrap();

        // **相对路径**：项目目录整个搬走之后，shots.json 里记的路径还得是对的
        assert_eq!(got, "media/s3-1.mp4");
        assert!(!got.starts_with('/'), "不能是绝对路径：{got}");
        let f = t.path().join(&got);
        assert!(f.exists(), "{}", f.display());
        assert!(std::fs::metadata(&f).unwrap().len() > 0);
    }

    /// **后缀按 Content-Type 定，不从 URL 里取。**
    /// URL 那段是外部输入，而且常常根本没有后缀（签名链接）
    #[tokio::test]
    async fn 后缀按响应头定_不看_url() {
        let t = tempfile::TempDir::new().unwrap();
        let base = server(Mode::Mp4).await;
        // URL 说自己是 .png，响应头说是 video/mp4 —— 听响应头的
        let url = base.replace("/r.mp4", "/r.png?sig=abc");
        let got = fetch(t.path(), "s1", &url, T).await.unwrap();
        assert_eq!(got, "media/s1.mp4");
    }

    #[tokio::test]
    async fn 厂商回了错误页时当场说清_不存下来() {
        let t = tempfile::TempDir::new().unwrap();
        let url = server(Mode::ErrorPage).await;
        let e = fetch(t.path(), "s1", &url, T).await.unwrap_err().to_string();
        assert!(e.contains("不是媒体"), "{e}");
        assert!(!dir(t.path()).join("s1.html").exists(), "不该存下来");
    }

    #[tokio::test]
    async fn 谎报的大小也拦得住() {
        let t = tempfile::TempDir::new().unwrap();
        // Content-Length 说超限 → 提前拒
        let e = fetch(t.path(), "s1", &server(Mode::TooBig).await, T).await.unwrap_err();
        assert!(e.to_string().contains("太大"), "{e}");
        // Content-Length 没说实话 → 收完再核一遍
        let e = fetch(t.path(), "s2", &server(Mode::LyingSize).await, T).await.unwrap_err();
        assert!(e.to_string().contains("太大"), "{e}");
        assert!(!dir(t.path()).join("s2.mp4").exists(), "超限的不该留在磁盘上");
    }

    #[tokio::test]
    async fn 空响应和_404_都如实报() {
        let t = tempfile::TempDir::new().unwrap();
        let e = fetch(t.path(), "s1", &server(Mode::Empty).await, T).await.unwrap_err();
        assert!(e.to_string().contains("空"), "{e}");
        let e = fetch(t.path(), "s2", &server(Mode::NotFound).await, T).await.unwrap_err();
        assert!(e.to_string().contains("404"), "要带上状态码：{e}");
    }

    /// 一次出 4 张图时名字要分得开
    #[tokio::test]
    async fn 一批下来名字按序号分开() {
        let t = tempfile::TempDir::new().unwrap();
        let url = server(Mode::Mp4).await;
        let urls = vec![url.clone(), url.clone(), url];
        let got = fetch_all(t.path(), &urls, &|i| format!("s3-{}", i + 1), T).await.unwrap();
        assert_eq!(got, ["media/s3-1.mp4", "media/s3-2.mp4", "media/s3-3.mp4"]);
        for g in &got {
            assert!(t.path().join(g).exists(), "{g}");
        }
    }

    /// **一个失败就整批失败。** 带着一个洞往下走，后面的分镜和拼片都对不上，
    /// 而那时候已经看不出是哪一步少了东西
    #[tokio::test]
    async fn 一批里有一个失败就整批失败() {
        let t = tempfile::TempDir::new().unwrap();
        let ok = server(Mode::Mp4).await;
        let bad = server(Mode::ErrorPage).await;
        let e = fetch_all(t.path(), &[ok, bad], &|i| format!("s{i}"), T).await.unwrap_err();
        assert!(e.to_string().contains("不是媒体"), "{e}");
    }
}
