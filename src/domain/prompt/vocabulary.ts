import type { CineKey, GelKey, PoseKey } from '@/domain/assets/model';

/** 镜头语言词表：每项 = [界面名, 英文片段, 白话解释]。one=true 单选，否则多选 */
export interface CineOption {
  readonly t: string;
  readonly hint?: string;
  readonly one?: boolean;
  readonly o: readonly (readonly [string, string, string])[];
}

export const CINE: Record<CineKey, CineOption> = {
  size: {
    t: '景别', one: true, hint: '主体在画面里占多大', o: [
      ['大远景', 'extreme wide shot, tiny subject in vast environment', '交代环境，人只是一个点'],
      ['远景', 'wide shot', '看得清全身和周围关系'],
      ['全景', 'full shot, head to toe', '人物完整入画'],
      ['中景', 'medium shot, waist up', '对话戏的常用景别'],
      ['中近景', 'medium close-up, chest up', '能看清表情又保留一点环境'],
      ['近景', 'close-up on face', '情绪戏'],
      ['特写', 'extreme close-up', '眼睛、手、道具细节'],
    ],
  },
  angle: {
    t: '特殊机位', one: true, hint: '圆盘和角度表达不了的几种，会叠加在机位之上', o: [
      ['荷兰角', 'dutch angle, tilted horizon', '画面倾斜，失衡、不安'],
      ['过肩', 'over-the-shoulder shot with foreground shoulder', '对话戏，前景带一个肩膀'],
      ['主观', 'POV shot, first person view', '让观众变成角色本人'],
      ['顶拍', 'overhead top-down shot', '正上方垂直向下，像看棋盘'],
    ],
  },
  lens: {
    t: '焦段', one: true, hint: '透视关系和空间压缩', o: [
      ['广角', '24mm wide angle lens', '空间被拉开，边缘变形'],
      ['标准', '50mm lens, natural perspective', '接近肉眼'],
      ['中长焦', '85mm portrait lens', '人像常用，背景虚化自然'],
      ['长焦', '135mm telephoto, compressed perspective', '前后景被压扁，有窥视感'],
      ['微距', 'macro lens, extreme detail', '极小的东西占满画面'],
    ],
  },
  dof: {
    t: '景深', one: true, hint: '画面里有多少东西是清楚的', o: [
      ['浅景深', 'shallow depth of field, creamy bokeh', '只留主体清楚'],
      ['中等', 'moderate depth of field', '主体清楚，环境可辨'],
      ['深景深', 'deep focus, everything in focus', '前后都清楚，信息量大'],
    ],
  },
  cam: {
    t: '运镜', one: true, hint: '摄影机怎么动', o: [
      ['固定', 'static shot, locked off', '不动，最稳，成功率最高'],
      ['推镜', 'slow push in', '逼近，收紧情绪'],
      ['拉镜', 'slow pull out', '抽离，揭示环境'],
      ['摇镜', 'panning shot', '原地转，扫过空间'],
      ['移镜', 'tracking shot', '平移跟随'],
      ['跟镜', 'following shot from behind', '跟在人物后面'],
      ['环绕', 'orbiting camera', '绕主体转，强调'],
      ['手持', 'handheld, subtle camera shake', '纪实感、紧张感'],
    ],
  },
  light: {
    t: '光线', hint: '可多选', o: [
      ['自然光', 'natural lighting', '不做戏，靠环境'],
      ['逆光', 'backlit, strong rim light', '轮廓发亮，看不清脸'],
      ['侧光', 'side lighting, strong modeling', '立体感强，一半在暗处'],
      ['顶光', 'top lighting', '眼窝发暗，压抑'],
      ['低调', 'low-key lighting, deep shadows', '大面积暗部'],
      ['高调', 'high-key lighting, bright and airy', '明亮通透'],
      ['实用光', 'practical light source visible in frame', '画面里能看见光源本身'],
      ['黄金时刻', 'golden hour, warm low sun', '日出日落前后那一小时'],
      ['蓝调时刻', 'blue hour, cool ambient', '天刚黑没黑透'],
      ['霓虹', 'neon lighting, colored spill', '城市夜戏'],
    ],
  },
  comp: {
    t: '构图', hint: '可多选', o: [
      ['三分法', 'rule of thirds composition', '主体在三分线上'],
      ['中心构图', 'centered symmetrical subject', '正中，庄重或呆板'],
      ['对称', 'symmetrical framing', '左右镜像'],
      ['前景遮挡', 'foreground framing, object in foreground', '借前景造纵深'],
      ['引导线', 'leading lines toward subject', '用线条把视线引过去'],
      ['留白', 'negative space around subject', '大片空，讲孤独'],
    ],
  },
  time: {
    t: '时间天气', hint: '可多选', o: [
      ['清晨', 'early morning', ''], ['正午', 'midday harsh sun', ''], ['黄昏', 'dusk', ''],
      ['夜晚', 'night', ''], ['雨', 'rain, wet surfaces', ''], ['雾', 'fog, low visibility', ''],
      ['雪', 'snow', ''], ['阴天', 'overcast, soft flat light', ''],
    ],
  },
  mood: {
    t: '氛围', hint: '可多选', o: [
      ['温暖', 'warm and intimate mood', ''], ['孤独', 'lonely, isolated feeling', ''],
      ['紧张', 'tense, suspenseful', ''], ['压迫', 'oppressive, claustrophobic', ''],
      ['梦境', 'dreamlike, ethereal', ''], ['怀旧', 'nostalgic, faded memory', ''],
    ],
  },
};

