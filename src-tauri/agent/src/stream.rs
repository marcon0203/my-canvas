//! 从「还没写完的 JSON」里一边生成一边把 `reply` 字段刨出来。
//!
//! # 为什么需要这么一层
//!
//! 三条链路要的都是结构化产物，所以模型吐出来的是一段 JSON，而给人看的那段话
//! （`reply`）是这段 JSON 里的一个字符串字段。想要真流式，就不能等整段 JSON
//! 收完再解析 —— 得在它还缺半个括号的时候，把 `reply` 已经写到的那部分认出来。
//!
//! 原来的做法是等模型答完，再把整段正文按两字一块发出去：观感像流式，实际上
//! 用户先干等一整轮（思考模型能等半分钟），然后看一段假打字。反馈原话是
//! 「没有流式输出吗？」
//!
//! # 两条路的输入长得不一样，但 reply 都在第一层
//!
//! - 工具调用那条：流里来的是 `submit` 的参数片段，本身就是那个对象
//! - 提示词那条：流里来的是模型的正文，JSON 可能裹着 ``` 围栏或 `<think>` 块
//!
//! 所以这里**不做完整的 JSON 解析**，只做一件事：找到第一个 `"reply"` 键，
//! 然后把它的字符串值按 JSON 的转义规则解到目前能解到的地方。解不完的转义
//! （`\` 后面还没来、`\u` 只来了两位、代理对只来了高位）就停在那儿等下一块 ——
//! 宁可这一帧少吐几个字，也不能把半个码点拼成乱码。
//!
//! `reply` 在三个产物结构里都是**第一个字段**，schemars 按声明顺序出 schema，
//! 模型基本都照着顺序写，所以它来得早，流式才有意义。真要是模型把它放到最后，
//! 这里退化成「最后一下才出字」—— 不会错，只是不好看。

/// 一次运行里 `reply` 的解码进度。
///
/// 有状态是因为只能往外发**增量**：同一段文本发两遍，界面上就重复了。
#[derive(Debug, Default)]
pub struct ReplyScan {
    /// 目前收到的全部原文。每来一块重扫一遍 —— 几 KB 的东西，
    /// 与其维护一个跨块的转义状态机，不如每次从头解，错不了
    buf: String,
    /// 已经发出去多少个字节（对 `decoded` 的前缀）
    sent: usize,
}

impl ReplyScan {
    /// 收一块新片段，返回**这一块带来的新正文**（可能是空的）。
    pub fn push(&mut self, chunk: &str) -> String {
        self.buf.push_str(chunk);
        let Some((decoded, _done)) = reply_so_far(&self.buf) else { return String::new() };
        if decoded.len() <= self.sent {
            // 解出来的没比上次多。也可能变短了 —— 那只会是我们自己解错了，
            // 这时候什么都不发，别往界面上倒一段重复的
            return String::new();
        }
        let out = decoded[self.sent..].to_string();
        self.sent = decoded.len();
        out
    }

    /// 已经发出去多少字节。给调用方判断「这一轮到底有没有吐过东西」用
    pub fn sent(&self) -> usize {
        self.sent
    }
}

/// 在缓冲里找 `"reply"` 的值从哪个字节开始（第一个引号之后）。
///
/// 只认「`"reply"` + 空白 + `:` + 空白 + `"`」这个形状。**不跟踪 JSON 层级** ——
/// 提示词那条路的前面可能有 `<think>` 块和围栏，那些文本里的括号和引号会把
/// 层级算乱；而认死这个形状，在真实输入上足够准：别的字段值里正好出现
/// 「"reply":"」的可能性，比多维护一个会算错的状态机的风险小。
fn value_start(buf: &str) -> Option<usize> {
    let b = buf.as_bytes();
    let mut from = 0;
    while let Some(rel) = buf[from..].find("\"reply\"") {
        let mut i = from + rel + "\"reply\"".len();
        while b.get(i).is_some_and(|c| c.is_ascii_whitespace()) {
            i += 1;
        }
        if b.get(i) == Some(&b':') {
            i += 1;
            while b.get(i).is_some_and(|c| c.is_ascii_whitespace()) {
                i += 1;
            }
            if b.get(i) == Some(&b'"') {
                return Some(i + 1);
            }
        }
        from = from + rel + 1;
    }
    None
}

