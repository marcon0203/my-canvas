import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 「可用」口径只准有一个来源。
 *
 * 走查里数据页说「可用镜头 0」、剪辑页同时说「18 段可用」，根源就是两边各自
 * `filter((s) => s.verdict === 'ok')` / `filter((s) => s.vid === 'ok')`。
 * 谁再在页面里手写一次，这条测试就把文件名点出来。
 */

const ROOT = join(import.meta.dirname, '../..');
/** 允许手写的地方：词表自己、判定按钮（它设置的就是这个字段）、记账模型 */
const OK = [
  'domain/shots/usable.ts',
  'domain/shots/usable.test.ts',
  'domain/shots/usable.guard.test.ts',
  'domain/metrics/model.ts',        // 归因表按模型/景别分桶，口径就是 verdict
  'components/VerdictToggle.tsx',   // 判定按钮：它是写入方
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const BAD = /\.(?:verdict|vid)\s*===\s*'ok'/;

describe('可用口径只有一个来源', () => {
  it('页面不再自己 filter verdict / vid', () => {
    const offenders: string[] = [];
    for (const f of walk(ROOT)) {
      const rel = f.slice(ROOT.length + 1);
      if (OK.includes(rel)) continue;
      const src = readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        // 单看一镜的状态徽标是另一回事（它要区分 可用/重摇/待判定），
        // 只拦「数出一批」的那种写法
        if (BAD.test(line) && /filter|reduce|\.length/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('生成流程不许写 verdict —— 出片只置 vid，判定是人的动作', () => {
    const offenders: string[] = [];
    for (const f of walk(ROOT)) {
      const rel = f.slice(ROOT.length + 1);
      if (rel.startsWith('components/VerdictToggle') || rel.includes('.test.')) continue;
      const src = readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (/verdict\s*=\s*'ok'/.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
