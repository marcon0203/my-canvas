import { describe, expect, it } from 'vitest';
import { lockAsset, unlockAsset } from './model';
import { unlockedRefs, driftedRefs } from './locking';
import { applyVerdict, byModel, bySize, hitRate, totalTries, usableShots } from '@/domain/metrics/model';
import { addShot, type Shot } from '@/domain/shots/model';
import type { Asset } from './model';

const asset = (aid: string, status: Asset['status'], ver: number): Asset =>
  ({ id: aid, aid, name: aid, desc: '', ver, status, views: [] });

const shot = (over: Partial<Shot>): Shot => ({
  id: 's1-1', sceneKey: '场景1', size: '全景', desc: '', dur: 2, refs: [], own: '',
  model: 'M', batch: 1, key: false, vid: 'none', takes: 0, verdict: null,
  ejected: false, refVer: {}, rig: { ...({} as Shot['rig']) },
  ...over,
});

describe('assets/locking', () => {
  const byAid = (aid: string) => [asset('CHAR-001', 'locked', 2), asset('PROP-001', 'draft', 1)]
    .find((a) => a.aid === aid);

  it('未定稿引用被拦下', () => {
    const s = { refs: ['CHAR-001', 'PROP-001', 'GHOST'], refVer: {} };
    expect(unlockedRefs(s, byAid)).toEqual(['PROP-001', 'GHOST']);
  });

  it('升版后旧引用标记漂移，锁定同版不标', () => {
    const s = { refs: ['CHAR-001'], refVer: { 'CHAR-001': 1 } };
    expect(driftedRefs(s, byAid)).toEqual(['CHAR-001']);
    s.refVer['CHAR-001'] = 2;
    expect(driftedRefs(s, byAid)).toEqual([]);
  });

  it('锁定/升版改变版本语义', () => {
    const a = asset('CHAR-001', 'draft', 0);
    lockAsset(a);
    expect(a.status).toBe('locked');
    expect(a.ver).toBe(1);
    expect(unlockAsset(a)).toBe(2);
    expect(a.status).toBe('draft');
  });
});

describe('shots/model', () => {
  it('新镜头插在该场最后一镜之后，id 自增不撞车', () => {
    const shots: Shot[] = [
      shot({ id: 's1-1' }), shot({ id: 's3-1', sceneKey: '场景3' }), shot({ id: 's3-2', sceneKey: '场景3' }),
    ];
    const s = addShot(shots, '场景3');
    expect(s.id).toBe('s3-3');
    expect(shots.indexOf(s)).toBe(3);
    const s2 = addShot(shots, '场景3');
    expect(s2.id).toBe('s3-4');
  });
});

describe('metrics/model', () => {
  const shots: Shot[] = [
    shot({ model: 'A', size: '全景', takes: 4, verdict: 'ok' }),
    shot({ model: 'A', size: '特写', takes: 8, verdict: 'redo' }),
    shot({ model: 'B', size: '特写', takes: 2, verdict: 'ok' }),
    shot({ model: 'B', size: '全景', takes: 0, verdict: null }),
  ];

  it('命中率 = 可用镜头 ÷ 累计生成次数', () => {
    expect(totalTries(shots)).toBe(14);
    expect(usableShots(shots)).toBe(2);
    expect(hitRate(shots)).toBe(14);
    expect(hitRate([shot({ takes: 0 })])).toBe(0);
  });

  it('按模型与景别归因', () => {
    expect(byModel(shots)['A']).toEqual({ tries: 12, usable: 1 });
    expect(bySize(shots)['特写']).toEqual({ tries: 10, usable: 1 });
  });

  it('判定写回带记账', () => {
    const s = shot({ takes: 2 });
    applyVerdict(s, 'redo', 4);
    expect(s.verdict).toBe('redo');
    expect(s.takes).toBe(6);
  });
});
