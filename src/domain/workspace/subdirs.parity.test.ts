import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBDIRS } from './subdirs';

/**
 * 目录清单两端必须一字不差。
 *
 * 加 `providers/` 那次只改了 Rust 那份，前端兜底清单没跟上，于是设置页里
 * 看不到 api key 存在哪。这条测试就是为那次疏漏补的。
 */
const RUST = join(process.cwd(), 'src-tauri/doc/src/workspace.rs');

/** 从 Rust 的 `SUBDIRS` 常量里把三元组抠出来 */
function rustSubdirs(): { name: string; desc: string; used: boolean }[] {
  const src = readFileSync(RUST, 'utf8');
  const block = /pub const SUBDIRS: &\[\(&str, &str, bool\)\] = &\[([\s\S]*?)\n\];/.exec(src);
  expect(block, '在 workspace.rs 里找不到 SUBDIRS 常量').toBeTruthy();
  const out: { name: string; desc: string; used: boolean }[] = [];
  const row = /\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*\)/g;
  for (let m = row.exec(block![1]!); m; m = row.exec(block![1]!)) {
    out.push({ name: m[1]!, desc: m[2]!, used: m[3] === 'true' });
  }
  return out;
}

describe('工作空间目录清单', () => {
  it('前端那份和 Rust 那份逐条对得上', () => {
    expect(SUBDIRS.map((d) => ({ ...d }))).toEqual(rustSubdirs());
  });

  it('api key 那一条在清单里，且说清了它是干什么的', () => {
    const prov = SUBDIRS.find((d) => d.name === 'providers');
    expect(prov, '用户得能在设置里看到 api key 存在哪').toBeTruthy();
    expect(prov!.desc).toContain('api key');
    expect(prov!.used).toBe(true);
  });
});
