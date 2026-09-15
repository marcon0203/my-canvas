import { describe, expect, it } from 'vitest';
import { viewPrompt, viewPromptText, isViewEjected, compileShot, segmentsText } from './compile';
import { intentPatch, gelFrag, hueName } from './vocabulary';
import { defaultRig, viewRig, type Asset, type AssetView } from '@/domain/assets/model';

const view = (name: string, prompt: string, style = '温暖手绘'): AssetView =>
  ({ name, style, gen: true, redo: 0, prompt });

const asset = (views: AssetView[]): Asset =>
  ({ id: 'c1', aid: 'CHAR-001', name: '艾米', desc: '11 岁小女孩', ver: 1, status: 'locked', views });

describe('prompt/compile', () => {
  it('形状照提示词 = 风格 + 描述 + 镜头语言，惰性 rig 自动按名称反推', () => {
    const a = asset([view('背面', '白猫背影')]);
    const p = viewPrompt(a.views[0]!);
    expect(p).toContain('warm hand-painted');
    expect(p).toContain('白猫背影');
    expect(p).toContain('seen from directly behind');
    expect(viewRig(a.views[0]!).az).toBe(180);
  });

  it('poseMode=text 时姿态进提示词，img 时不进', () => {
    const a = asset([view('正面', '描述')]);
    const v = a.views[0]!;
    const r = viewRig(v);
    expect(viewPrompt(v)).not.toContain('pose');
    r.poseMode = 'text';
    r.pose = 'run';
    expect(viewPrompt(v)).toContain('running');
  });

  it('分镜提示词三段式：画风 + 资产 + 本镜内容，且可整体转文本', () => {
    const segs = compileShot(
      { style: '胶片质感', refs: ['CHAR-001'], own: 'girl running in rain' },
      { globalStylePrompt: 'global style', assetDescOf: (aid) => aid === 'CHAR-001' ? '11 岁小女孩' : undefined },
    );
    expect(segs.map((s) => s.k)).toEqual(['style', 'ref', 'own']);
    expect(segmentsText(segs)).toBe('film photography, grainy, 11 岁小女孩, girl running in rain');
  });

  it('未定稿/未知引用不进提示词', () => {
    const segs = compileShot(
      { refs: ['GHOST-999'], own: 'x' },
      { globalStylePrompt: 'g', assetDescOf: () => undefined },
    );
    expect(segs.some((s) => s.k === 'ref')).toBe(false);
  });
});

describe('prompt/vocabulary', () => {
  it('意图卡 → rig patch：lens/dof 换算为 mm/fstop，维度进 addDims', () => {
    const p = intentPatch({
      n: 'x', d: 'y',
      c: { size: '近景', angle: '仰拍', lens: '中长焦', dof: '浅景深', cam: '推镜', mood: ['温暖'] },
    });
    expect(p.mm).toBe('85mm');
    expect(p.fstop).toBe('f/1.4');
    expect(p.cam).toBe('推镜');
    expect(p.addDims).toContain('lens');
    expect(p.addDims).toContain('dof');
  });

  it('色片与自定义取色都有提示词描述', () => {
    expect(gelFrag('amber')).toBe('warm amber gel');
    expect(gelFrag('custom', '#FF0000')).toBe('red-tinted light');
    expect(hueName('#ffffff')).toBe('neutral white light');
  });
});

describe('形状照提示词可手改', () => {
  const view = (): AssetView => ({
    name: '正面', style: '温暖手绘', gen: false, redo: 0, prompt: '正面半身',
    rig: defaultRig('正面'),
  });

  it('没手改时跟着画风与镜头语言走', () => {
    const v = view();
    expect(isViewEjected(v)).toBe(false);
    expect(viewPromptText(v)).toBe(viewPrompt(v));
    v.style = '像素风';
    expect(viewPromptText(v)).toContain('pixel art');
  });

  it('手改后脱管：改画风不再影响这条', () => {
    const v = view();
    v.custom = '我自己写的提示词';
    expect(isViewEjected(v)).toBe(true);
    v.style = '像素风';
    expect(viewPromptText(v)).toBe('我自己写的提示词');
    expect(viewPrompt(v)).toContain('pixel art');   // 自动合成那条仍在，随时可交回
  });

  it('空字符串也算手改 —— 清空是一种选择，不该被当成没改', () => {
    const v = view();
    v.custom = '';
    expect(isViewEjected(v)).toBe(true);
    expect(viewPromptText(v)).toBe('');
  });
});

describe('节点级画风「全局」跟项目走', () => {
  const v = (style: string): AssetView => ({
    name: '正面', style, gen: false, redo: 0, prompt: '正面半身', rig: defaultRig('正面'),
  });

  it('「全局」解析成项目画风，不把「全局」两个字塞进提示词', () => {
    const p = viewPrompt(v('全局'), 'warm hand-painted, film grain');
    expect(p).toContain('warm hand-painted');
    expect(p).not.toContain('全局');
  });

  it('节点级画风压过项目画风', () => {
    const p = viewPrompt(v('像素风'), 'warm hand-painted');
    expect(p).toContain('pixel art');
    expect(p).not.toContain('warm hand-painted');
  });

  it('词表里没有的自定义风格名原样带上', () => {
    expect(viewPrompt(v('我的风格'), '')).toContain('我的风格');
  });
});
