/**
 * Mock 媒体映射：占位图关键词与样片池。
 * loremflickr 的 lock 参数保证同一 seed 固定同一张；视频按 id 固定一段。
 * 接真实生成 API 后，整个文件被真实媒体 URL 替换。
 */
export const MEDIA_KEYWORDS: Record<string, string> = {
  c1: 'girl,child', c2: 'white,cat', s1: 'bedroom,window', s2: 'veterinary',
  s3: 'temple,egypt', s4: 'museum,egypt', p1: 'sketchbook,drawing', p2: 'old,photograph', p3: 'glow,teal',
  's1-1': 'girl,cat,window', 's1-2': 'sketchbook,cat', 's1-3': 'cat,eyes', 's1-4': 'glow,light',
  's2-1': 'cat,door', 's2-2': 'girl,cat,sleeping', 's3-1': 'cat,sick', 's3-2': 'girl,rain,running',
  'cats-cover': 'cat,kitten', 'rain-cover': 'rain,night', 'hero-cover2': 'kitten,window',
  'CHAR-001': 'girl,child', 'CHAR-002': 'white,cat', 'PROP-001': 'sketchbook,drawing', STYLE: 'cat,art',
};

export const SAMPLE_VIDEOS = [
  'ForBiggerBlazes', 'ForBiggerEscapes', 'ForBiggerFun', 'ForBiggerJoyrides',
  'ForBiggerMeltdowns', 'BigBuckBunny', 'ElephantsDream', 'Sintel', 'TearsOfSteel',
];
