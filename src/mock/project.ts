import type { Asset } from '@/domain/assets/model';
import type { Shot } from '@/domain/shots/model';
import type { Act, DocBlock } from '@/domain/story/model';
import type { Subtitles, Timeline } from '@/domain/clips/model';

/**
 * Mock 数据：项目内容。与冻结原型《The Dream of Cats》逐字段对齐。
 * 这里只存数据，不含任何行为；应用经 api/mock.ts 拉取后注入 store。
 */

export type { Act, Beat, BlockType, DocBlock } from '@/domain/story/model';

export interface ProjectMock {
  /** 项目稳定 ID：路由 /project/:projectId/:step 用的就是它 */
  id: string;
  proj: string;
  style: string;
  ratio: string;
  credits: number;
  /** 积分预算（记账口径：消耗 = 预算 - 余额） */
  budget: number;
  stylePrompt: string;
  styles: string[];
  acts: Act[];
  blocks: DocBlock[];
  assets: Record<'角色' | '场景' | '道具', Asset[]>;
  shots: Shot[];
  /** 成片顺序与字幕。mock 里不预填 —— 那两步要跑过工具才有东西 */
  timeline?: Timeline;
  subtitles?: Subtitles;
  /** 首页「最近的项目」卡片 */
  /** 总览画布 PIN 栏 */
  pins: { id: string; n: string }[];
}

