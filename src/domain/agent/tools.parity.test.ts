import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOLS, type ToolId, type ToolStatus } from './tools';
import { riskOfTool, type Risk } from './policy';

/**
 * 两侧注册表的一致性测试。
 *
 * 两个文件的注释里都写着「有 parity 测试」，但**之前并没有** ——
 * 于是四个工具在 Rust 侧改成了 Ready，前端那份还写着「未实现」，
 * 界面上照旧灰着，没有任何测试发现。这个文件就是补上那句话。
 *
 * 用正则啃 Rust 源码不优雅，但这里要的是**会响的警报**：
 * 格式变了这个测试会直接失败，然后有人来改它 —— 比两份手抄清单静静漂移好。
 */

const SRC = readFileSync(new URL('../../../src-tauri/core/src/tools.rs', import.meta.url), 'utf8');

interface RustTool {
  id: string;
  risk: Risk;
  runsIn: 'rust' | 'browser';
  status: ToolStatus;
  hasBlockedBy: boolean;
}

/** 单字母别名是 tools.rs 里 `use Risk::{Read as R, Write as W}` 那套 */
const RISK_OF: Record<string, Risk> = {
  R: 'read', W: 'write', Spend: 'spend', Egress: 'egress',
};

function parseRust(): RustTool[] {
  const body = SRC.slice(SRC.indexOf('pub fn all()'), SRC.indexOf('pub fn spec('));
  const out: RustTool[] = [];
  // 一条登记项：t("id", "名字", 分组, "描述", 风险, 跑在哪, 状态, blocked_by, schema)
  const re = /\bt\("([\w.]+)",/g;
  const starts: { id: string; at: number }[] = [];
  for (let m = re.exec(body); m; m = re.exec(body)) starts.push({ id: m[1]!, at: m.index });
  for (const [i, s] of starts.entries()) {
    const chunk = body.slice(s.at, starts[i + 1]?.at ?? body.length);
    const hit = /\b(R|W|Spend|Egress),\s*(Rust|Browser),\s*(Ready|Unverified|Declared),\s*(None|Some)/
      .exec(chunk);
    if (!hit) throw new Error(`解析不出 ${s.id} 的风险/状态 —— tools.rs 的登记格式变了，改这个测试`);
    out.push({
      id: s.id,
      risk: RISK_OF[hit[1]!]!,
      runsIn: hit[2]! === 'Rust' ? 'rust' : 'browser',
      status: hit[3]!.toLowerCase() as ToolStatus,
      hasBlockedBy: hit[4]! === 'Some',
    });
  }
  return out;
}

const RUST = parseRust();
const byId = new Map(RUST.map((t) => [t.id, t]));

describe('工具注册表：前端与 Rust 两侧一致', () => {
  it('解析到的条数是合理的 —— 正则啃错了会静默变成 0 条', () => {
    expect(RUST.length).toBeGreaterThan(20);
  });

  it('id 集合完全相同', () => {
    expect([...byId.keys()].sort()).toEqual(TOOLS.map((t) => t.id).sort());
  });

  it('实现状态相同 —— 一侧改成可用、另一侧还灰着，是界面在说谎', () => {
    for (const t of TOOLS) {
      expect(byId.get(t.id)!.status, t.id).toBe(t.status);
    }
  });

  it('风险档相同 —— 两侧闸门不一致的话，前端放行的会在 Rust 侧被挡', () => {
    for (const t of TOOLS) {
      expect(byId.get(t.id)!.risk, t.id).toBe(riskOfTool(t.id));
    }
  });

  it('没实现的两侧都要写清缺什么，实现了的不留残留说明', () => {
    for (const t of RUST) {
      const ts = TOOLS.find((x) => x.id === t.id)!;
      expect(t.hasBlockedBy, `${t.id}（Rust 侧）`).toBe(t.status !== 'ready');
      expect(!!ts.blockedBy, `${t.id}（前端）`).toBe(t.status !== 'ready');
    }
  });

  it('只在浏览器里跑的工具，前端得知道它不调模型也不在 Rust 侧执行', () => {
    const browser = RUST.filter((t) => t.runsIn === 'browser').map((t) => t.id);
    expect(browser).toEqual(['stage.render']);
  });
});

/** 类型层面的哑断言：ToolId 拼错时这里先报 */
const _ids: ToolId[] = TOOLS.map((t) => t.id);
void _ids;