/** 每个刻度配一句白话 —— 用户读的是这句，不是术语 */
export const SAY: Partial<Record<CineKey, Record<string, string>>> = {
  size: { '大远景': '人只是一个点', '远景': '看得清全身和周围', '全景': '全身刚好入画', '中景': '腰部以上', '中近景': '胸部以上', '近景': '脸占主要位置', '特写': '眼睛、手、细节' },
  angle: { '俯拍': '从上往下看，显得弱小', '平视': '平等、中性', '仰拍': '从下往上看，有压迫感' },
  cam: { '固定': '不动，最稳，最容易出片', '推镜': '缓缓逼近，收紧情绪', '跟镜': '跟着人走', '手持': '轻微晃动，纪实感' },
  dof: { '深景深': '前后都清楚', '中等': '主体清楚，环境可辨', '浅景深': '只留主体，背景化掉' },
};

export const cineFrag = (k: CineKey, name: string): string =>
  CINE[k].o.find((x) => x[0] === name)?.[1] ?? '';

export const camOrder = CINE.cam.o.map((x) => x[0]);
export const dofOrder = CINE.dof.o.map((x) => x[0]);

/** 色片：影视常用的几种，外加自定义取色 */
export interface Gel {
  readonly k: GelKey;
  readonly n: string;
  readonly c: string;
  readonly f: string;
}

export const GELS: readonly Gel[] = [
  { k: 'none', n: '无色', c: '#FFFFFF', f: '' },
  { k: 'amber', n: '琥珀', c: '#FFB14E', f: 'warm amber gel' },
  { k: 'sunset', n: '日落橙', c: '#FF7A45', f: 'sunset orange light' },
  { k: 'magenta', n: '品红', c: '#FF5FA2', f: 'magenta gel' },
  { k: 'cyan', n: '青', c: '#4FD1D9', f: 'cyan gel' },
  { k: 'blue', n: '电光蓝', c: '#4A7CFF', f: 'electric blue light' },
  { k: 'violet', n: '紫', c: '#9B6BFF', f: 'violet gel' },
  { k: 'mint', n: '薄荷绿', c: '#5FD68B', f: 'mint green light' },
  { k: 'red', n: '血红', c: '#E8384F', f: 'deep red light' },
];

export const gelOf = (k: GelKey): Gel => GELS.find((g) => g.k === k) ?? GELS[0]!;

/** 自定义色 → 一句能进提示词的描述。纯 JS：提示词合成不能依赖 WebGL */
export function hueName(hex: string): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || '#ffffff'));
  if (!m) return 'neutral white light';
  const r = parseInt(m[1]!, 16) / 255, g = parseInt(m[2]!, 16) / 255, b = parseInt(m[3]!, 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dd = mx - mn;
  const sat = dd === 0 ? 0 : dd / (1 - Math.abs(2 * l - 1));
  if (sat < 0.12) return l > 0.6 ? 'neutral white light' : 'dim neutral light';
  let h: number;
  if (mx === r) h = ((g - b) / dd) % 6;
  else if (mx === g) h = (b - r) / dd + 2;
  else h = (r - g) / dd + 4;
  h = (h * 60 + 360) % 360;
  const n = h < 15 ? 'red' : h < 40 ? 'orange' : h < 68 ? 'amber yellow' : h < 160 ? 'green'
    : h < 195 ? 'cyan' : h < 250 ? 'blue' : h < 290 ? 'violet' : h < 330 ? 'magenta' : 'red';
  return `${n}-tinted light`;
}

