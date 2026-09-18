// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditingPage } from './EditingPage';
import { useProject } from '@/store/project';
import { MOCK_PROJECTS } from '@/mock/project';
import { MOCK_CONFIG } from '@/mock/config';

/**
 * 拼成片那个入口。
 *
 * **前置条件要如实摆出来，不做一个点了才知道不行的按钮。** 拼片要三样：
 * 排过时间线、每一镜都有本机视频文件、本机装了 ffmpeg。前两样这儿能查，
 * 查得出来就该先说，而不是让人点一下换回一句错误。
 */
function mount(): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<EditingPage />); });
  const t = host.textContent ?? '';
  act(() => { root.render(null); });
  host.remove();
  return t;
}

beforeEach(() => {
  const t = useProject.temporal.getState();
  t.pause();
  useProject.getState().hydrate({
    project: structuredClone(MOCK_PROJECTS['p1']!),
    config: structuredClone(MOCK_CONFIG),
  });
  t.clear();
  t.resume();
  useProject.setState({ timeline: { clips: [] }, subtitles: { lang: 'zh', cues: [] } });
});

/** 给前两镜配上本机文件 */
const withFiles = (ids: string[]) => {
  useProject.setState((s) => ({
    shots: s.shots.map((sh) => (ids.includes(sh.id) ? { ...sh, file: `media/${sh.id}.mp4` } : sh)),
  }));
};

const lineup = (ids: string[]) => {
  useProject.setState({
    timeline: { clips: ids.map((id, i) => ({ shotId: id, at: i * 1000, dur: 1000 })) },
  });
};

describe('拼成 mp4 的入口', () => {
  it('没排时间线时先说去排，不给按钮', () => {
    const t = mount();
    expect(t).toContain('还没排时间线');
    expect(t).not.toContain('拼成 mp4');
  });

  it('排了但有镜头没视频文件：点名是哪几镜，并说去哪儿出', () => {
    const ids = useProject.getState().shots.slice(0, 3).map((s) => s.id);
    lineup(ids);
    withFiles([ids[0]!]);
    const t = mount();
    expect(t).toContain('还没有视频文件');
    expect(t, '得点名').toContain(ids[1]!);
    expect(t, '得给下一步').toContain('去分镜');
    expect(t).not.toContain('拼成 mp4');
  });

  it('三样齐了才给按钮', () => {
    const ids = useProject.getState().shots.slice(0, 2).map((s) => s.id);
    lineup(ids);
    withFiles(ids);
    const t = mount();
    expect(t).toContain('拼成 mp4');
    expect(t).not.toContain('还没有视频文件');
  });

  it('字幕有没有如实说 —— 烧不烧字幕是看得见的差别', () => {
    const ids = useProject.getState().shots.slice(0, 1).map((s) => s.id);
    lineup(ids);
    withFiles(ids);
    expect(mount()).toContain('没有');

    useProject.setState({
      subtitles: { lang: 'zh', cues: [{ at: 0, dur: 900, text: '他推开门' }] },
    });
    expect(mount()).toContain('1 条，烧进画面');
  });
});
