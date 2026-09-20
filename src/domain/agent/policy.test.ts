import { describe, expect, it } from 'vitest';
import { TOOLS, TOOLS_FOR_INTENT, type ToolId } from './tools';
import { INTENT_META } from './roster';
import {
  AUTO_MAX_CHOICES, DEFAULT_AUTO_MAX, autoAllowed, holdReason,
  riskOfIntent, riskOfProposal, riskOfTool, type Risk,
} from './policy';
import type { IntentKind, Proposal } from './types';

const prop = (patch: Proposal['patch'], cost?: number): Proposal =>
  ({ title: 't', rows: [], patch, ...(cost ? { cost } : {}) }) as Proposal;

describe('agent/policy · 自主执行的边界', () => {
  it('每个工具都分得出档，没有漏网的', () => {
    for (const t of TOOLS) expect(riskOfTool(t.id)).toBeTruthy();
  });

  it('出图出视频算花钱 —— 撤销退不回积分', () => {
    expect(riskOfTool('image.generate')).toBe('spend');
    expect(riskOfTool('video.generate')).toBe('spend');
  });

  it('导出文件算出本机', () => {
    expect(riskOfTool('file.export')).toBe('egress');
  });

  it('渲参考图是本地 WebGL，不该被当成花钱', () => {
    expect(riskOfTool('stage.render')).toBe('read');
  });

  it('读项目、读记账是只读；写大纲写剧本是改项目', () => {
    expect(riskOfTool('project.read')).toBe('read');
    expect(riskOfTool('metrics.read')).toBe('read');
    for (const t of ['outline.write', 'script.write', 'shot.write'] as ToolId[]) {
      expect(riskOfTool(t)).toBe('write');
    }
  });

  it('活儿的风险取它所有工具里最高的那个', () => {
    expect(riskOfIntent('assets.views')).toBe('spend');   // 要出图
    expect(riskOfIntent('video.batch')).toBe('spend');    // 要出视频
    // 自动成片只排时间线，不导出 —— 导出是剪辑页上另一个按钮
    expect(riskOfIntent('edit.autocut')).toBe('write');
    expect(riskOfIntent('cost.report')).toBe('read');     // 只读记账
    expect(riskOfIntent('outline.draft')).toBe('write');
  });

  it('没有哪件活默默带着导出文件的权限 —— 最小权限', () => {
    // 导出应该是用户自己按的按钮，不是某件活顺带拿到的能力
    const withExport = (Object.keys(INTENT_META) as Exclude<IntentKind, 'chat'>[])
      .filter((k) => TOOLS_FOR_INTENT[k].includes('file.export'));
    expect(withExport).toEqual([]);
  });

  it('十二件活都算得出风险', () => {
    for (const k of Object.keys(INTENT_META) as Exclude<IntentKind, 'chat'>[]) {
      expect(riskOfIntent(k), k).toBeTruthy();
      expect(TOOLS_FOR_INTENT[k].length).toBeGreaterThan(0);
    }
  });

  it('产物按补丁的实际后果判，不按谁发起的判', () => {
    // 摄影指导发起，但产物只是改几行字
    expect(riskOfProposal(prop({ t: 'shotPrompts', edits: [] }))).toBe('write');
    // 同样是摄影指导，这份产物背后是真花过钱的视频文件
    expect(riskOfProposal(prop({ t: 'shotFiles', edits: [] }))).toBe('spend');
  });

  it('补形状照算花钱 —— 它就是出图', () => {
    expect(riskOfProposal(prop({ t: 'assetViews', gen: [] }))).toBe('spend');
  });

  it('有标消耗不代表就是花钱那一档 —— 几乎每轮都要一两个积分', () => {
    // 照「有 cost 就算 spend」判，出厂配置下第一步就被挡住，边界成了摆设
    expect(riskOfProposal(prop({ t: 'acts', acts: [] }, 3))).toBe('write');
    expect(autoAllowed(riskOfProposal(prop({ t: 'acts', acts: [] }, 3)))).toBe(true);
  });

  it('想连一两个积分都先问，把上限调到只读 —— 那是明确选择', () => {
    const r = riskOfProposal(prop({ t: 'acts', acts: [] }, 3));
    expect(autoAllowed(r, 'read')).toBe(false);
  });

  it('自动成片只是排时间线，不烧积分', () => {
    expect(riskOfProposal(prop({ t: 'timeline', timeline: { clips: [] } }))).toBe('write');
  });

  it('出厂上限是「能改项目，不能花钱」', () => {
    expect(DEFAULT_AUTO_MAX).toBe('write');
    expect(autoAllowed('write')).toBe(true);
    expect(autoAllowed('read')).toBe(true);
    expect(autoAllowed('spend')).toBe(false);
  });

  it('调到花钱那一档，出图出视频才放行', () => {
    expect(autoAllowed('spend', 'spend')).toBe(true);
    expect(autoAllowed('write', 'spend')).toBe(true);
  });

  it('出本机永远要人点头 —— 上限调到最高也不行', () => {
    for (const m of [...AUTO_MAX_CHOICES, 'egress' as Risk]) {
      expect(autoAllowed('egress', m), `上限 ${m}`).toBe(false);
    }
  });

  it('上限可选项里没有 egress —— 不给「自动导出」这个选择', () => {
    expect(AUTO_MAX_CHOICES).not.toContain('egress');
  });

  /**
   * 与 Rust 侧 conf/src/policy.rs 的对照表。
   * 两边判得不一样，等于其中一边的把关是假的 —— 改任何一边这条都会红。
   */
  it('与 Rust 侧同一套判定（对照 conf/src/policy.rs 的用例）', () => {
    const expected: Record<ToolId, Risk> = {
      'project.read': 'read', 'project.search': 'read', 'metrics.read': 'read',
      'cost.estimate': 'read', 'stage.render': 'read', 'prompt.translate': 'read',

      'outline.write': 'write', 'script.write': 'write', 'asset.write': 'write',
      'asset.lock': 'write', 'shot.write': 'write', 'prompt.compile': 'read',
      'style.apply': 'write', 'shot.rig': 'write',
      'edit.timeline': 'write', 'edit.subtitle': 'write', 'film.render': 'write',

      'image.generate': 'spend', 'image.edit': 'spend', 'image.upscale': 'spend',
      'video.generate': 'spend', 'video.extend': 'spend',
      'audio.tts': 'spend', 'audio.music': 'spend', 'audio.sfx': 'spend',

      'file.export': 'egress', 'web.search': 'egress', 'web.fetch': 'egress',
    };
    // 表里一件不多一件不少 —— 加了工具却没定风险，这条会红
    expect(TOOLS.map((t) => t.id).sort()).toEqual(Object.keys(expected).sort());
    for (const [id, risk] of Object.entries(expected)) {
      expect(riskOfTool(id as ToolId), id).toBe(risk);
    }
  });

  it('没登记风险的工具按最高档算 —— 兜底要 fail-closed', () => {
    // 加了工具却忘了登记时，后果该是「它跑不了，有人来问」，不是「它自动跑了」
    expect(riskOfTool('某个还没登记的' as ToolId)).toBe('egress');
    expect(autoAllowed(riskOfTool('某个还没登记的' as ToolId), 'spend')).toBe(false);
  });

  it('每个工具都标了实现状态，还不能用的说得出缺什么', () => {
    for (const t of TOOLS) {
      expect(['ready', 'unverified', 'declared'], t.id).toContain(t.status);
      if (t.status !== 'ready') expect(t.blockedBy?.length ?? 0, t.id).toBeGreaterThan(4);
    }
  });

  it('出图出视频是「待验证」不是「未实现」—— 协议写完了，差一次真实调用', () => {
    for (const id of ['image.generate', 'video.generate'] as ToolId[]) {
      expect(TOOLS.find((t) => t.id === id)?.status, id).toBe('unverified');
    }
  });

  it('挡下来时说得出为什么，且不同档说法不同', () => {
    const a = holdReason('spend');
    const b = holdReason('egress');
    expect(a).not.toBe(b);
    expect(a).toContain('积分');
    expect(b).toContain('本机');
  });
});
