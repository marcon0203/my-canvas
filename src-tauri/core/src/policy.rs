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
        "image.generate" | "video.generate" => Risk::Spend,
        "file.export" => Risk::Egress,
        "outline.write" | "script.write" | "asset.write" | "asset.lock"
        | "shot.write" | "prompt.compile" => Risk::Write,
        _ => Risk::Read,
    }
}

/// 一组工具里最高的那一档
pub fn risk_of_tools<S: AsRef<str>>(tools: &[S]) -> Risk {
    tools.iter().fold(Risk::Read, |hi, t| hi.max(risk_of_tool(t.as_ref())))
}

pub const DEFAULT_AUTO_MAX: Risk = Risk::Write;

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
        for t in ["outline.write", "script.write", "shot.write", "prompt.compile"] {
            assert_eq!(risk_of_tool(t), Risk::Write, "{t}");
        }
    }

    #[test]
    fn 不认识的工具按只读算_但那只是兜底() {
        // 新工具没登记时宁可当只读也不要当成可以随便花钱的
        assert_eq!(risk_of_tool("某个还没登记的工具"), Risk::Read);
    }

    #[test]
    fn 一组工具取最高档() {
        assert_eq!(risk_of_tools(&["project.read", "outline.write"]), Risk::Write);
        assert_eq!(risk_of_tools(&["project.read", "image.generate"]), Risk::Spend);
        assert_eq!(risk_of_tools(&["project.read", "file.export"]), Risk::Egress);
        assert_eq!(risk_of_tools::<&str>(&[]), Risk::Read);
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