export const MOCK_PROJECT: ProjectMock = {
  id: 'p1',
  proj: 'The Dream of Cats',
  style: '温暖手绘',
  ratio: '9:16',
  credits: 110,
  budget: 110,
  stylePrompt: 'warm hand-painted, soft teal-orange, film grain, 9:16',
  styles: ['温暖手绘', '3D 动画', '日式赛璐璐', '水彩绘本', '厚涂写实', '胶片质感', '黏土定格', '像素风'],
  acts: [
    { id: 'a1', t: '不会离开的朋友', span: '0:00–1:20', beats: [
      { id: 'b1', k: '场景1', t: '窗边画猫，光点进入额头' },
      { id: 'b2', k: '场景2', t: '蒙太奇：多年陪伴' },
    ] },
    { id: 'a2', t: '被世界遗忘的猫', span: '1:20–2:30', beats: [
      { id: 'b3', k: '场景3', t: '年糕生病，雨夜送医' },
      { id: 'b4', k: '场景4', t: '所有记录消失' },
      { id: 'b5', k: '场景5', t: '博物馆的古埃及线索' },
    ] },
    { id: 'a3', t: '梦境深处', span: '2:30–3:40', beats: [
      { id: 'b6', k: '场景6', t: '进入猫神殿' },
      { id: 'b7', k: '场景7', t: '告别，放手' },
      { id: 'b8', k: '场景8', t: '多年以后的画展' },
    ] },
  ],
  blocks: [
    { id: 'bk1', type: 'character', label: '角色小传', body:
`## 艾米 (Amy)
11 岁，住纽约郊区。安静，话少，习惯一个人待着。喜欢画画，画的基本都是猫。
父母上班忙，放学后家里常常只有她和年糕。

外形：齐肩黑发，米色针织衫，随身带一个画本。

## 年糕 (Nian Gao)
白猫，从艾米很小的时候就在。不叫，但艾米一难过它就会过来。

外形：白色短毛，蓝绿色眼睛，左耳一道缺口，尾巴蓬松。`,
    },
    { id: 'bk2', type: 'outline', label: '故事梗概', body:
`艾米 11 岁，家里只有她和一只叫年糕的白猫。

某天夜里年糕生病，送去宠物医院。第二天艾米回去，前台查不到就诊记录，
医生说没收过白猫。手机相册里的照片还在，但年糕的位置空了。

艾米开始找它。线索指向博物馆古埃及展区的一块石板。

结尾她见到了年糕，但带不回来。她放手了。`,
    },
    { id: 'bk3', type: 'text', label: '正文', body:
`# 第一幕：不会离开的朋友（0:00–1:20）

**场景1**
美国纽约郊区 · 黄昏 · 小女孩房间
窗外是城市灯光，11 岁的艾米坐在窗边画画。她的画本里，是一只白色的小猫。
桌上摆着一张旧照片：照片里，小女孩抱着一只白猫。
旁白："小时候，我总觉得世界上有些东西永远不会改变。"

年糕趴在桌边睡觉，艾米放下画笔，揉了揉它的头。
艾米："年糕，你答应我，以后不要离开我。"
年糕睁开眼，看了她一眼，轻轻用额头碰了一下她的手。

额头相碰的一瞬间，一粒非常微弱的蓝绿色光点进入艾米额头。只持续一帧，几乎不会被注意。

**场景2**
蒙太奇
展示多年陪伴：年糕每天等艾米回家 / 艾米难过时，年糕陪在旁边 / 艾米第一次画画获奖，年糕坐在画旁 / 雨夜里，艾米抱着年糕睡觉
旁白："它不会说话，却总知道我什么时候需要它。"` },
    { id: 'bk4', type: 'text', label: '正文', body:
`# 第二幕：被世界遗忘的猫（1:20–2:30）

**场景3**
夜晚 · 家中
年糕忽然呕吐、呼吸急促。艾米抱着它冲进雨里。
旁白："那一天，我第一次知道，永远是有期限的。"

**场景4**
宠物医院 · 清晨
艾米回到医院，前台查不到任何就诊记录。医生对她说"我们这里没有收过白猫"。
艾米翻开手机相册，照片里抱着的位置空了。

**场景5**
博物馆 · 午后
艾米在古埃及展区看到一块石板，上面刻着一只猫与一座神殿。石板下方的说明写着一行几乎无人注意的小字。
旁白："于是我开始追一个所有人都忘记的名字。"` },
  ],
  assets: {
    角色: [
      { id: 'c1', aid: 'CHAR-001', name: '艾米 (Amy)', desc: '11 岁小女孩，安静敏感，米色针织衫，齐肩短发',
        voice: '清亮，语速偏慢', ver: 1, status: 'locked', views: [
          { name: '正面', style: '温暖手绘', gen: true, redo: 0, prompt: '正面半身，米色针织衫，齐肩短发，柔和室内光，安静的眼神' },
          { name: '侧面', style: '温暖手绘', gen: true, redo: 0, prompt: '侧面轮廓，坐在窗边画画，窗外城市灯光虚化，黄昏' },
          { name: '背面', style: '水彩绘本', gen: true, redo: 0, prompt: '背影，趴在桌上画画，画本摊开，暖黄色台灯' },
          { name: '表情', style: '3D 动画', gen: true, redo: 0, prompt: '面部特写，眼眶微红却带着笑，近景柔光' },
        ] },
      { id: 'c2', aid: 'CHAR-002', name: '年糕 (Nian Gao)', desc: '白猫，短毛，蓝绿色眼睛，左耳一道缺口，尾巴蓬松',
        voice: '不说话，只有呼噜声', ver: 0, status: 'draft', views: [
          { name: '正面', style: '温暖手绘', gen: true, redo: 0, prompt: '白猫正面坐姿，蓝绿色眼睛，左耳一道缺口，蓬松尾巴绕住前爪' },
          { name: '侧面', style: '胶片质感', gen: true, redo: 0, prompt: '白猫侧面行走，步态轻盈，走廊晨光拉出长影子' },
          { name: '背面', style: '厚涂写实', gen: false, redo: 0, prompt: '白猫背影坐在窗台上，望向窗外夜色' },
          { name: '表情', style: '温暖手绘', gen: false, redo: 0, prompt: '猫脸特写，眯起眼睛呼噜，额头轻蹭指尖' },
        ] },
    ],
    场景: [
      { id: 's1', aid: 'SCENE-001', name: '小女孩房间', desc: '黄昏，窗外城市灯光', ver: 1, status: 'locked', views: [
          { name: '全景', style: '温暖手绘', gen: true, redo: 0, prompt: '黄昏小女孩房间全景，窗边画架，墙上贴满画，城市灯光入窗' },
          { name: '氛围', style: '胶片质感', gen: true, redo: 0, prompt: '暖光台灯下的桌面一角，画本与旧照片并置' },
          { name: '细节', style: '水彩绘本', gen: false, redo: 0, prompt: '画本特写，纸页上画满同一只白猫' },
        ] },
      { id: 's2', aid: 'SCENE-002', name: '宠物医院', desc: '清晨，冷白灯光', ver: 0, status: 'draft', views: [
          { name: '全景', style: '厚涂写实', gen: true, redo: 0, prompt: '清晨宠物医院前台，冷白灯光，空荡的候诊椅' },
          { name: '氛围', style: '3D 动画', gen: false, redo: 0, prompt: '消毒水气味的长廊，玻璃门透进晨光' },
          { name: '细节', style: '像素风', gen: false, redo: 0, prompt: '前台登记表特写，「就诊记录」一栏空白' },
        ] },
      { id: 's3', aid: 'SCENE-003', name: '猫神殿', desc: '梦境深处，古埃及形制，浮空石柱', ver: 0, status: 'draft', views: [
          { name: '全景', style: '水彩绘本', gen: false, redo: 0, prompt: '梦境深处浮空神殿，古埃及石柱环绕，无数白猫沉睡其中' },
          { name: '氛围', style: '温暖手绘', gen: false, redo: 0, prompt: '神殿穹顶光柱垂落，光点如萤火漂浮' },
          { name: '细节', style: '厚涂写实', gen: false, redo: 0, prompt: '石柱基座浮雕，猫与神殿的古老图腾' },
        ] },
      { id: 's4', aid: 'SCENE-004', name: '博物馆展厅', desc: '午后，古埃及展区', ver: 0, status: 'draft', views: [
          { name: '全景', style: '胶片质感', gen: false, redo: 0, prompt: '午后博物馆古埃及展区，展柜与石板，游客稀少' },
          { name: '氛围', style: '厚涂写实', gen: false, redo: 0, prompt: '展柜射灯下的石板，刻着一只猫与一座神殿' },
          { name: '细节', style: '3D 动画', gen: false, redo: 0, prompt: '石板下方说明牌特写，一行几乎无人注意的小字' },
        ] },
    ],
    道具: [
      { id: 'p1', aid: 'PROP-001', name: '艾米的画本', desc: '铅笔速写，画满白猫', ver: 1, status: 'locked', views: [
          { name: '整体', style: '温暖手绘', gen: true, redo: 0, prompt: '翻开的速写本，纸页边缘卷起，每一页都是白猫' },
          { name: '细节', style: '水彩绘本', gen: true, redo: 0, prompt: '铅笔速写特写，猫的神态几笔带过却生动' },
        ] },
      { id: 'p2', aid: 'PROP-002', name: '旧照片', desc: '小女孩抱着白猫，边角发黄', ver: 0, status: 'draft', views: [
          { name: '整体', style: '胶片质感', gen: true, redo: 0, prompt: '边角发黄的合影，小女孩抱着白猫，背景是夏日院子' },
          { name: '细节', style: '温暖手绘', gen: false, redo: 0, prompt: '照片特写，白猫的部分开始泛白褪色' },
        ] },
      { id: 'p3', aid: 'PROP-003', name: '蓝绿色光点', desc: '一粒蓝绿色光点，暗背景，只闪一帧', ver: 0, status: 'draft', views: [
          { name: '整体', style: '3D 动画', gen: false, redo: 0, prompt: '一粒蓝绿色光点悬浮在暗背景中，只闪一帧' },
          { name: '细节', style: '像素风', gen: false, redo: 0, prompt: '光点特写，内部仿佛有一座微小的神殿倒影' },
        ] },
    ],
  },
  shots: [
    { id: 's1-1', sceneKey: '场景1', size: '全景', desc: '窗边全景，艾米背影与城市灯光', dur: 4,
      refs: ['CHAR-001', 'SCENE-001'], own: 'wide shot, girl drawing by window at dusk, city lights bokeh',
      model: 'Seedance 2.0', batch: 1, key: true, vid: 'ok', takes: 4, verdict: 'ok', ejected: false,
      refVer: { 'CHAR-001': 1, 'SCENE-001': 1 },
      rig: { ...shotRig('全景'), dist: 1, az: 0, el: 4, mm: '24mm', fstop: 'f/8',
        lightAz: -40, lightEl: 26, bright: 72, kelvin: 4200, cam: '固定', time: ['黄昏'], mood: ['温暖'] } },
    { id: 's1-2', sceneKey: '场景1', size: '特写', desc: '画本特写，纸上是一只白猫', dur: 3,
      refs: ['PROP-001'], own: 'close-up of sketchbook, pencil drawing of a white cat, warm lamp light',
      model: 'Nano Banana', batch: 1, key: true, vid: 'ok', takes: 4, verdict: 'ok', ejected: false,
      refVer: { 'PROP-001': 1 }, rig: shotRig('特写') },
    { id: 's1-3', sceneKey: '场景1', size: '特写', desc: '年糕睁眼，额头相碰', dur: 3,
      refs: ['CHAR-001', 'CHAR-002'], own: 'white cat opening eyes, forehead touch with girl hand, intimate close-up',
      model: 'Seedance 2.0', batch: 1, key: true, vid: 'ok', takes: 12, verdict: 'ok', ejected: false,
      refVer: { 'CHAR-001': 1, 'CHAR-002': 1 },
      rig: { ...shotRig('特写'), dist: 5, az: -38, el: -2, mm: '85mm', fstop: 'f/1.4',
        lightAz: 120, lightEl: 14, bright: 38, kelvin: 3200, cam: '推镜', rim: true, mood: ['紧张'] } },
    { id: 's1-4', sceneKey: '场景1', size: '特写', desc: '蓝绿色光点进入额头（一帧）', dur: 1,
      refs: ['PROP-003'], own: 'tiny teal glowing particle entering forehead, single frame flash',
      model: '可灵 3.0', batch: 1, key: false, vid: 'none', takes: 0, verdict: null, ejected: false,
      refVer: {}, rig: shotRig('特写') },
    { id: 's2-1', sceneKey: '场景2', size: '中景', desc: '蒙太奇：年糕在门口等待', dur: 2,
      refs: ['CHAR-002', 'SCENE-001'], own: 'cat waiting by the door, afternoon light, montage cut',
      model: 'Seedance 2.0', batch: 1, key: true, vid: 'ok', takes: 8, verdict: 'ok', ejected: false,
      refVer: { 'CHAR-002': 1, 'SCENE-001': 1 }, rig: shotRig('中景') },
    { id: 's2-2', sceneKey: '场景2', size: '近景', desc: '蒙太奇：雨夜相拥入睡', dur: 2,
      refs: ['CHAR-001', 'CHAR-002'], own: 'girl hugging cat asleep, rainy night window, soft warm tone',
      model: '可灵 3.0', batch: 1, key: false, vid: 'none', takes: 4, verdict: 'redo', ejected: false,
      refVer: { 'CHAR-001': 1, 'CHAR-002': 1 }, rig: shotRig('近景') },
    { id: 's3-1', sceneKey: '场景3', size: '特写', desc: '年糕呼吸急促，艾米慌张', dur: 4,
      refs: ['CHAR-001', 'CHAR-002', 'SCENE-001'], own: 'sick white cat breathing heavily, girl panicking, night interior',
      model: 'Seedance 2.0', batch: 1, key: true, vid: 'redo', takes: 16, verdict: 'redo', ejected: true,
      refVer: { 'CHAR-001': 1, 'CHAR-002': 1, 'SCENE-001': 1 }, rig: shotRig('特写') },
    { id: 's3-2', sceneKey: '场景3', size: '全景', desc: '雨中奔跑，怀里抱着猫', dur: 4,
      refs: ['CHAR-001', 'SCENE-002'], own: 'girl running in heavy rain holding cat, streetlight, motion blur',
      model: '可灵 3.0', batch: 1, key: false, vid: 'none', takes: 0, verdict: null, ejected: false,
      refVer: { 'CHAR-001': 1 },
      rig: { ...shotRig('全景'), dist: 2, az: 160, el: -14, mm: '35mm', fstop: 'f/2.8',
        lightAz: 175, lightEl: 10, bright: 45, kelvin: 6800, cam: '手持', time: ['夜晚', '雨'] } },
  ],
  pins: [
    { id: 'CHAR-001', n: '艾米 · 4 视图' },
    { id: 'CHAR-002', n: '年糕 · 4 视图' },
    { id: 'PROP-001', n: '画本' },
    { id: 'STYLE', n: '画风基准' },
  ],
};