/// `reply` 目前解出来的内容，以及这个字符串是否已经收尾。
///
/// 返回 `None` 表示还没看到这个字段。
pub fn reply_so_far(buf: &str) -> Option<(String, bool)> {
    let start = value_start(buf)?;
    let b = buf.as_bytes();
    let mut out = String::new();
    let mut i = start;
    while i < b.len() {
        match b[i] {
            // 字符串收尾
            b'"' => return Some((out, true)),
            b'\\' => {
                let Some(&e) = b.get(i + 1) else { return Some((out, false)) };
                match e {
                    b'n' => out.push('\n'),
                    b't' => out.push('\t'),
                    b'r' => out.push('\r'),
                    b'b' => out.push('\u{8}'),
                    b'f' => out.push('\u{c}'),
                    b'"' | b'\\' | b'/' => out.push(e as char),
                    b'u' => {
                        // `\uXXXX`：六个字节没到齐就停下等下一块，
                        // 不能把 `\u4f6` 当成一个完整码点
                        let Some(hi) = hex4(buf, i + 2) else { return Some((out, false)) };
                        match hi {
                            // 高位代理：后面必须再跟一个 `\uXXXX` 低位，
                            // 没来齐同样是停下等，不是错
                            0xD800..=0xDBFF => {
                                if buf.get(i + 6..i + 8) != Some("\\u") {
                                    // 后面跟的不是 `\u` 就是模型写坏了，
                                    // 但半个代理对拼不出字符，只能到此为止
                                    return Some((out, false));
                                }
                                let Some(lo) = hex4(buf, i + 8) else {
                                    return Some((out, false));
                                };
                                let c = 0x1_0000
                                    + ((hi as u32 - 0xD800) << 10)
                                    + (lo as u32 - 0xDC00);
                                out.push(char::from_u32(c)?);
                                i += 12;
                                continue;
                            }
                            _ => out.push(char::from_u32(hi as u32)?),
                        }
                        i += 6;
                        continue;
                    }
                    // JSON 里没这个转义 —— 模型写坏了，就别往下猜了
                    _ => return None,
                }
                i += 2;
            }
            _ => {
                // 原样的字符。buf 是 String，不会切在码点中间
                let c = buf[i..].chars().next()?;
                out.push(c);
                i += c.len_utf8();
            }
        }
    }
    Some((out, false))
}

