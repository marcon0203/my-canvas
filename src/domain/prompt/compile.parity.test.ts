import { describe, expect, it } from 'vitest';
import FIXTURE from './__fixtures__/rust-prompts.json?raw';
import { compileShot, segmentsText, type PromptSegment } from './compile';

/**
 * 提示词合成规则：前端与 Rust 两份实现必须算出同一条。
 *
 * **为什么是两份**：界面上那条彩色三段式提示词要跟着用户敲字实时重算，
 * 过一趟 IPC 会把它变成异步的；Rust 那份是给 `prompt.compile` 工具用的。
 * 「搬到 core 共用」的代价比一个对比测试大得多 —— 于是留两份，用这个测试钉住。
 *
 * 样本是 Rust 生成的（`npm run fixtures`），新鲜度由 Rust 侧一条测试盯着。
 */

interface Case {
  case: string;
  globalStylePrompt: string;
  shot: { id: string; style?: string; own?: string; refs: string[] };
  segments: PromptSegment[];
  text: string;
}

const { assetDescs, cases } = JSON.parse(FIXTURE) as {
  assetDescs: [string, string][];
  cases: Case[];
};

const descOf = (aid: string) => assetDescs.find(([k]) => k === aid)?.[1];

describe('提示词合成：前端与 Rust 算出同一条', () => {
  it('样本不是空的 —— fixture 没生成时这个测试会静静通过', () => {
    expect(cases.length).toBeGreaterThan(4);
  });

  for (const c of cases) {
    it(c.case, () => {
      const segs = compileShot(
        { style: c.shot.style, refs: c.shot.refs, own: c.shot.own },
        { globalStylePrompt: c.globalStylePrompt, assetDescOf: descOf },
      );
      // 分段要逐段一致：界面按 k 上色，段落合并了颜色就不对了
      expect(segs.map((s) => ({ k: s.k, v: s.v }))).toEqual(c.segments);
      // 真正发出去的那条也要一致
      expect(segmentsText(segs)).toBe(c.text);
    });
  }
});
