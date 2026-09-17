// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { defaultConfigs, ownerOfConfigured } from '@/domain/agent/config';
import type { AgentConfig } from '@/domain/agent/config';
import type { AgentId } from '@/domain/agent/roster';
import { useSettings } from './settings';

/**
 * 存在浏览器里的配置要跟上代码的变化。
 *
 * 真出过的问题：「按节拍自动成片」需要的工具从 file.export 改成了 shot.write。
 * 存过的那份配置里剪辑还拿着旧工具，于是它接不了自己认领的活儿，
 * Skill 管理页就显示「1 件活儿没人接」—— 而用户什么都没改过。
 */
const merge = (persisted: unknown) => {
  // 直接取 persist 选项里的 merge：它就是升级逻辑本身
  const opt = (useSettings as unknown as { persist: { getOptions: () => { merge?: (p: unknown, c: unknown) => unknown } } })
    .persist.getOptions().merge!;
  return opt(persisted, useSettings.getState()) as { agents: Record<AgentId, AgentConfig> };
};

describe('设置的版本迁移', () => {
  it('工具表变过之后，存的配置仍然接得住它认领的活儿', () => {
    const stale = defaultConfigs();
    // 模拟旧版本：剪辑拿着旧工具（没有 shot.write）
    stale.editor = { ...stale.editor, tools: ['project.read', 'file.export'] };
    expect(ownerOfConfigured('edit.autocut', stale), '构造的场景本身要复现问题').toBeUndefined();

    const { agents } = merge({ agents: stale });
    expect(agents.editor.tools).toContain('shot.write');
    expect(ownerOfConfigured('edit.autocut', agents)).toBe('editor');
  });

  it('12 件活儿迁移后都有人接', () => {
    const stale = defaultConfigs();
    for (const id of Object.keys(stale) as AgentId[]) {
      stale[id] = { ...stale[id], tools: ['project.read'] };   // 把工具全撸掉
    }
    const { agents } = merge({ agents: stale });
    for (const kind of ['outline.draft', 'script.draft', 'assets.extract', 'assets.views',
      'style.transfer', 'shots.generate', 'shots.prompt', 'video.batch',
      'edit.autocut', 'cost.report'] as const) {
      expect(ownerOfConfigured(kind, agents), `${kind} 没人接`).toBeTruthy();
    }
  });

  it('只补它认领的活儿要用的工具，不顺带给别的能力', () => {
    const stale = defaultConfigs();
    stale.editor = { ...stale.editor, tools: ['project.read'] };
    const { agents } = merge({ agents: stale });
    // 剪辑不认领出图，就不该拿到出图工具
    expect(agents.editor.tools).not.toContain('image.generate');
    expect(agents.editor.tools).not.toContain('video.generate');
  });

  it('用户手动勾掉的、与认领无关的工具不会被加回来', () => {
    const stale = defaultConfigs();
    // 摄影指导认领的活儿里没有 web.fetch，勾掉它是用户的选择
    stale.dp = { ...stale.dp, tools: stale.dp.tools.filter((t) => t !== 'stage.render') };
    const { agents } = merge({ agents: stale });
    expect(agents.dp.tools).not.toContain('stage.render');
  });

  it('班底加人了：存的那份里缺的 agent 补默认值，不整份丢弃', () => {
    const partial = { ...defaultConfigs() } as Partial<Record<AgentId, AgentConfig>>;
    delete partial.producer;
    const { agents } = merge({ agents: partial });
    expect(agents.producer).toBeTruthy();
    expect(agents.writer).toBeTruthy();
  });
});
