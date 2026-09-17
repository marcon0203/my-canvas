import { TOOLS_FOR_INTENT, type ToolId } from './tools';
import type { IntentKind, Proposal } from './types';

/**
 * 自主执行的权限边界。
 *
 * 「自主执行」= 不用人点采纳，Agent 自己往下跑。省事，但也意味着**没人看一眼**。
 * 真正要紧的不是「它会不会乱改项目」—— 项目改动有撤销、有 diff、改错了看得见；
 * 要紧的是那些**看不见或收不回**的动作：
 *
 * - 花钱：出图、出视频。跑完积分就没了，撤销撤不回积分。
 * - 出网/落到项目外：导出文件。东西一旦离开这台机器就收不回来。
 *
 * 所以边界按「这一步的后果撤不撤得回」划，而不是按「它改了多少东西」。
 *
 * 这一层**不是沙箱**，也不假装是。它挡的是自主模式下的越界动作；
 * 真要跑陌生代码（skill 的 scripts/），那需要进程级隔离，是另一件事。
 */

export type Risk =
  /** 只读项目或记账数据，没有副作用 */
  | 'read'
  /** 改项目内容。进撤销历史，改错了能退回来 */
  | 'write'
  /** 花积分。撤销撤不回已经消耗的额度 */
  | 'spend'
  /** 东西离开这台机器或落到项目目录之外 */
  | 'egress';

/** 从松到紧。数字越大越要人点头 */
const ORDER: Record<Risk, number> = { read: 0, write: 1, spend: 2, egress: 3 };

export const RISK_LABEL: Record<Risk, string> = {
  read: '只读', write: '改项目', spend: '花积分', egress: '出本机',
};

export const RISK_WHY: Record<Risk, string> = {
  read: '不改任何东西',
  write: '改项目内容，进撤销历史，退得回来',
  spend: '要花积分，跑完撤销也退不回额度',
  egress: '东西会离开这台机器，收不回来',
};

/**
 * 工具 → 风险。**与 Rust 侧 `conf/src/policy.rs` 同一张表**，有 parity 测试。
 *
 * 渲参考图是本地 WebGL，不花钱也不出网 —— 名字里带 render 容易让人误以为要花钱。
 */
const RISK: Record<ToolId, Risk> = {
  'project.read': 'read',
  'project.search': 'read',
  'metrics.read': 'read',
  'cost.estimate': 'read',
  'stage.render': 'read',
  'prompt.translate': 'read',
  // 只是把「这一镜会发出去什么」算出来给你看 —— 提示词是派生值，改它要去改源头
  'prompt.compile': 'read',

  'outline.write': 'write',
  'script.write': 'write',
  'asset.write': 'write',
  'asset.lock': 'write',
  'shot.write': 'write',
  'style.apply': 'write',
  'shot.rig': 'write',
  'edit.timeline': 'write',
  'edit.subtitle': 'write',

  'image.generate': 'spend',
  'image.edit': 'spend',
  'image.upscale': 'spend',
  'video.generate': 'spend',
  'video.extend': 'spend',
  'audio.tts': 'spend',
  'audio.music': 'spend',
  'audio.sfx': 'spend',

  'file.export': 'egress',
  'web.search': 'egress',
  'web.fetch': 'egress',
};

export function riskOfTool(id: ToolId): Risk {
  // **不认识的按最高档算，不是最低档。** 加了工具却忘了登记风险时，
  // 后果应该是「它跑不了，有人来问为什么」，而不是「它自动跑了」。
  return RISK[id] ?? 'egress';
}

/** 一件活儿的风险 = 它要的工具里最高的那个 */
export function riskOfIntent(kind: IntentKind): Risk {
  if (kind === 'chat') return 'read';
  const tools = TOOLS_FOR_INTENT[kind] ?? [];
  return tools.reduce<Risk>((hi, t) => max(hi, riskOfTool(t)), 'read');
}

export const max = (a: Risk, b: Risk): Risk => (ORDER[a] >= ORDER[b] ? a : b);

/**
 * 一份产物的风险。
 *
 * **按补丁的实际后果判，不按发起它的活儿判** —— 这是能真正拦住东西的那一层。
 * 「批量转视频」的产物是 `run/video.batch`，采纳下去就开始烧积分；
 * 而「补写提示词」虽然归摄影指导管，产物只是改几行字。
 *
 * **不按「有没有标消耗」判**：这个应用里几乎每一轮都要花一两个积分（文字
 * 生成也算），照那个判等于什么都自动不了，边界就成了摆设。真正撤不回的是
 * 出图与出视频那两件，按它们判。想连一两个积分都先问一句的，把上限调到
 * 「只读」—— 那是一个明确的选择，不是默认值把人拦死。
 */
export function riskOfProposal(p: Proposal): Risk {
  // 出图、出视频是那两件「跑完退不回」的事
  if (p.patch.t === 'assetViews') return 'spend';
  if (p.patch.t === 'run') return p.patch.action === 'video.batch' ? 'spend' : 'write';
  return 'write';
}

/** 自主模式下最多允许到哪一档。出厂：能改项目，不能花钱 */
export const DEFAULT_AUTO_MAX: Risk = 'write';

export const AUTO_MAX_CHOICES: readonly Risk[] = ['read', 'write', 'spend'];

/**
 * 这份产物能不能自己采纳。
 *
 * `egress` **永远要人点头**，哪怕把上限调到最高 —— 一个「自动导出并发走」
 * 的默认值不该存在于任何配置里。
 */
export function autoAllowed(risk: Risk, autoMax: Risk = DEFAULT_AUTO_MAX): boolean {
  if (risk === 'egress') return false;
  return ORDER[risk] <= ORDER[autoMax];
}

/** 挡下来时给人话：为什么停在这儿 */
export function holdReason(risk: Risk): string {
  return risk === 'egress'
    ? '这一步会把东西送出这台机器 —— 自主模式也不会自己做，等你点头。'
    : `这一步${RISK_WHY[risk]}，超过了你给的自主上限 —— 等你点头。`;
}
