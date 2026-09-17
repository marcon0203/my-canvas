//! 异步任务协议：出图/出视频/配音都走这套。
//!
//! 文本走 OpenAI 兼容的 /chat/completions，Rig 管；**图片视频音频不是**——
//! 各家都是「提交拿 task_id → 轮询 → 拿结果 URL」，Rig 不碰这层，要自己写。
//!
//! # 这里分成两半，边界很重要
//!
//! - **协议机制**（提交、轮询、退避、超时、取消、错误分类）与厂商无关，
//!   纯函数 + 本地 mock server 真测过。
//! - **厂商字段映射**（task_id 在响应的哪个字段、status 有哪些取值）
//!   是一张数据表。**表里的值没有对过真实文档**——见 `adapters` 模块上的说明。
//!
//! 这么分是因为：机制写错了很难发现（超时、重试风暴、取消泄漏），
//! 字段写错了第一次调用就报错，一看就知道，改一行就好。

use crate::error::{Error, Result};
use serde_json::Value;
use std::time::Duration;

/// 一家厂商的异步任务接口长什么样。字段用点号路径，如 `data.task_id`。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskApi {
    /// 提交任务，POST 到 `{base_url}{submit_path}`
    pub submit_path: String,
    /// 轮询，GET `{base_url}{poll_path}`，其中 `{id}` 会被替换成 task_id
    pub poll_path: String,
    /// 提交响应里 task_id 的位置
    pub id_at: String,
    /// 轮询响应里状态的位置
    pub status_at: String,
    /// 哪些状态算成功 / 失败（其余一律当成还在跑）
    pub done_when: Vec<String>,
    pub failed_when: Vec<String>,
    /// 结果 URL 数组的位置
    pub urls_at: String,
    /// 失败原因的位置
    pub error_at: String,
}

/// 按点号路径取值。`data.task_id` → json["data"]["task_id"]
fn at<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.').try_fold(v, |cur, k| cur.get(k))
}

