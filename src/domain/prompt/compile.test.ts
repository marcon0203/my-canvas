import { describe, expect, it } from 'vitest';
import { viewPrompt, compileShot, segmentsText } from './compile';import { intentPatch, gelFrag, hueName } from './vocabulary';
import { viewRig, type Asset, type AssetView } from '@/domain/assets/model';

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