export const gelFrag = (gel: GelKey, gelHex?: string): string =>
  gel === 'custom' ? hueName(gelHex || '#ffffff') : gelOf(gel).f;

/** 器材：选的是真东西，不是「标准焦段」 */
export interface GearOption {
  readonly t: string;
  readonly o: readonly (readonly [string, string, string])[]; // [值, 英文片段, 白话]
}

export const GEAR: Record<'body' | 'lensKit' | 'mm' | 'fstop', GearOption> = {
  body: {
    t: '机身', o: [
      ['ARRI Alexa 35', 'shot on ARRI Alexa 35, digital cinema, clean highlights', '数字电影机 · 通用'],
      ['IMAX Film Camera', 'shot on IMAX 65mm film, extreme detail and grain', '大画幅胶片 · 史诗感'],
      ['Sony VENICE 2', 'shot on Sony VENICE 2, rich color science', '数字 · 色彩厚'],
      ['16mm Bolex', 'shot on 16mm Bolex, heavy film grain, vintage texture', '小胶片 · 粗颗粒复古'],
    ],
  },
  lensKit: {
    t: '镜头', o: [
      ['ARRI Signature Prime', 'ARRI Signature Prime lens, clean modern rendering', '现代干净'],
      ['Cooke S4', 'Cooke S4 lens, warm skin tones, classic look', '奶油人像'],
      ['Panavision C Series', 'Panavision anamorphic lens, oval bokeh and flares', '宽银幕 · 横向光斑'],
      ['Helios 44-2', 'Helios 44-2 lens, swirly bokeh, vintage aberration', '旋焦 · 老镜'],
    ],
  },
  mm: {
    t: '焦段', o: [
      ['14mm', '14mm ultra wide, strong perspective distortion', '极广 · 强变形'],
      ['24mm', '24mm wide angle', '广角'],
      ['35mm', '35mm lens', '小广角 · 最常用'],
      ['50mm', '50mm standard lens, natural perspective', '接近肉眼'],
      ['85mm', '85mm portrait lens', '人像'],
      ['135mm', '135mm telephoto, compressed perspective', '长焦 · 压缩空间'],
      ['200mm', '200mm super telephoto, heavy compression', '超长焦 · 窥视感'],
    ],
  },
  fstop: {
    t: '光圈', o: [
      ['f/1.4', 'f/1.4, extremely shallow depth of field', '极浅 · 只留眼睛'],
      ['f/2.8', 'f/2.8, shallow depth of field', '浅 · 人像常用'],
      ['f/4', 'f/4, moderate depth of field', '适中'],
      ['f/8', 'f/8, deep focus', '深 · 前后都清楚'],
      ['f/11', 'f/11, everything sharp', '极深 · 风景'],
    ],
  },
};

export const GEAR_KEYS = ['body', 'lensKit', 'mm', 'fstop'] as const;
export type GearKey = (typeof GEAR_KEYS)[number];

export const gearFrag = (k: GearKey, v: string): string => GEAR[k].o.find((x) => x[0] === v)?.[1] ?? '';

/** 姿态 → 提示词片段（与 three/ 的动画采样同名档） */
export const POSE_FRAG: Record<PoseKey, string> = {
  stand: 'neutral standing',
  walk: 'mid-stride walking',
  run: 'running',
  sad: 'head-down dejected',
  sneak: 'crouched sneaking',
  agree: 'slightly forward nodding',
  reach: 'right arm extended reaching',
  lookback: 'turned away, looking back over shoulder',
  crouch: 'crouching low',
};