fn text_at(v: &Value, path: &str) -> Option<String> {
    at(v, path).and_then(|x| match x {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub enum TaskState {
    Running,
    Done { urls: Vec<String> },
    Failed { why: String },
}

/// 提交响应 → task_id。**拿不到 id 就立刻失败**，不要带着空 id 去轮询 ——
/// 那会变成一个永远 Running 的任务，把配额和时间都耗掉。
pub fn parse_submit(api: &TaskApi, body: &Value) -> Result<String> {
    match text_at(body, &api.id_at) {
        Some(id) if !id.trim().is_empty() => Ok(id),
        _ => {
            // 有些厂商提交失败也回 200，错误在 body 里
            let why = text_at(body, &api.error_at).unwrap_or_else(|| body.to_string());
            Err(Error::Generate(format!("提交没拿到任务号：{why}")))
        }
    }
}

/// 轮询响应 → 状态。
///
/// **不认识的状态一律当成还在跑**，而不是当成失败：厂商加一个中间状态
/// （比如 `queued` 之外又来个 `throttled`）不该让已经提交的任务被判死。
/// 超时由调用方的总时限兜底。
pub fn parse_poll(api: &TaskApi, body: &Value) -> TaskState {
    let st = text_at(body, &api.status_at).unwrap_or_default().to_lowercase();
    let hit = |list: &[String]| list.iter().any(|s| s.to_lowercase() == st);

    if hit(&api.failed_when) {
        let why = text_at(body, &api.error_at).unwrap_or_else(|| "厂商没说原因".into());
        return TaskState::Failed { why };
    }
    if hit(&api.done_when) {
        let urls = at(body, &api.urls_at)
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|x| match x {
                        Value::String(s) => Some(s.clone()),
                        // 有些厂商回的是 [{url: "..."}]
                        Value::Object(_) => x.get("url").and_then(Value::as_str).map(str::to_string),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if urls.is_empty() {
            return TaskState::Failed { why: "状态是成功但没给结果 URL".into() };
        }
        return TaskState::Done { urls };
    }
    TaskState::Running
}

/// 轮询间隔：指数退避，封顶 8 秒。
///
/// 不用固定间隔：出图几秒就好，出视频要几分钟。固定 1 秒的话，
/// 一个三分钟的视频任务要打接口一百八十次 —— 对方会限流，也是白烧配额。
pub fn backoff(attempt: u32) -> Duration {
    let ms = 800u64.saturating_mul(1 << attempt.min(4)); // 0.8 1.6 3.2 6.4 12.8→封顶
    Duration::from_millis(ms.min(8_000))
}

/// 一次生成请求。`body` 由厂商适配器拼好，这里只负责跑完协议。
pub struct Job<'a> {
    pub api: &'a TaskApi,
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub body: Value,
    /// 总时限。到点就放弃并报出来，不要无限等
    pub timeout: Duration,
}

/// 跑完一次异步任务。
///
/// 错误分两类：**任务失败不重试**（重试一次还是失败，白花钱），
/// **网络抖动可以重试**（下一轮轮询自然就重试了）。
pub async fn run(job: Job<'_>, cancel: impl Fn() -> bool) -> Result<Vec<String>> {
    let client = reqwest::Client::new();
    let submit_url = format!("{}{}", job.base_url.trim_end_matches('/'), job.api.submit_path);

    let resp = client
        .post(&submit_url)
        .bearer_auth(job.api_key)
        .json(&job.body)
        .send()
        .await
        .map_err(|e| Error::Generate(format!("提交失败：{e}")))?;
    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| Error::Generate(format!("提交响应不是 JSON（HTTP {status}）：{e}")))?;
    if !status.is_success() {
        let why = text_at(&body, &job.api.error_at).unwrap_or_else(|| body.to_string());
        return Err(Error::Generate(format!("提交被拒（HTTP {status}）：{why}")));
    }
    let id = parse_submit(job.api, &body)?;

    let deadline = std::time::Instant::now() + job.timeout;
    let mut attempt = 0u32;
    loop {
        if cancel() {
            return Err(Error::Generate("已取消".into()));
        }
        if std::time::Instant::now() >= deadline {
            return Err(Error::Generate(format!(
                "等了 {} 秒还没跑完，先不等了 —— 任务 {id} 可能还在厂商那边跑",
                job.timeout.as_secs()
            )));
        }
        tokio::time::sleep(backoff(attempt)).await;
        attempt += 1;

        let poll_url = format!(
            "{}{}",
            job.base_url.trim_end_matches('/'),
            job.api.poll_path.replace("{id}", &id)
        );
        let r = client.get(&poll_url).bearer_auth(job.api_key).send().await;
        let Ok(r) = r else { continue };          // 网络抖一下，下一轮再来
        let Ok(body) = r.json::<Value>().await else { continue };

        match parse_poll(job.api, &body) {
            TaskState::Running => continue,
            TaskState::Done { urls } => return Ok(urls),
            TaskState::Failed { why } => {
                return Err(Error::Generate(format!("任务失败：{why}")));
            }
        }
    }
}

/// 厂商适配表。
///
/// # ⚠️ 这张表里的字段路径没有对过真实文档
///
/// 写这部分时这台机器的出网被策略挡住（CONNECT 403），核不了各家的接口文档。
/// 所以：**接第一家时要拿真 key 调一次，照报错把下面的路径改对**。
/// 改的是数据不是逻辑，一般就一两行。
///
/// 上面的协议机制（提交/轮询/退避/超时/取消/错误分类）是与厂商无关的，
/// 那部分用本地 mock server 真跑过。
pub mod adapters {
    use super::TaskApi;

    fn s(v: &str) -> String {
        v.to_string()
    }

    /// 火山方舟。⚠️ 未核对
    pub fn volcengine_image() -> TaskApi {
        TaskApi {
            submit_path: s("/images/generations"),
            poll_path: s("/images/generations/{id}"),
            id_at: s("id"),
            status_at: s("status"),
            done_when: vec![s("succeeded"), s("success")],
            failed_when: vec![s("failed"), s("error")],
            urls_at: s("data"),
            error_at: s("error.message"),
        }
    }

    /// 智谱。⚠️ 未核对
    pub fn zhipu_image() -> TaskApi {
        TaskApi {
            submit_path: s("/images/generations"),
            poll_path: s("/async-result/{id}"),
            id_at: s("id"),
            status_at: s("task_status"),
            done_when: vec![s("success")],
            failed_when: vec![s("fail")],
            urls_at: s("data"),
            error_at: s("error.message"),
        }
    }

    /// 同一家的其它操作：**只有提交路径不一样**，轮询与字段位置跟着基础那份走。
    ///
    /// 这么做不是偷懒：各家的改图/放大/续接都挂在同一套任务系统下，
    /// 轮询接口是同一个。真要是哪家不是这样，改的也只是这里一行。
    fn with_path(base: TaskApi, path: &str) -> TaskApi {
        TaskApi { submit_path: s(path), ..base }
    }

    /// 工具 → 该家的接口。**按工具查而不是按模态**：改图和出图是同一个模态，
    /// 但提交路径不同 —— 按模态查会把改图发到出图的接口上。
    ///
    /// 返回 None = 这家这个操作还没适配。调用方要如实说「这家还不支持」，
    /// 不要退回成一个「差不多的」接口：那会把请求发到错的地方。
    pub fn of(provider: &str, tool: &str) -> Option<TaskApi> {
        let base = match provider {
            "volcengine" => volcengine_image(),
            "zhipu" => zhipu_image(),
            _ => return None,
        };
        // ⚠️ 这些路径同样没对过真实文档，与上面那两份一起改
        Some(match tool {
            "image.generate" => base,
            "image.edit" => with_path(base, "/images/edits"),
            "image.upscale" => with_path(base, "/images/upscale"),
            "video.generate" => with_path(base, "/videos/generations"),
            "video.extend" => with_path(base, "/videos/extend"),
            // 音乐与音效也是「提交 → 轮询 → 拿 URL」那一套，能共用这套协议。
            // 配音（audio.tts）**不在这里** —— 它多数是同步返回音频字节，
            // 不是异步任务，硬套这套协议只会拿到一个永远轮询不到的任务号。
            "audio.music" => with_path(base, "/audio/music"),
            "audio.sfx" => with_path(base, "/audio/sfx"),
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn api() -> TaskApi {
        TaskApi {
            submit_path: "/gen".into(),
            poll_path: "/gen/{id}".into(),
            id_at: "data.task_id".into(),
            status_at: "data.status".into(),
            done_when: vec!["succeeded".into()],
            failed_when: vec!["failed".into()],
            urls_at: "data.urls".into(),
            error_at: "error.message".into(),
        }
    }

    #[test]
    fn 按点号路径取_task_id() {
        let id = parse_submit(&api(), &json!({ "data": { "task_id": "t-1" } })).unwrap();
        assert_eq!(id, "t-1");
    }

    #[test]
    fn 数字形式的_id_也认() {
        assert_eq!(parse_submit(&api(), &json!({ "data": { "task_id": 42 } })).unwrap(), "42");
    }

    #[test]
    fn 拿不到_id_立刻失败_不带着空_id_去轮询() {
        // 带空 id 轮询会变成一个永远 Running 的任务，把配额和时间都耗掉
        let e = parse_submit(&api(), &json!({ "error": { "message": "余额不足" } })).unwrap_err();
        assert!(e.to_string().contains("余额不足"));
        let e = parse_submit(&api(), &json!({ "data": { "task_id": "  " } })).unwrap_err();
        assert!(e.to_string().contains("没拿到任务号"));
    }

    #[test]
    fn 成功状态取出结果_url() {
        let st = parse_poll(&api(), &json!({
            "data": { "status": "succeeded", "urls": ["http://a/1.png", "http://a/2.png"] }
        }));
        assert_eq!(st, TaskState::Done { urls: vec!["http://a/1.png".into(), "http://a/2.png".into()] });
    }

    #[test]
    fn 结果是对象数组时取_url_字段_各家形状不一样() {
        let st = parse_poll(&api(), &json!({
            "data": { "status": "succeeded", "urls": [{ "url": "http://a/1.png" }] }
        }));
        assert_eq!(st, TaskState::Done { urls: vec!["http://a/1.png".into()] });
    }

    #[test]
    fn 状态大小写不敏感() {
        let st = parse_poll(&api(), &json!({ "data": { "status": "SUCCEEDED", "urls": ["x"] } }));
        assert!(matches!(st, TaskState::Done { .. }));
    }

    #[test]
    fn 说成功却没给_url_算失败_不要返回空结果() {
        let st = parse_poll(&api(), &json!({ "data": { "status": "succeeded", "urls": [] } }));
        assert!(matches!(st, TaskState::Failed { .. }));
    }

    #[test]
    fn 失败时带出厂商给的原因() {
        let st = parse_poll(&api(), &json!({
            "data": { "status": "failed" }, "error": { "message": "提示词违规" }
        }));
        assert_eq!(st, TaskState::Failed { why: "提示词违规".into() });
    }

    #[test]
    fn 失败但厂商没说原因时也说得出话() {
        let st = parse_poll(&api(), &json!({ "data": { "status": "failed" } }));
        assert!(matches!(st, TaskState::Failed { why } if why.contains("没说原因")));
    }

    #[test]
    fn 不认识的状态当成还在跑_不判死已提交的任务() {
        // 厂商加一个中间状态不该让任务被判失败，超时由总时限兜底
        for s in ["queued", "throttled", "pending", ""] {
            let st = parse_poll(&api(), &json!({ "data": { "status": s } }));
            assert_eq!(st, TaskState::Running, "{s}");
        }
    }

    #[test]
    fn 退避是指数的_并且封顶() {
        let ms: Vec<u64> = (0..7).map(|i| backoff(i).as_millis() as u64).collect();
        assert_eq!(&ms[..4], &[800, 1600, 3200, 6400]);
        assert!(ms.iter().all(|&x| x <= 8000), "要封顶，否则长任务等太久");
        // 递增，不能忽大忽小
        assert!(ms.windows(2).all(|w| w[1] >= w[0]));
    }

    #[test]
    fn 三分钟的视频任务不会打接口上百次() {
        // 固定 1 秒间隔要 180 次；退避之后应该在几十次以内
        let mut total = Duration::ZERO;
        let mut n = 0;
        while total < Duration::from_secs(180) {
            total += backoff(n);
            n += 1;
        }
        assert!(n < 40, "180 秒内轮询了 {n} 次，太多了");
    }

    #[test]
    fn 适配表认得出已登记的厂商() {
        assert!(adapters::of("volcengine", "image.generate").is_some());
        assert!(adapters::of("zhipu", "video.generate").is_some());
        assert!(adapters::of("deepseek", "image.generate").is_none(), "DeepSeek 没有图片模型");
    }

    #[test]
    fn 按工具查而不是按模态_改图和出图不能发到同一个路径() {
        // 按模态查的话，改图会被发到出图的接口上 —— 参数对不上，白花一次
        let g = adapters::of("volcengine", "image.generate").unwrap();
        let e = adapters::of("volcengine", "image.edit").unwrap();
        assert_ne!(g.submit_path, e.submit_path);
        // 轮询走同一套任务系统，所以字段位置应当一致
        assert_eq!(g.poll_path, e.poll_path);
        assert_eq!(g.id_at, e.id_at);
    }

    #[test]
    fn 配音不走异步任务协议_适配表里就不该有它() {
        // TTS 多数是同步返回音频字节。硬套这套协议只会拿到一个
        // 永远轮询不到的任务号 —— 宁可如实说「这家还没适配」
        assert!(adapters::of("volcengine", "audio.tts").is_none());
        assert!(adapters::of("volcengine", "audio.music").is_some());
        assert!(adapters::of("volcengine", "audio.sfx").is_some());
    }

    #[test]
    fn 没适配的操作返回_none_而不是退回成一个差不多的接口() {
        assert!(adapters::of("volcengine", "web.search").is_none());
        assert!(adapters::of("volcengine", "").is_none());
    }
}

/// 拿真 HTTP 跑一遍。
///
/// 纯函数测得再全，也测不到「轮询循环会不会漏掉取消」「超时到底生不生效」
/// 这些只在真跑起来才暴露的问题。localhost 不走代理，所以这里能起个
/// 最小 HTTP server 真测 —— 手写响应而不是引一个 mock 框架，四十行的事。
#[cfg(test)]
mod http_tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// 起一个假的厂商：提交回 task_id，前 `running_rounds` 次轮询回「还在跑」，
    /// 之后回 `final_body`。返回 base_url 与「被轮询了几次」。
    async fn fake_provider(running_rounds: u32, final_body: Value) -> (String, Arc<AtomicU32>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let polls = Arc::new(AtomicU32::new(0));
        let counter = polls.clone();

        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let counter = counter.clone();
                let final_body = final_body.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let body = if req.starts_with("POST") {
                        json!({ "data": { "task_id": "t-1" } })
                    } else {
                        let k = counter.fetch_add(1, Ordering::SeqCst);
                        if k < running_rounds {
                            json!({ "data": { "status": "queued" } })
                        } else {
                            final_body.clone()
                        }
                    };
                    let s = body.to_string();
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        s.len(), s
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.flush().await;
                });
            }
        });
        (format!("http://{addr}"), polls)
    }

    fn api() -> TaskApi {
        TaskApi {
            submit_path: "/gen".into(), poll_path: "/gen/{id}".into(),
            id_at: "data.task_id".into(), status_at: "data.status".into(),
            done_when: vec!["succeeded".into()], failed_when: vec!["failed".into()],
            urls_at: "data.urls".into(), error_at: "error.message".into(),
        }
    }

    #[tokio::test]
    async fn 提交后轮询到成功_拿回结果() {
        let (base, polls) = fake_provider(
            2,
            json!({ "data": { "status": "succeeded", "urls": ["http://x/1.png"] } }),
        ).await;
        let a = api();
        let urls = run(Job {
            api: &a, base_url: &base, api_key: "k", body: json!({ "prompt": "cat" }),
            timeout: Duration::from_secs(30),
        }, || false).await.unwrap();
        assert_eq!(urls, ["http://x/1.png"]);
        assert_eq!(polls.load(Ordering::SeqCst), 3, "两次还在跑 + 一次成功");
    }

    #[tokio::test]
    async fn 任务失败时带出原因_并且不重试() {
        let (base, polls) = fake_provider(
            0,
            json!({ "data": { "status": "failed" }, "error": { "message": "提示词违规" } }),
        ).await;
        let a = api();
        let e = run(Job {
            api: &a, base_url: &base, api_key: "k", body: json!({}),
            timeout: Duration::from_secs(30),
        }, || false).await.unwrap_err();
        assert!(e.to_string().contains("提示词违规"));
        // 失败不重试 —— 重试一次还是失败，白花钱
        assert_eq!(polls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn 取消之后就不再轮询了_不泄漏一个跑到天荒地老的循环() {
        let (base, polls) = fake_provider(999, json!({})).await;
        let cancelled = Arc::new(AtomicBool::new(false));
        let c = cancelled.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1200)).await;
            c.store(true, Ordering::SeqCst);
        });
        let a = api();
        let e = run(Job {
            api: &a, base_url: &base, api_key: "k", body: json!({}),
            timeout: Duration::from_secs(60),
        }, move || cancelled.load(Ordering::SeqCst)).await.unwrap_err();
        assert!(e.to_string().contains("已取消"));
        let n = polls.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(1500)).await;
        assert_eq!(polls.load(Ordering::SeqCst), n, "取消后不该再打接口");
    }

    #[tokio::test]
    async fn 超时到点就放弃_不无限等() {
        let (base, _) = fake_provider(999, json!({})).await;
        let a = api();
        let started = std::time::Instant::now();
        let e = run(Job {
            api: &a, base_url: &base, api_key: "k", body: json!({}),
            timeout: Duration::from_secs(2),
        }, || false).await.unwrap_err();
        assert!(e.to_string().contains("先不等了"));
        assert!(started.elapsed() < Duration::from_secs(12), "超时之后要尽快返回");
    }

    #[tokio::test]
    async fn 提交就被拒时不进轮询循环() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = vec![0u8; 2048];
                let _ = sock.read(&mut buf).await;
                let body = json!({ "error": { "message": "密钥无效" } }).to_string();
                let resp = format!(
                    "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(), body
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            }
        });
        let a = api();
        let e = run(Job {
            api: &a, base_url: &format!("http://{addr}"), api_key: "bad", body: json!({}),
            timeout: Duration::from_secs(30),
        }, || false).await.unwrap_err();
        assert!(e.to_string().contains("密钥无效"), "{e}");
        assert!(e.to_string().contains("401"));
    }
}