/** 分镜 rig：defaultRig(景别) 上叠 mock 里调过的机位 */
import { defaultRig } from '@/domain/assets/model';
function shotRig(size: string): ReturnType<typeof defaultRig> {
  return defaultRig(size);
}

/** 项目列表（首页「最近的项目」），顺序即展示顺序 */
export interface ProjectListEntry {
  id: string;
  title: string;
  meta: string;
  seed: string;
}

export const MOCK_PROJECT_LIST: ProjectListEntry[] = [
  { id: 'p1', title: 'The Dream of Cats', meta: '短剧 · 9:16 · 停在 Script', seed: 'cats-cover' },
  { id: 'p2', title: '雨夜来客', meta: '短剧 · 9:16 · 停在 Storyboard', seed: 'rain-cover' },
];

/** 第二个项目的紧凑内容：验证按 ID 取项目的真实性 */
const MOCK_PROJECT_RAIN: ProjectMock = {
  id: 'p2',
  proj: '雨夜来客',
  style: '胶片质感',
  ratio: '9:16',
  credits: 42,
  budget: 50,
  stylePrompt: 'film noir rain night, neon reflections on wet asphalt',
  styles: ['胶片质感', '厚涂写实', '温暖手绘'],
  acts: [
    { id: 'r1', t: '深夜载客', span: '0:00–0:50', beats: [
      { id: 'rb1', k: '场景1', t: '雨夜街头，司机载上神秘乘客' },
      { id: 'rb2', k: '场景2', t: '后座的对话，后视镜里的眼睛' },
    ] },
  ],
  blocks: [
    { id: 'rbk1', type: 'outline', label: '故事梗概', body:
`雨夜的出租车司机老周在末班载到一位没有目的地的乘客。乘客只说"跟着红灯走"，
每到路口，老周都会想起自己不愿回忆的那个雨夜。` },
  ],
  assets: {
    角色: [
      { id: 'rc1', aid: 'CHAR-101', name: '老周', desc: '五十岁出租车司机，眼角皱纹，旧夹克', ver: 1, status: 'locked', views: [
          { name: '正面', style: '胶片质感', gen: true, redo: 0, prompt: '正面半身，出租车司机，旧夹克，车内顶灯，雨夜' },
        ] },
    ],
    场景: [
      { id: 'rs1', aid: 'SCENE-101', name: '雨夜街头', desc: '霓虹倒影，湿漉漉的沥青路', ver: 0, status: 'draft', views: [
          { name: '全景', style: '胶片质感', gen: true, redo: 0, prompt: '雨夜街头全景，霓虹倒影，一辆出租车靠边停靠' },
        ] },
    ],
    道具: [],
  },
  shots: [
    { id: 'rs1-1', sceneKey: '场景1', size: '中景', desc: '司机回头看后座的乘客', dur: 3,
      refs: ['CHAR-101'], own: 'driver looking back at mysterious passenger, rearview mirror reflection',
      model: 'Seedance 2.0', batch: 1, key: true, vid: 'ok', takes: 4, verdict: 'ok', ejected: false,
      refVer: { 'CHAR-101': 1 }, rig: shotRig('中景') },
    { id: 'rs1-2', sceneKey: '场景1', size: '特写', desc: '雨刷来回，仪表盘绿光', dur: 2,
      refs: ['SCENE-101'], own: 'extreme close-up of windshield wipers, green dashboard glow',
      model: '可灵 3.0', batch: 1, key: false, vid: 'none', takes: 0, verdict: null, ejected: false,
      refVer: {}, rig: shotRig('特写') },
  ],
  pins: [
    { id: 'CHAR-101', n: '老周' },
    { id: 'SCENE-101', n: '雨夜街头' },
  ],
};

/** 按 ID 取项目的内容池 */
export const MOCK_PROJECTS: Record<string, ProjectMock> = {
  p1: MOCK_PROJECT,
  p2: MOCK_PROJECT_RAIN,
};
