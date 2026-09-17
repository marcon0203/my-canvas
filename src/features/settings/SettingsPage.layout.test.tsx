// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsPage, type SettingsSection } from './SettingsPage';

// `?raw` 在 vitest 里拿到的是空串，所以直接按 vitest 的根目录读文件
const CSS = readFileSync(join(process.cwd(), 'src/styles/prototype.css'), 'utf8');

/**
 * 卡片之间的间距。
 *
 * 之前四个分区的卡片全是**贴在一起**的：`.pcard` 自己不带外边距，而它们的
 * 父容器 `.pad` 是 `display:block` 没有 gap。负责这件事的 `.setgrid` 类在
 * CSS 里定义着，但**没有任何地方用它** —— 死类，谁也不会发现。
 *
 * jsdom 不做布局，量不出真实像素，所以这里查的是结构与那条 CSS 规则本身：
 * 卡片必须被一个带 gap 的容器包着。真实像素在浏览器里量过（16px）。
 */
function render(section: SettingsSection, detail?: string): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter>
        <SettingsPage section={section} detail={detail} onOpen={() => {}} onBack={() => {}} />
      </MemoryRouter>,
    );
  });
  // 不能在这儿卸载：卸载后 host 里就没有节点可查了（第一版就是这么写的，
  // 结果「一张卡都没有」而不是「卡没被包住」）
  return host;
}

describe('设置页：卡片不能贴在一起', () => {
  it('.setgrid 真的带 gap —— 它曾经是一个没人用的死类', () => {
    const rule = /\.setgrid\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*(grid|flex)/);
    expect(rule).toMatch(/gap:/);
  });

  it('.pcard 自己不带外边距 —— 间距归容器管，两边都写会叠起来', () => {
    const rule = /\.pcard\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).not.toMatch(/margin/);
  });

  it('各分区的卡片都被带 gap 的容器包着', () => {
    // 智能体分区的**列表**是卡片墙（.agrid），用 .pcard 的是它的详情页
    const pages: [SettingsSection, string?][] = [
      ['workspace'], ['models'], ['skills'], ['agents', 'dp'],
    ];
    for (const [s, detail] of pages) {
      const host = render(s, detail);
      const cards = [...host.querySelectorAll('.pcard')];
      expect(cards.length, `${s} 一张卡都没有？`).toBeGreaterThan(0);
      for (const c of cards) {
        expect(c.parentElement?.className, `${s} 的卡片没被 setgrid 包住`).toContain('setgrid');
      }
      host.remove();
    }
  });

  /**
   * 整块一模一样的规则不能有：后一份会盖掉前一份，改前一份不生效。
   * 曾经有 129 行（.agrid / .atile / .pcard 那一整段）被复制了两遍。
   *
   * 只查「选择器 + 内容都相同」。同一个选择器出现两次是合法的 ——
   * `.top { position: relative; }` 这种给已有块追加一条属性的写法很常见。
   */
  it('prototype.css 里没有整块重复的规则', () => {
    const blocks = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map((m) => `${m[1]!.trim().replace(/\s+/g, ' ')}{${m[2]!.trim().replace(/\s+/g, ' ')}}`)
      .filter((b) => b.startsWith('.') && b.length > 40);
    const dup = [...new Set(blocks.filter((b, i) => blocks.indexOf(b) !== i))];
    expect(dup.length, `重复的整块：\n${dup.slice(0, 3).join('\n')}`).toBe(0);
  });
});
