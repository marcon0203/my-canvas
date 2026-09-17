//! 自主执行的权限边界。**与前端 `domain/agent/policy.ts` 同一套规则**，
//! 有 parity 测试盯着 —— 两边判得不一样，等于其中一边的把关是假的。
//!
//! 工具现在还没有在 Rust 侧真正执行（`skills` 的 scripts/ 也没做）。
//! 先把边界建在这里，是为了等工具真能动手时，闸门已经在闸的位置上，
//! 而不是那时候再补 —— 补的时候总会漏。
//!
//! 这一层**不是沙箱**。它挡的是自主模式下的越界动作；
//! 真要跑陌生代码需要进程级隔离，是另一件事。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    /// 只读，没有副作用
    Read,
    /// 改项目内容。进撤销历史，退得回来
    Write,
    /// 花积分。撤销退不回额度
    Spend,
    /// 东西离开这台机器
    Egress,
}

impl Risk {
    fn order(self) -> u8 {
        match self {
            Risk::Read => 0,
            Risk::Write => 1,
            Risk::Spend => 2,
            Risk::Egress => 3,
        }
    }

    pub fn max(self, other: Risk) -> Risk {
        if self.order() >= other.order() { self } else { other }
    }
}

/// 工具 → 风险。工具 id 与前端 `tools.ts` 的 ToolId 一致。
///
/// `stage.render` 是本地 WebGL 渲染，不花钱也不出网，所以是只读那一档 ——
/// 名字里带 render 容易让人误以为要花钱。
pub fn risk_of_tool(id: &str) -> Risk {
    match id {
        // 只读：不碰项目，也不花钱
        "project.read" | "project.search" | "metrics.read" | "cost.estimate"
        // prompt.compile 也在这儿：它只是把「这一镜会发出去什么」算出来给你看，
        // 提示词是派生值，改它要去改源头
        | "stage.render" | "prompt.translate" | "prompt.compile" => Risk::Read,

        // 改项目内容，进撤销历史
        "outline.write" | "script.write" | "asset.write" | "asset.lock" | "shot.write"
        | "style.apply" | "shot.rig"
        | "edit.timeline" | "edit.subtitle" => Risk::Write,

        // 花积分，撤销退不回
        "image.generate" | "image.edit" | "image.upscale"
        | "video.generate" | "video.extend"
        | "audio.tts" | "audio.music" | "audio.sfx" => Risk::Spend,

        // 东西离开这台机器
        "file.export" | "web.search" | "web.fetch" => Risk::Egress,

        // **不认识的工具按最高档算，不是最低档。**
        // 兜底要 fail-closed：新加了工具却忘了在这儿登记时，
        // 后果应该是「它跑不了，有人来问为什么」，而不是「它自动跑了」。
        _ => Risk::Egress,
    }
}

/// 一组工具里最高的那一档
pub fn risk_of_tools<S: AsRef<str>>(tools: &[S]) -> Risk {
    tools.iter().fold(Risk::Read, |hi, t| hi.max(risk_of_tool(t.as_ref())))
}

pub const DEFAULT_AUTO_MAX: Risk = Risk::Write;

/// 单个工具的审批策略覆盖。**不写 = 跟随风险档**，那是绝大多数情况。
///
/// 存在的理由：风险档是按后果分的粗粒度，同一档里的工具人未必想一样对待。
/// 「出图」和「出视频」都算花钱，但一次出图一两个积分、一条视频几十个 ——
/// 有人愿意让出图自动跑，视频每次都问。按档设做不到这件事。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolApproval {
    /// 总是允许：不管风险档，这个工具自主跑
    Allow,
    /// 总是问我：不管风险档，每次都停下来等人点头
    Ask,
}

/// 某个工具能不能不问就干。
///
/// **Egress 永远要人点头，覆盖也改不了。** 这一条写在最前面不是顺手：
/// 只要它可以被一个配置项关掉，那这个配置项迟早会被关掉 —— 可能是用户
/// 图省事，也可能是模型自己往配置里写。所以「总是允许」在 egress 上无效。
pub fn auto_allowed_tool(tool: &str, auto_max: Option<Risk>, over: Option<ToolApproval>) -> bool {
    let risk = risk_of_tool(tool);
    if risk == Risk::Egress {
        return false;
    }
    match over {
        Some(ToolApproval::Ask) => false,
        Some(ToolApproval::Allow) => true,
        None => auto_allowed(risk, auto_max),
    }
}