/// 从 `at` 起读四位十六进制。不够四位或不是十六进制都返回 `None`
fn hex4(s: &str, at: usize) -> Option<u16> {
    let h = s.get(at..at + 4)?;
    u16::from_str_radix(h, 16).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 把一段完整的 JSON 按每 n 字节切开喂进去，拼回来的应该和一次给完一样。
    /// 切点会落在转义中间、汉字中间 —— 那正是要测的
    fn feed(json: &str, n: usize) -> String {
        let mut scan = ReplyScan::default();
        let mut out = String::new();
        let mut at = 0;
        let b = json.as_bytes();
        while at < b.len() {
            // 切在合法的字符边界上：真实的流也是一串完整的 &str
            let mut end = (at + n).min(b.len());
            while end < b.len() && !json.is_char_boundary(end) {
                end += 1;
            }
            out.push_str(&scan.push(&json[at..end]));
            at = end;
        }
        out
    }

    #[test]
    fn 一块一块喂进去_拼回来和原文一致() {
        // 带上转义、代理对和汉字 —— 切点会落在这三种东西中间，那才是要测的
        let json = r#"{"reply":"补在第二幕。\n他说\"撑不住\"，\u4e59也同意 \ud83d\ude00","acts":[]}"#;
        let want = "补在第二幕。\n他说\"撑不住\"，乙也同意 😀";
        for n in [1, 2, 3, 5, 7, 13, 64] {
            assert_eq!(feed(json, n), want, "每 {n} 字节切一次");
        }
    }

    #[test]
    fn 字段还没写完就能把已经到手的那截读出来() {
        let (s, done) = reply_so_far(r#"{"reply":"补在第二"#).unwrap();
        assert_eq!(s, "补在第二");
        assert!(!done, "还没收尾");
    }

    #[test]
    fn 字符串收尾之后不再往外发_后面的字段不会被当正文() {
        let mut scan = ReplyScan::default();
        assert_eq!(scan.push(r#"{"reply":"好了","acts":[{"t":"第一幕"#), "好了");
        assert_eq!(scan.push(r#""}]}"#), "", "产物里的字不该混进正文");
    }

    #[test]
    fn 转义切在中间时先不发_等下一块补齐() {
        let mut scan = ReplyScan::default();
        assert_eq!(scan.push(r#"{"reply":"第一行"#), "第一行");
        assert_eq!(scan.push("\\"), "", "只来了个反斜杠，还不知道是什么转义");
        assert_eq!(scan.push("n第二行"), "\n第二行");
    }

    #[test]
    fn u_转义只来了一半时不拼出乱码() {
        let mut scan = ReplyScan::default();
        // 只来了两位十六进制，认不出是哪个字
        assert_eq!(scan.push(r#"{"reply":"甲\u4e"#), "甲");
        assert_eq!(scan.push("59丙"), "乙丙", "补齐后一次出两个字");
    }

    #[test]
    fn 代理对没来齐时不发半个码点() {
        let mut scan = ReplyScan::default();
        // 😀 = 😀
        assert_eq!(scan.push(r#"{"reply":"笑\ud83d"#), "笑");
        assert_eq!(scan.push(r#"\ude00"#), "😀");
    }

    #[test]
    fn 还没看到这个字段时什么都不发() {
        let mut scan = ReplyScan::default();
        assert_eq!(scan.push(r#"{"acts":[],"#), "");
        assert_eq!(scan.push(r#""reply":"来了"#), "来了");
    }

    #[test]
    fn 围栏和思考块在前面也照样能找到() {
        let raw = "<think>先想想这版结构</think>\n```json\n{\"reply\": \"想好了\",\"acts\":[]}";
        let (s, _) = reply_so_far(raw).unwrap();
        assert_eq!(s, "想好了");
    }

    #[test]
    fn 思考块里的话不会被当成正文() {
        // 这是上一条的反面：认的是 `"reply":"` 这个形状，不是 reply 这个词
        let raw = "<think>用户要的 reply 是一段解释</think>{\"reply\":\"正文\"}";
        let (s, _) = reply_so_far(raw).unwrap();
        assert_eq!(s, "正文");
    }

    #[test]
    fn 键和冒号之间有空白也认() {
        let (s, _) = reply_so_far("{ \"reply\" :  \"带空格\" }").unwrap();
        assert_eq!(s, "带空格");
    }

    #[test]
    fn 值里的转义引号不会被当成收尾() {
        let (s, done) = reply_so_far(r#"{"reply":"他说\"好\"，然后走了"}"#).unwrap();
        assert_eq!(s, "他说\"好\"，然后走了");
        assert!(done);
    }

    #[test]
    fn 发过的不再发第二遍() {
        let mut scan = ReplyScan::default();
        scan.push(r#"{"reply":"一二三"#);
        assert_eq!(scan.sent(), "一二三".len());
        // 同一段再喂一遍不会让它变长，也就不该再吐字
        assert_eq!(scan.push(""), "");
    }
}
