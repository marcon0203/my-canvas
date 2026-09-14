import { MEDIA_KEYWORDS, SAMPLE_VIDEOS } from '@/mock/media';

/**
 * 占位媒体源：关键词映射与样片池在 mock 层（mock/media.ts），
 * 本文件只负责确定性地生成 URL。接真实生成 API 后整体替换。
 */
function seeded(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const kwFor = (seed: string): string => {
  if (MEDIA_KEYWORDS[seed]) return MEDIA_KEYWORDS[seed]!;
  const shot = seed.match(/^s\d+-\d+/);
  if (shot && MEDIA_KEYWORDS[shot[0]!]) return MEDIA_KEYWORDS[shot[0]!]!;
  const pre = seed.match(/^[csp]\d/);
  if (pre && MEDIA_KEYWORDS[pre[0]!]) return MEDIA_KEYWORDS[pre[0]!]!;
  return 'cat,kitten';
};

export const imgUrl = (seed: string, w: number, h: number): string => {
  const lock = Math.floor(seeded(String(seed))() * 1e6);
  return `https://loremflickr.com/${w}/${h}/${kwFor(seed)}?lock=${lock}`;
};

export type MediaRatio = 'wide' | 'tall' | 'portrait';

export const imgUrlFor = (seed: string, ratio: MediaRatio): string =>
  ratio === 'wide' ? imgUrl(seed, 480, 270) : ratio === 'tall' ? imgUrl(seed, 360, 640) : imgUrl(seed, 360, 480);

export const vidUrl = (id: string): string =>
  `https://storage.googleapis.com/gtv-videos-bucket/sample/${SAMPLE_VIDEOS[Math.floor(seeded(String(id))() * SAMPLE_VIDEOS.length)]!}.mp4`;