/** 画风 → 提示词。资产形状照与分镜共用这一份映射 */
export const STYLEMAP: Record<string, string> = {
  '温暖手绘': 'warm hand-painted',
  '3D 动画': '3D animated render',
  '日式赛璐璐': 'anime cel shading',
  '水彩绘本': 'watercolor storybook style',
  '厚涂写实': 'thick impasto painting',
  '胶片质感': 'film photography, grainy',
  '黏土定格': 'claymation stop-motion',
  '像素风': 'pixel art',
};

export const STYLES = Object.keys(STYLEMAP);

/** 镜头意图：入口不是「选景别」，是「想让观众感觉到什么」。
 *  每条背后是一整套专业参数，选完能看见它翻译成了什么。 */
export interface Intent {
  readonly n: string;
  readonly d: string;
  /** 各维度取值；lens/dof 会在应用时换算成 mm/fstop */
  readonly c: Partial<Record<CineKey, string | string[]>>;
}

export const INTENT: readonly Intent[] = [
  { n: '交代这是什么地方', d: '人很小，环境是主角',
    c: { size: '大远景', angle: '平视', lens: '广角', dof: '深景深', cam: '固定', comp: ['引导线'] } },
  { n: '看清她在做什么', d: '全身入画，动作清楚',
    c: { size: '全景', angle: '平视', lens: '标准', dof: '中等', cam: '固定', comp: ['三分法'] } },
  { n: '靠近她的情绪', d: '脸占主要位置，背景化掉',
    c: { size: '近景', angle: '平视', lens: '中长焦', dof: '浅景深', cam: '推镜', mood: ['温暖'] } },
  { n: '揭示一个细节', d: '把小东西放到最大',
    c: { size: '特写', angle: '平视', lens: '微距', dof: '浅景深', cam: '推镜', comp: ['中心构图'] } },
  { n: '让她显得渺小', d: '从上往下看，四周留白',
    c: { size: '远景', angle: '俯拍', lens: '长焦', dof: '深景深', cam: '固定', comp: ['留白'], mood: ['孤独'] } },
  { n: '制造压迫感', d: '从下往上看，大片阴影',
    c: { size: '中近景', angle: '仰拍', lens: '广角', dof: '浅景深', cam: '固定', light: ['低调', '顶光'], mood: ['压迫'] } },
  { n: '跟着她走', d: '手持跟随，纪实感',
    c: { size: '中景', angle: '平视', lens: '标准', dof: '中等', cam: '手持', mood: ['紧张'] } },
  { n: '两个人的对话', d: '过肩，建立视线关系',
    c: { size: '中近景', angle: '过肩', lens: '中长焦', dof: '浅景深', cam: '固定' } },
];

/** 意图卡 → rig 上的整套参数（含 lens/dof → mm/fstop 换算）。返回 patch，由调用方合并 */
export function intentPatch(it: Intent): Partial<{
  size: string; angle: RigAngle; cam: string; mm: string; fstop: string;
  light: string[]; comp: string[]; time: string[]; mood: string[];
  addDims: CineKey[];
}> & { dist?: number } {
  const c = it.c;
  const patch: ReturnType<typeof intentPatch> = {};
  const addDims = new Set<CineKey>();
  const set = (k: CineKey) => addDims.add(k);
  if (typeof c.size === 'string') { patch.size = c.size; set('size'); }
  if (typeof c.angle === 'string') {
    if (c.angle === '俯拍') patch.dist = 1;
    if (['荷兰角', '过肩', '主观', '顶拍'].includes(c.angle)) patch.angle = c.angle as RigAngle;
    set('angle');
  }
  if (typeof c.cam === 'string') { patch.cam = c.cam; set('cam'); }
  if (typeof c.lens === 'string') {
    patch.mm = ({ '广角': '24mm', '标准': '50mm', '中长焦': '85mm', '长焦': '135mm', '微距': '85mm' })[c.lens] ?? '50mm';
    set('lens');
  }
  if (typeof c.dof === 'string') {
    patch.fstop = ({ '浅景深': 'f/1.4', '中等': 'f/4', '深景深': 'f/8' })[c.dof] ?? 'f/4';
    set('dof');
  }
  for (const k of ['light', 'comp', 'time', 'mood'] as const) {
    const v = c[k];
    if (Array.isArray(v)) { patch[k] = [...v]; set(k); }
  }
  patch.addDims = [...addDims];
  return patch;
}

export type RigAngle = '' | '荷兰角' | '过肩' | '主观' | '顶拍';
