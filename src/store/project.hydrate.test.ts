// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useProject, waitHydrated } from './project';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';

/**
 * 新建项目后要等内容真的进 store 再让 Agent 开跑。
 *
 * 原来等的是 `setTimeout(900)`：慢机器上 900ms 到了内容还没来，Agent 会在
 * 上一个项目上跑完一整条流水线，而界面已经切过去了，看不出来。
 */

const hydrate = (id: string) => {
  const p = structuredClone(MOCK_PROJECTS['p1']!);
  useProject.getState().hydrate({ project: { ...p, id }, config: structuredClone(MOCK_CONFIG) });
};

describe('waitHydrated', () => {
  it('已经注入过就立刻返回', async () => {
    hydrate('p1');
    await expect(waitHydrated('p1')).resolves.toBeUndefined();
  });

  it('等到注入那一刻才返回 —— 中间注入别的项目不算', async () => {
    hydrate('old');
    const done = vi.fn();
    const p = waitHydrated('new').then(done);

    hydrate('another');            // 注入了另一个项目
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();

    hydrate('new');
    await p;
    expect(done).toHaveBeenCalled();
  });

  it('超时要 reject，不能静默等下去', async () => {
    hydrate('old');
    await expect(waitHydrated('never', 30)).rejects.toThrow('还没加载出来');
  });

  it('超时后再注入不会补一次 resolve（监听已经摘掉）', async () => {
    hydrate('old');
    await expect(waitHydrated('late', 20)).rejects.toThrow();
    hydrate('late');               // 迟到的注入：不该有任何副作用
    await new Promise((r) => setTimeout(r, 20));
  });
});
