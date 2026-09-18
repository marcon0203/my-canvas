import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_STEPS } from '@/features/settings/AgentWizard';
import { APPROVAL_LABEL, RISK_LABEL } from '@/domain/agent/policy';
import { AUTONOMY_LABEL } from '@/domain/agent/config';
import { SETTINGS_SUB } from '@/domain/nav';

/**
 * 界面文案的口语词检查。
 *
 * 起因：设置页的步骤原来叫「侧重方向」「能干什么」「放手到哪一档」，
 * 任务在界面上一路叫「活儿」，分工表叫「功能清单」还放在 Skill 管理下面。这些是写代码时顺手起的名字，不是产品词 ——
 * 用户看到的是一个自己发明词汇的界面，而不是一个说行业通用语的工具。
 *
 * 这个测试只管**会显示给用户的字符串**，注释照旧用大白话（那是给人看代码的）。
 * 加词的时候想清楚：它是不是在任何界面语境下都不该出现。
 */
const BANNED: readonly [string, string][] = [
  ['活儿', '用「任务」'],
  ['放手', '用「执行权限」或「自动执行范围」'],
  ['点头', '用「确认」—— 姿态名「点头」在 domain/assets 与 three/，不在这几个目录下'],
  ['侧重方向', '用「系统提示词」'],
  ['改一份', '用「创建副本」'],
  ['装了哪些', '用「已安装」'],
  ['怼', '口语'],
  ['一摊', '口语'],
  ['没人接', '用「没有负责人」'],
  ['跑不起来', '用「执行失败」'],
  ['要你点头', '用「需要你确认」'],
  ['功能清单', '这页讲的是分工，不是功能目录 —— 用「任务分工」'],
];

/** 只扫设置与智能体相关的界面层 —— 故事内容、姿态名这些不在其中 */
const ROOTS = ['src/features/settings', 'src/domain/agent', 'src/domain/nav.ts'];

function files(p: string): string[] {
  if (statSync(p).isFile()) return /\.tsx?$/.test(p) && !/\.test\./.test(p) ? [p] : [];
  return readdirSync(p).flatMap((n) => files(join(p, n)));
}

/** 去掉注释：`//`、`/* *\/`、JSX 里的 `{/* *\/}` */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l.replace(/\/\/.*$/, '')))
    .join('\n');
}

describe('界面文案：不用口语词', () => {
  const sources = ROOTS.flatMap((r) => files(join(process.cwd(), r)))
    .map((f) => [f.replace(`${process.cwd()}/`, ''), stripComments(readFileSync(f, 'utf8'))] as const);

  it('扫到的文件数是合理的 —— 路径写错会静默变成 0 个', () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  for (const [word, why] of BANNED) {
    it(`没有「${word}」—— ${why}`, () => {
      const hit = sources
        .flatMap(([f, src]) => src.split('\n')
          .map((l, i) => [f, i + 1, l] as const)
          .filter(([, , l]) => l.includes(word)))
        .map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 90)}`);
      expect(hit, hit.join('\n')).toEqual([]);
    });
  }
});

describe('界面文案：关键标签是产品词', () => {
  it('配置向导的五步用的是通用叫法', () => {
    expect(AGENT_STEPS.map((s) => s.name))
      .toEqual(['基本信息', '系统提示词', '任务与工具', '模型', '执行权限']);
  });

  it('审批与风险档的标签不含疑问句式', () => {
    for (const v of [...Object.values(APPROVAL_LABEL), ...Object.values(RISK_LABEL),
      ...Object.values(AUTONOMY_LABEL), ...SETTINGS_SUB.map((s) => s.hint ?? '')]) {
      expect(v, v).not.toMatch(/[？?]|哪一档|哪儿|什么/);
    }
  });
});