/// 能不能自己做。**Egress 永远要人点头**，上限调到最高也不行 ——
/// 一个「自动把东西发走」的默认值不该存在于任何配置里。
pub fn auto_allowed(risk: Risk, auto_max: Option<Risk>) -> bool {
    if risk == Risk::Egress {
        return false;
    }
    risk.order() <= auto_max.unwrap_or(DEFAULT_AUTO_MAX).order()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 出图出视频算花钱_导出算出本机() {
        assert_eq!(risk_of_tool("image.generate"), Risk::Spend);
        assert_eq!(risk_of_tool("video.generate"), Risk::Spend);
        assert_eq!(risk_of_tool("file.export"), Risk::Egress);
    }

    #[test]
    fn 渲参考图是本地渲染_不该算花钱() {
        assert_eq!(risk_of_tool("stage.render"), Risk::Read);
    }

    #[test]
    fn 读项目读记账是只读_写大纲写剧本是改项目() {
        for t in ["project.read", "metrics.read"] {
            assert_eq!(risk_of_tool(t), Risk::Read, "{t}");
        }
        for t in ["outline.write", "script.write", "shot.write", "style.apply"] {
            assert_eq!(risk_of_tool(t), Risk::Write, "{t}");
        }
    }

    #[test]
    fn 不认识的工具按最高档算_兜底要_fail_closed() {
        // 加了工具却忘了登记风险时，后果应该是「它跑不了，有人来问」，
        // 而不是「它自动跑了」。前者是个 bug 报告，后者是一次事故。
        assert_eq!(risk_of_tool("某个还没登记的工具"), Risk::Egress);
        assert!(!auto_allowed(risk_of_tool("某个还没登记的工具"), Some(Risk::Spend)));
    }

    #[test]
    fn 空工具集是只读_那是真的没有能力_不是没登记() {
        assert_eq!(risk_of_tools::<&str>(&[]), Risk::Read);
    }

    #[test]
    fn 一组工具取最高档() {
        assert_eq!(risk_of_tools(&["project.read", "outline.write"]), Risk::Write);
        assert_eq!(risk_of_tools(&["project.read", "image.generate"]), Risk::Spend);
        assert_eq!(risk_of_tools(&["project.read", "file.export"]), Risk::Egress);
    }

    #[test]
    fn 单个工具可以设成总是允许_但_egress_改不动() {
        use ToolApproval::*;
        // 上限只给到「改项目」，出图本来要问
        assert!(!auto_allowed_tool("image.generate", Some(Risk::Write), None));
        // 单独放开这一个
        assert!(auto_allowed_tool("image.generate", Some(Risk::Write), Some(Allow)));
        // 出本机的那几个，放开也不放开 —— 这一条不给配置绕
        for t in ["file.export", "web.fetch", "web.search"] {
            assert!(!auto_allowed_tool(t, Some(Risk::Spend), Some(Allow)), "{t} 被放开了");
            assert!(!auto_allowed_tool(t, Some(Risk::Egress), Some(Allow)), "{t} 被放开了");
        }
    }

    #[test]
    fn 单个工具可以设成总是问我_哪怕它在上限之内() {
        // 上限给到花钱，写大纲本来不用问
        assert!(auto_allowed_tool("outline.write", Some(Risk::Spend), None));
        assert!(!auto_allowed_tool("outline.write", Some(Risk::Spend), Some(ToolApproval::Ask)));
    }

    #[test]
    fn 没设覆盖时与按档判完全一致() {
        for t in ["project.read", "outline.write", "image.generate", "file.export", "没登记的"] {
            for m in [None, Some(Risk::Read), Some(Risk::Write), Some(Risk::Spend)] {
                assert_eq!(
                    auto_allowed_tool(t, m, None),
                    auto_allowed(risk_of_tool(t), m),
                    "{t} 在 {m:?} 下两种算法不一致"
                );
            }
        }
    }

    #[test]
    fn 没登记的工具设成总是允许也跑不了_兜底仍是_fail_closed() {
        // 忘了登记风险的工具算 Egress，而 Egress 不给覆盖 ——
        // 这两条合起来才是真的兜底：漏登记 + 手一抖放开，仍然拦得住
        assert!(!auto_allowed_tool("某个还没登记的工具", Some(Risk::Spend), Some(ToolApproval::Allow)));
    }

    #[test]
    fn 出厂上限是能改项目不能花钱() {
        assert_eq!(DEFAULT_AUTO_MAX, Risk::Write);
        assert!(auto_allowed(Risk::Write, None));
        assert!(auto_allowed(Risk::Read, None));
        assert!(!auto_allowed(Risk::Spend, None));
    }

    #[test]
    fn 调到花钱那档才放行出图() {
        assert!(auto_allowed(Risk::Spend, Some(Risk::Spend)));
        assert!(auto_allowed(Risk::Write, Some(Risk::Spend)));
    }

    #[test]
    fn 出本机永远要人点头_上限调到最高也不行() {
        for m in [Risk::Read, Risk::Write, Risk::Spend, Risk::Egress] {
            assert!(!auto_allowed(Risk::Egress, Some(m)), "上限 {m:?}");
        }
    }

    #[test]
    fn 序列化成前端认识的小写字符串() {
        assert_eq!(serde_json::to_string(&Risk::Spend).unwrap(), "\"spend\"");
        assert_eq!(
            serde_json::from_str::<Risk>("\"egress\"").unwrap(),
            Risk::Egress
        );
    }
}
