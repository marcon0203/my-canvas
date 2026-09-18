//! 拼片：时间线 + 片段文件 → 一个 mp4。
//!
//! 在这一步之前，「成片」只是一份「谁在第几秒、放多久」的清单（`timeline`）——
//! 界面能按它画轨道，但没有任何东西能交给别人看。这个模块是那条链路的最后一截。
//!
//! # 为什么是 shell 出去调 ffmpeg，不是链一个库进来
//!
//! 拼片、转码、烧字幕这些事 ffmpeg 已经做得比任何 Rust 封装都好，而链
//! `ffmpeg-sys` 会把构建变成一件要装一堆系统库的事（这个项目已经因为
//! webkit2gtk 在无 GUI 环境编不了 app 那一层，不想再加一样）。
//!
//! 代价是**用户机器上得有 ffmpeg**。所以这件事要如实说，不能在拼到一半时
//! 报一句「拼片失败」—— `probe()` 先查在不在，不在就说清去哪儿装。
//!
//! # 命令是纯函数拼出来的
//!
//! `args_of()` 不碰进程、不碰磁盘，只把一份计划翻成一串参数。这样
//! 「裁切对不对、顺序对不对、字幕挂上了没有」全都能单测，而不必真跑一遍
//! ffmpeg 才知道。真跑那条另有测试（这台机器上有 ffmpeg 时才跑）。
//!
//! # 字幕靠系统字体
//!
//! `subtitles` filter 走 fontconfig 找字体。**Linux 上如果没有中文字体，
//! 烧出来的是一排方块** —— macOS 和 Windows 自带，所以只有 Linux 用户会撞上。
//! 这件事没法在代码里解决（字体不能打进包里发），所以留在这儿记着。
//!
//! # 现在只拼画面
//!
//! 配音还没做（`audio.tts` 那条要的「同步取字节」机制还不在），所以输出是
//! 无声的。**不塞一条静音轨假装有声音** —— 那会让人以为配音跑过了。

use crate::timeline::{Subtitles, Timeline};
use studio_error::{Error, Result};
use std::path::{Path, PathBuf};

/// 成片分辨率。竖屏短视频，1080×1920。
///
/// 写死是刻意的：片段来自不同的出图/出视频模型，尺寸未必一致，
/// 不统一到一个画布上 concat 会直接失败（ffmpeg 要求各路尺寸相同）。
pub const W: u32 = 1080;
pub const H: u32 = 1920;

/// 帧率。各家出的片子帧率不一，concat 之前得对齐
pub const FPS: u32 = 30;

/// 一个片段：时间线上的一条 + 它在磁盘上的文件
#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    pub path: PathBuf,
    /// 要用多长，毫秒。来自时间线，不是文件本身的时长
    pub dur: u32,
}

/// 一次拼片要什么
#[derive(Debug, Clone)]
pub struct Plan {
    pub pieces: Vec<Piece>,
    /// 烧进画面的字幕文件（.srt）。None = 不烧
    pub subs: Option<PathBuf>,
    pub out: PathBuf,
}

/// 毫秒 → ffmpeg 认的秒（三位小数）。
///
/// **不用浮点除**：`3100 / 1000.0` 打印出来可能是 `3.1000000000000001`，
/// 拼进命令行既难读也可能被解析成别的数
fn secs(ms: u32) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

/// SRT 里的时间戳：`HH:MM:SS,mmm`
fn srt_stamp(ms: u32) -> String {
    let (h, m, s, ms) = (ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000);
    format!("{h:02}:{m:02}:{s:02},{ms:03}")
}

/// 字幕轨 → SRT 正文。
///
/// **纯函数**，所以「时间戳对不对、空字幕会不会写出一条空的」能单测。
/// 空文本的那条跳过 —— 烧一条空字幕进画面，看到的是一块什么都没有的底。
pub fn emit_srt(subs: &Subtitles) -> String {
    let mut out = String::new();
    let mut n = 0;
    for c in &subs.cues {
        if c.text.trim().is_empty() {
            continue;
        }
        n += 1;
        out.push_str(&format!(
            "{n}\n{} --> {}\n{}\n\n",
            srt_stamp(c.at),
            srt_stamp(c.at + c.dur),
            c.text.trim()
        ));
    }
    out
}

