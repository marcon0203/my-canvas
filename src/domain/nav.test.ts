import { describe, expect, it } from 'vitest';
import { SECTIONS, SETTINGS_SUB, STEPS, WORKBENCH_SUB, defaultSub, isValidSub, sectionOf } from './nav';
import type { Step } from '@/store/ui';

describe('domain/nav', () => {
  it('STEPS 从二级菜单派生 —— 不是另写一份', () => {
    expect([...STEPS]).toEqual(WORKBENCH_SUB.map((s) => s.k));
  });

  it('每个阶段键都是合法的 Step，路由直达时认得', () => {
    const valid: Step[] = ['outline', 'script', 'assets', 'storyboard', 'editing', 'overview', 'metrics'];
    expect([...STEPS].sort()).toEqual([...valid].sort());
  });

  it('默认二级项就是菜单第一个，不是写死的键', () => {
    expect(defaultSub('settings')).toBe(SETTINGS_SUB[0]!.k);
    expect(defaultSub('workbench')).toBe(WORKBENCH_SUB[0]!.k);
  });

  it('没有二级菜单的大区默认项为空，不瞎给一个', () => {
    expect(defaultSub('resources')).toBe('');
  });

  it('二级键校验挡住乱填的段', () => {
    for (const s of SETTINGS_SUB) expect(isValidSub('settings', s.k)).toBe(true);
    for (const bad of ['', 'nope', 'Models', 'constructor']) {
      expect(isValidSub('settings', bad), bad).toBe(false);
    }
  });

  it('每个大区都能取到，键不重复', () => {
    for (const s of SECTIONS) expect(sectionOf(s.id).id).toBe(s.id);
    const keys = SETTINGS_SUB.map((s) => s.k);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
