// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ProviderList } from './ProviderSettings';
import { useSettings } from '@/store/settings';

/**
 * 读不了的那几份配置文件要摆在明面上。
 *
 * **默默跳过是最坏的做法。** 手写 YAML 缩进差一格是常事，跳过的结果是
 * 「我明明配了 DeepSeek，设置页里怎么没有」—— 而人根本不会想到是那个文件
 * 写坏了，更不会知道去哪儿找它。
 */
function mount(): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<ProviderList onOpen={() => {}} />); });
  const html = host.textContent ?? '';
  act(() => { root.render(null); });
  host.remove();
  return html;
}

beforeEach(() => {
  useSettings.setState({ providers: {}, badProviders: [] });
});

describe('读不了的配置文件', () => {
  it('说清有几份、是哪个文件、哪儿坏了、去哪儿找', () => {
    useSettings.setState({
      badProviders: [['moonshot', 'moonshot.yaml 格式不对：缩进错了']],
    });
    const t = mount();
    expect(t).toContain('1 份配置文件读不了');
    expect(t, '得说是哪个文件').toContain('moonshot.yaml');
    expect(t, '得说哪儿坏了').toContain('缩进错了');
    expect(t, '得说去哪儿找它').toContain('providers');
  });

  it('全都好的时候不摆这一块', () => {
    expect(mount()).not.toContain('读不了');
  });

  it('坏了几份就说几份', () => {
    useSettings.setState({
      badProviders: [['a', 'a 坏了'], ['b', 'b 坏了']],
    });
    const t = mount();
    expect(t).toContain('2 份配置文件读不了');
    expect(t).toContain('a.yaml');
    expect(t).toContain('b.yaml');
  });
});