/// 一次拼片的 ffmpeg 参数。**纯函数** —— 不碰进程也不碰磁盘。
///
/// 做法是 `filter_complex`：每一路先按时间线给的时长裁切、重置时间戳、
/// 缩放并补边到统一画布、对齐帧率，再 concat。
///
/// 为什么不用 concat demuxer（那个只要一份文件清单，命令短得多）：
/// 它要求各路编码参数完全一致，而片段来自不同模型，尺寸帧率都未必一样；
/// 而且它没法按时间线裁切 —— 而裁切正是「卡点对齐」之后必须做的事。
///
/// `scale=…:force_original_aspect_ratio=decrease` + `pad` 是**补边不是裁掉**：
/// 出图模型给的比例和成片画布不一致时，裁掉会把人脸切掉一半，
/// 补边只是上下留黑。留黑难看，切脸是废片。
pub fn args_of(plan: &Plan) -> Result<Vec<String>> {
    if plan.pieces.is_empty() {
        return Err(Error::Store("时间线上没有片段，没有东西可拼".into()));
    }
    let mut a: Vec<String> = vec!["-y".into(), "-hide_banner".into(), "-nostdin".into()];
    for p in &plan.pieces {
        a.push("-i".into());
        a.push(p.path.to_string_lossy().into_owned());
    }

    let mut fc = String::new();
    for (i, p) in plan.pieces.iter().enumerate() {
        fc.push_str(&format!(
            "[{i}:v]trim=duration={d},setpts=PTS-STARTPTS,\
             scale={W}:{H}:force_original_aspect_ratio=decrease,\
             pad={W}:{H}:-1:-1:color=black,setsar=1,fps={FPS}[v{i}];",
            d = secs(p.dur)
        ));
    }
    for i in 0..plan.pieces.len() {
        fc.push_str(&format!("[v{i}]"));
    }
    fc.push_str(&format!("concat=n={}:v=1:a=0[cat]", plan.pieces.len()));

    // 字幕**在 concat 之后**烧：每一路各烧一次的话，时间戳是各自片段的，
    // 而字幕的时间戳是整条片子的
    let last = match &plan.subs {
        Some(s) => {
            // filter 里的路径要转义：`:` 是 filter 的参数分隔符，`'` 会截断引号
            let esc = s.to_string_lossy().replace('\\', "\\\\").replace(':', "\\:").replace('\'', "\\'");
            fc.push_str(&format!(";[cat]subtitles='{esc}'[out]"));
            "[out]"
        }
        None => "[cat]",
    };

    a.push("-filter_complex".into());
    a.push(fc);
    a.push("-map".into());
    a.push(last.into());
    // 无声：配音还没做。**不塞静音轨** —— 那会让人以为配音跑过了
    a.push("-an".into());
    a.extend(
        [
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            // yuv420p：不写的话某些源会出 yuv444，很多播放器和微信直接放不出来
            "-pix_fmt", "yuv420p",
            // faststart：moov 放到文件头，网页上能边下边播
            "-movflags", "+faststart",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    a.push(plan.out.to_string_lossy().into_owned());
    Ok(a)
}

/// ffmpeg 在不在，版本是什么。
///
/// **先查再拼**：拼到一半才报「失败」，用户看到的是一句没有下一步的错误。
/// 这里给的是「去装 ffmpeg」这个明确的下一步。
pub fn probe() -> Result<String> {
    let out = std::process::Command::new("ffmpeg")
        .args(["-hide_banner", "-version"])
        .output()
        .map_err(|_| {
            Error::Store(
                "没找到 ffmpeg，拼不了片。macOS：brew install ffmpeg；\
                 Windows：winget install ffmpeg；Linux：apt install ffmpeg"
                    .into(),
            )
        })?;
    let s = String::from_utf8_lossy(&out.stdout);
    Ok(s.lines().next().unwrap_or("ffmpeg").trim().to_string())
}

/// 真拼。成功返回输出文件。
///
/// ffmpeg 的错误全在 stderr，而且最后几行才是原因（前面是一大段流信息）——
/// 所以报错时只带最后几行，不把几百行日志塞进界面。
pub fn run(plan: &Plan) -> Result<PathBuf> {
    probe()?;
    let args = args_of(plan)?;
    if let Some(d) = plan.out.parent() {
        std::fs::create_dir_all(d)
            .map_err(|e| Error::Store(format!("建不了 {}：{e}", d.display())))?;
    }
    let out = std::process::Command::new("ffmpeg")
        .args(&args)
        .output()
        .map_err(|e| Error::Store(format!("跑不起来 ffmpeg：{e}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).rev().take(6).collect();
        let tail: Vec<&str> = tail.into_iter().rev().collect();
        return Err(Error::Store(format!("拼片失败：\n{}", tail.join("\n"))));
    }
    Ok(plan.out.clone())
}

/// 这次拼片要的一切：时间线上的片段配上磁盘文件，字幕落成 .srt。
///
/// `media` 给的是「镜号 → 那一镜的视频文件」。**时间线上有、但文件不在的那几镜
/// 要报出来**，不能默默跳过 —— 跳过的结果是交出一个比预期短的片子，
/// 而人不知道少了哪几镜。
pub fn plan_of(
    dir: &Path,
    timeline: &Timeline,
    subs: &Subtitles,
    media: &dyn Fn(&str) -> Option<PathBuf>,
    out: PathBuf,
) -> Result<Plan> {
    let mut pieces = Vec::new();
    let mut missing = Vec::new();
    for c in &timeline.clips {
        match media(&c.shot_id) {
            Some(p) if p.exists() => pieces.push(Piece { path: p, dur: c.dur }),
            _ => missing.push(c.shot_id.clone()),
        }
    }
    if !missing.is_empty() {
        return Err(Error::Store(format!(
            "这几镜的视频文件不在，拼不了：{}。先把它们出一遍视频",
            missing.join("、")
        )));
    }

    // 字幕落成一个文件 —— ffmpeg 的 subtitles filter 只吃文件，不吃内联文本
    let srt = emit_srt(subs);
    let subs_path = if srt.trim().is_empty() {
        None
    } else {
        let p = dir.join("subtitles.srt");
        crate::store::write_text(&p, &srt)?;
        Some(p)
    };
    Ok(Plan { pieces, subs: subs_path, out })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::{Clip, Cue};

    fn subs(cues: &[(u32, u32, &str)]) -> Subtitles {
        Subtitles {
            lang: "zh".into(),
            cues: cues.iter().map(|(at, dur, t)| Cue { at: *at, dur: *dur, text: (*t).into() }).collect(),
        }
    }

    fn plan(n: usize, with_subs: bool) -> Plan {
        Plan {
            pieces: (0..n).map(|i| Piece { path: PathBuf::from(format!("/m/{i}.mp4")), dur: 3100 }).collect(),
            subs: with_subs.then(|| PathBuf::from("/m/subtitles.srt")),
            out: PathBuf::from("/m/out.mp4"),
        }
    }

    /* ---------------- 字幕 ---------------- */

    #[test]
    fn srt_时间戳是_srt_那种格式_不是毫秒数() {
        let s = emit_srt(&subs(&[(0, 1500, "他推开门")]));
        assert_eq!(s, "1\n00:00:00,000 --> 00:00:01,500\n他推开门\n\n");
    }

    #[test]
    fn srt_跨分钟跨小时都对() {
        let s = emit_srt(&subs(&[(3_723_456, 1000, "一句")]));
        assert!(s.contains("01:02:03,456 --> 01:02:04,456"), "{s}");
    }

    /// 空字幕跳过。烧一条空的进画面，看到的是一块什么都没有的底
    #[test]
    fn 空字幕跳过_而且序号不跳号() {
        let s = emit_srt(&subs(&[(0, 1000, "第一句"), (1000, 1000, "  "), (2000, 1000, "第三句")]));
        assert!(s.starts_with("1\n"));
        assert!(s.contains("\n2\n"), "序号要连着，不能跳到 3：\n{s}");
        assert!(!s.contains("3\n00"), "只该有两条：\n{s}");
    }

    #[test]
    fn 一条字幕都没有时是空串_调用方据此决定不烧() {
        assert_eq!(emit_srt(&subs(&[])), "");
        assert_eq!(emit_srt(&subs(&[(0, 100, "")])), "");
    }

    /* ---------------- 命令 ---------------- */

    #[test]
    fn 没有片段时报错_不去跑一个拼不出东西的命令() {
        assert!(args_of(&plan(0, false)).is_err());
    }

    #[test]
    fn 每个片段一路输入_顺序就是时间线的顺序() {
        let a = args_of(&plan(3, false)).unwrap();
        assert_eq!(a.iter().filter(|x| *x == "-i").count(), 3, "三个片段该有三路输入：{a:?}");
        let joined = a.join(" ");
        assert!(joined.contains("/m/0.mp4"));
        // 顺序：0 在 1 前面
        assert!(joined.find("/m/0.mp4").unwrap() < joined.find("/m/1.mp4").unwrap());
    }

    /// **按时间线给的时长裁切，不是整段用完。**
    ///
    /// 卡点对齐之后每一镜的时长是算出来的，不裁的话片子长度和时间线上显示的
    /// 不一样 —— 而界面上那条轨是按时间线画的，两边对不上人只会觉得程序错了。
    #[test]
    fn 按时间线的时长裁切_秒数不是浮点垃圾() {
        let fc = args_of(&plan(1, false)).unwrap().join(" ");
        assert!(fc.contains("trim=duration=3.100"), "{fc}");
        // 3100/1000.0 打印成 3.1000000000000001 那种不行
        assert!(!fc.contains("3.1000000000"), "{fc}");
    }

    #[test]
    fn 毫秒转秒的边界() {
        assert_eq!(secs(0), "0.000");
        assert_eq!(secs(999), "0.999");
        assert_eq!(secs(1000), "1.000");
        assert_eq!(secs(3100), "3.100");
        assert_eq!(secs(60_500), "60.500");
    }

    /// 补边不是裁掉：出图模型给的比例和成片画布不一致时，
    /// 裁掉会把人脸切掉一半，补边只是上下留黑。留黑难看，切脸是废片
    #[test]
    fn 尺寸不一致时补边_不裁画面() {
        let fc = args_of(&plan(1, false)).unwrap().join(" ");
        assert!(fc.contains("force_original_aspect_ratio=decrease"), "{fc}");
        assert!(fc.contains("pad=1080:1920"), "{fc}");
        assert!(!fc.contains("crop"), "不该裁：{fc}");
    }

    #[test]
    fn 统一到一个画布和帧率_否则_concat_直接失败() {
        let fc = args_of(&plan(2, false)).unwrap().join(" ");
        assert!(fc.contains("scale=1080:1920"), "{fc}");
        assert!(fc.contains("fps=30"), "{fc}");
        assert!(fc.contains("setsar=1"), "{fc}");
        assert!(fc.contains("concat=n=2:v=1:a=0"), "{fc}");
    }

    /// 字幕要在 concat **之后**烧：每一路各烧一次的话，
    /// 字幕的时间戳是整条片子的，而那一路的时间戳是从 0 开始的
    #[test]
    fn 字幕烧在_concat_之后() {
        let fc = args_of(&plan(2, true)).unwrap().join(" ");
        let cat = fc.find("concat=").unwrap();
        let sub = fc.find("subtitles=").expect("字幕没挂上");
        assert!(sub > cat, "字幕挂在 concat 前面了：{fc}");
    }

    #[test]
    fn 没有字幕时不挂那一档() {
        let fc = args_of(&plan(2, false)).unwrap().join(" ");
        assert!(!fc.contains("subtitles="), "{fc}");
    }

    /// filter 里 `:` 是参数分隔符 —— Windows 的 `C:\…` 不转义会把整条 filter 弄坏
    #[test]
    fn 字幕路径里的冒号要转义() {
        let p = Plan {
            subs: Some(PathBuf::from("C:/我的 项目/subtitles.srt")),
            ..plan(1, false)
        };
        let fc = args_of(&p).unwrap().join(" ");
        assert!(fc.contains("C\\:/"), "冒号没转义：{fc}");
    }

    /// 无声是现在的真实状态（配音还没做）。
    /// **不塞静音轨** —— 那会让人以为配音跑过了
    #[test]
    fn 输出无声_而不是一条假的静音轨() {
        let a = args_of(&plan(1, false)).unwrap();
        assert!(a.contains(&"-an".to_string()), "{a:?}");
        assert!(!a.join(" ").contains("anullsrc"), "不该塞静音轨：{a:?}");
    }

    #[test]
    fn 编码参数照顾播放兼容_yuv420p_和_faststart() {
        let a = args_of(&plan(1, false)).unwrap().join(" ");
        // 不写 yuv420p，某些源会出 yuv444，很多播放器和微信直接放不出来
        assert!(a.contains("-pix_fmt yuv420p"), "{a}");
        // moov 放文件头，网页上能边下边播
        assert!(a.contains("+faststart"), "{a}");
    }

    #[test]
    fn 输出文件是最后一个参数() {
        let a = args_of(&plan(1, false)).unwrap();
        assert_eq!(a.last().unwrap(), "/m/out.mp4");
    }

    /* ---------------- 凑齐这次要拼的东西 ---------------- */

    fn tl(clips: &[(&str, u32, u32)]) -> Timeline {
        Timeline {
            clips: clips.iter().map(|(id, at, dur)| Clip { shot_id: (*id).into(), at: *at, dur: *dur }).collect(),
            beat_ms: None,
        }
    }

    /// **文件不在的那几镜要报出来，不能默默跳过。**
    ///
    /// 跳过的结果是交出一个比预期短的片子，而人不知道少了哪几镜 ——
    /// 这种错比直接失败难查得多。
    #[test]
    fn 少哪几镜的视频就说哪几镜() {
        let t = tempfile::TempDir::new().unwrap();
        let have = t.path().join("s1.mp4");
        std::fs::write(&have, b"x").unwrap();

        let e = plan_of(
            t.path(),
            &tl(&[("s1", 0, 1000), ("s2", 1000, 1000), ("s3", 2000, 1000)]),
            &subs(&[]),
            &|id| (id == "s1").then(|| have.clone()),
            t.path().join("out.mp4"),
        )
        .unwrap_err();
        let msg = e.to_string();
        assert!(msg.contains("s2") && msg.contains("s3"), "要点名缺哪几镜：{msg}");
        assert!(!msg.contains("s1"), "有的那镜不该被点名：{msg}");
        assert!(msg.contains("出一遍视频"), "要给下一步：{msg}");
    }

    #[test]
    fn 有字幕就落成一个_srt_文件_没有就不落() {
        let t = tempfile::TempDir::new().unwrap();
        let f = t.path().join("s1.mp4");
        std::fs::write(&f, b"x").unwrap();
        let media = |_: &str| Some(f.clone());

        let p = plan_of(t.path(), &tl(&[("s1", 0, 1000)]), &subs(&[(0, 900, "一句")]), &media,
            t.path().join("out.mp4")).unwrap();
        let srt = p.subs.expect("该落一个 srt");
        assert!(srt.exists());
        assert!(std::fs::read_to_string(&srt).unwrap().contains("一句"));

        let p = plan_of(t.path(), &tl(&[("s1", 0, 1000)]), &subs(&[]), &media,
            t.path().join("out.mp4")).unwrap();
        assert_eq!(p.subs, None, "没有字幕就不该落文件，更不该挂一个空的上去");
    }

    #[test]
    fn 片段的时长来自时间线_不是文件本身() {
        let t = tempfile::TempDir::new().unwrap();
        let f = t.path().join("s1.mp4");
        std::fs::write(&f, b"x").unwrap();
        let p = plan_of(t.path(), &tl(&[("s1", 0, 2500)]), &subs(&[]), &|_| Some(f.clone()),
            t.path().join("out.mp4")).unwrap();
        assert_eq!(p.pieces[0].dur, 2500);
    }
}

/// **真跑一遍 ffmpeg，产出一个真的 mp4，再用 ffprobe 验它。**
///
/// 上面那一组测的是「命令拼得对不对」。这一组测的是另一件事：那条命令
/// 到底能不能跑出东西来。纯函数测得再全，也验不出「filter 语法 ffmpeg 不认」
/// 这种问题 —— 而那正是这个模块最容易错的地方。
///
/// 机器上没有 ffmpeg 时整组跳过（用 `probe()` 判断）。跳过时打一行字，
/// 免得「全绿」看起来像验过了。
#[cfg(test)]
mod ffmpeg_tests {
    use super::*;
    use crate::timeline::{Clip, Cue};

    fn has_ffmpeg() -> bool {
        if probe().is_ok() {
            return true;
        }
        eprintln!("跳过：这台机器上没有 ffmpeg，拼片那几条没验");
        false
    }

    /// 用 ffmpeg 自己造一个测试片段：纯色、指定尺寸与时长。
    /// **刻意给不同的尺寸** —— 各家出的片子尺寸不一，统一到画布那一步正是要验的
    fn make_clip(path: &Path, color: &str, w: u32, h: u32, secs: f32) {
        let st = std::process::Command::new("ffmpeg")
            .args([
                "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", &format!("color=c={color}:s={w}x{h}:r=25:d={secs}"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                &path.to_string_lossy(),
            ])
            .status()
            .unwrap();
        assert!(st.success(), "造测试片段失败");
    }

    /// ffprobe 读一个字段
    fn probe_field(path: &Path, entries: &str) -> String {
        let out = std::process::Command::new("ffprobe")
            .args([
                "-v", "error", "-select_streams", "v:0",
                "-show_entries", entries, "-of", "default=nw=1:nk=1",
                &path.to_string_lossy(),
            ])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[test]
    fn 三个不同尺寸的片段_真拼成一个_mp4() {
        if !has_ffmpeg() {
            return;
        }
        let t = tempfile::TempDir::new().unwrap();
        // 三个不一样的尺寸：竖屏、横屏、正方形
        let specs = [("red", 720u32, 1280u32), ("green", 1920, 1080), ("blue", 800, 800)];
        let mut media = std::collections::HashMap::new();
        for (i, (c, w, h)) in specs.iter().enumerate() {
            let p = t.path().join(format!("s{}.mp4", i + 1));
            make_clip(&p, c, *w, *h, 2.0);
            media.insert(format!("s{}", i + 1), p);
        }

        let timeline = Timeline {
            // 每一镜只用 1.2 秒 —— 源片段是 2 秒，裁切那一步要真生效
            clips: (1..=3)
                .map(|i| Clip { shot_id: format!("s{i}"), at: (i - 1) * 1200, dur: 1200 })
                .collect(),
            beat_ms: None,
        };
        let subs = Subtitles {
            lang: "zh".into(),
            cues: vec![Cue { at: 0, dur: 1000, text: "他推开门".into() }],
        };

        let out = t.path().join("film.mp4");
        let plan = plan_of(t.path(), &timeline, &subs, &|id| media.get(id).cloned(), out.clone())
            .unwrap();
        let got = run(&plan).expect("拼片该成功");

        // 1. 文件真的在，而且不是个空壳
        assert!(got.exists());
        let size = std::fs::metadata(&got).unwrap().len();
        assert!(size > 1000, "文件太小，像是没真编码：{size} 字节");

        // 2. 尺寸统一到了成片画布（源是三个不同尺寸）
        assert_eq!(probe_field(&got, "stream=width,height"), format!("{W}\n{H}"));

        // 3. 时长 = 三镜各 1.2 秒 ≈ 3.6 秒。**这条验的是裁切真生效** ——
        //    不裁的话是 6 秒
        let dur: f32 = probe_field(&got, "format=duration").parse().unwrap_or(0.0);
        assert!((dur - 3.6).abs() < 0.35, "时长 {dur} 秒，该在 3.6 附近（不裁切会是 6 秒）");

        // 4. 播放兼容那两项
        assert_eq!(probe_field(&got, "stream=pix_fmt"), "yuv420p");

        // 5. 无声：现在配音还没做，不该有音轨
        let audio = std::process::Command::new("ffprobe")
            .args(["-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                   "-of", "csv=p=0", &got.to_string_lossy()])
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&audio.stdout).trim().is_empty(), "现在不该有音轨");
    }

    /// 少一镜的视频文件时**不许拼出一个短片子**，要当场说清少了哪镜
    #[test]
    fn 少一镜就不拼_而不是交一个短片子() {
        if !has_ffmpeg() {
            return;
        }
        let t = tempfile::TempDir::new().unwrap();
        let p = t.path().join("s1.mp4");
        make_clip(&p, "red", 720, 1280, 1.0);
        let timeline = Timeline {
            clips: vec![
                Clip { shot_id: "s1".into(), at: 0, dur: 800 },
                Clip { shot_id: "s2".into(), at: 800, dur: 800 },
            ],
            beat_ms: None,
        };
        let e = plan_of(t.path(), &timeline, &Subtitles::default(),
            &|id| (id == "s1").then(|| p.clone()), t.path().join("out.mp4")).unwrap_err();
        assert!(e.to_string().contains("s2"));
        assert!(!t.path().join("out.mp4").exists(), "不该留下一个半截的输出");
    }

    /// 片段文件是坏的时候，报的是 ffmpeg 的原话，而不是一句「拼片失败」
    #[test]
    fn 坏片段报出原因_不是一句拼片失败() {
        if !has_ffmpeg() {
            return;
        }
        let t = tempfile::TempDir::new().unwrap();
        let bad = t.path().join("s1.mp4");
        std::fs::write(&bad, "这不是视频".as_bytes()).unwrap();
        let plan = Plan {
            pieces: vec![Piece { path: bad, dur: 1000 }],
            subs: None,
            out: t.path().join("out.mp4"),
        };
        let e = run(&plan).unwrap_err().to_string();
        assert!(e.contains("拼片失败"));
        // 要带上 ffmpeg 说的原因，不然没有下一步
        assert!(e.len() > 20, "错误里得有原话：{e}");
    }
}
