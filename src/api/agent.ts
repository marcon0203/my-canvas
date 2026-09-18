import type { AgentContext } from '@/domain/agent/context';
import { plan } from '@/domain/agent/plans';
import { route } from '@/domain/agent/router';
import { personaById } from '@/domain/agent/roster';
import { canHandleConfigured, ownerOfConfigured } from '@/domain/agent/config';
import type { Handoff, IntentKind, Plan, Proposal, ProposalPatch } from '@/domain/agent/types';
import { TOOLS, type ToolId } from '@/domain/agent/tools';
import { secText } from '@/domain/clips/model';
import {
  isDesktop, outlineDraft, outlineExpand, shotsPrompt,
  type AltsDraft, type ExpandInput, type OutlineDraft, type PromptDraft, type RunEvent,
  type SceneBrief, type ShotBrief,
} from './desktop';
import { actOfBeat, allBeats } from '@/domain/story/model';
import { useSettings } from '@/store/settings';
import type { Shot } from '@/domain/shots/model';
import { SIZE_EN, shotsMissingPrompt } from '@/domain/agent/drafts';
import { ctxAssets } from '@/domain/agent/context';

/**
 * Agent 传输层：本地模拟一次流式应答。
 * 事件序列与真实 LLM 流一致（step → delta → proposal → done），可中断；
 * 接后端时只换本文件的 run 实现，store 与界面零改动。
 */

export type AgentEvent =
  | { t: 'plan'; plan: Plan }
  | { t: 'step'; index: number }
  | { t: 'delta'; text: string }
  /** 产物在正文说完之后才交付 —— 先解释，再给东西 */
  | { t: 'proposal'; proposal: NonNullable<Plan['proposal']> }
  /** 当班 Agent 接不了，交给对的那位 */
  | { t: 'handoff'; handoff: Handoff }
  | { t: 'done' }
  | { t: 'aborted' };

/**
 * 每步工具卡停留时长；正文每帧吐几个字。
 * 测试环境下把时钟压扁 —— 走的是同一条代码路径，只是不必真等人眼的节奏。
 */
const FAST = import.meta.env?.MODE === 'test';
const STEP_MS = FAST ? 4 : 420;
const TICK_MS = FAST ? 1 : 26;
const CHARS_PER_TICK = FAST ? 64 : 2;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(id); reject(ABORT); }, { once: true });
  });

const ABORT = Symbol('agent-abort');

/**
 * 跑一轮。kind 为空时按自由文本路由。
 * 返回异步事件流 —— 调用方 for await，随时 abort。
 */
export async function* runAgent(
  ctx: AgentContext,
  kind: IntentKind | undefined,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const resolved = kind ?? route(ctx.input).kind;
  const me = personaById(ctx.agentId);

  // 接不了就转交 —— 当班的先说一句，再把人交出去，不假装自己会。
  // 判定以**配置**为准：用户把活儿挪给别人、或勾掉了工具，转交要跟着变
  if (!canHandleConfigured(me.id, resolved, ctx.agents)) {
    const toId = ownerOfConfigured(resolved, ctx.agents);
    if (!toId) {
      // 这活儿被所有人取消了：说清楚，别假装转交给某个不接的人
      const line = `「${resolved}」现在没有 Agent 接。去设置里给某位加上这项技能和对应工具。`;
      yield { t: 'plan', plan: { kind: resolved, steps: [], reply: line, blocked: line } };
      for (let i = 0; i < line.length; i += CHARS_PER_TICK) {
        try { await sleep(TICK_MS, signal); } catch { yield { t: 'aborted' }; return; }
        yield { t: 'delta', text: line.slice(i, i + CHARS_PER_TICK) };
      }
      yield { t: 'done' };
      return;
    }
    const to = personaById(toId);
    const handoff: Handoff = { from: me.id, to: to.id, kind: resolved };
    const line = me.handoff.replace('%s', `**${to.name}**`);
    yield { t: 'plan', plan: { kind: resolved, steps: [], reply: line } };
    try {
      for (let i = 0; i < line.length; i += CHARS_PER_TICK) {
        await sleep(TICK_MS, signal);
        yield { t: 'delta', text: line.slice(i, i + CHARS_PER_TICK) };
      }
    } catch (e) {
      if (e === ABORT) { yield { t: 'aborted' }; return; }
      throw e;
    }
    yield { t: 'handoff', handoff };
    yield { t: 'done' };
    return;
  }

  // 桌面端 + 这件活已经接上真模型：走 IPC，不再用本地草稿。
  // 被 blocked 的活儿不走这条路 —— 没镜头可补时不该去花模型的钱。
  if (isDesktop() && resolved === 'outline.draft') {
    yield* runOutlineOnDesktop(ctx, signal);
    return;
  }
  if (isDesktop() && resolved === 'shots.prompt' && shotsMissingPrompt(ctx).length > 0) {
    yield* runShotPromptsOnDesktop(ctx, signal);
    return;
  }
  // 大纲空着时没有「这一场」可延展 —— 让它落到本地那条路去说清前置条件，
  // 别把一个空上下文送给模型
  if (isDesktop() && resolved === 'outline.expand' && selectedBeat(ctx)) {
    yield* runExpandOnDesktop(ctx, signal);
    return;
  }

  const p = plan(resolved, ctx);
  // 先只下发步骤：产物等正文说完再交付
  yield { t: 'plan', plan: { ...p, proposal: undefined } };

  try {
    if (!p.blocked) {
      for (let i = 0; i < p.steps.length; i++) {
        await sleep(STEP_MS, signal);
        yield { t: 'step', index: i + 1 };
      }
      if (p.steps.length) await sleep(240, signal);
    }

    for (let i = 0; i < p.reply.length; i += CHARS_PER_TICK) {
      await sleep(TICK_MS, signal);
      yield { t: 'delta', text: p.reply.slice(i, i + CHARS_PER_TICK) };
    }
    if (p.proposal) {
      await sleep(160, signal);
      yield { t: 'proposal', proposal: p.proposal };
    }
    yield { t: 'done' };
  } catch (e) {
    if (e === ABORT) { yield { t: 'aborted' }; return; }
    throw e;
  }
}


/**
 * 内置能力 → 真 skill 的对应关系。
 *
 * 只有这几件已经有 SKILL.md（在 `resources/skills/`），跑的时候会把那份正文
 * 展开进 preamble。其余的还是 plans.ts 里的本地逻辑，没有 skill 可展开。
 */
export const SKILL_FOR_TASK: Partial<Record<IntentKind, string>> = {
  'outline.draft': 'draft-outline',
  'outline.expand': 'expand-scene',
  'shots.prompt': 'write-shot-prompts',
};

/* ---------------- 真模型：起草大纲 ---------------- */

const OUTLINE_STEPS = [
  { icon: 'spark', label: '读取灵感与现有结构' },
  { icon: 'map', label: '让模型出结构' },
  { icon: 'book', label: '编号并落成场次' },
];

/**
 * 桌面端的「起草大纲」：Rust 侧跑 Rig，事件经 Channel 回来。
 *
 * 这里把 Rust 的 RunEvent 翻译成本地 AgentEvent —— 两套事件**故意不合并**：
 * 前端的 AgentEvent 还要伺候浏览器 mock 那条路，合并会让 mock 背上 IPC 的形状。
 */
async function* runOutlineOnDesktop(
  ctx: AgentContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  yield { t: 'plan', plan: { kind: 'outline.draft', steps: OUTLINE_STEPS, reply: '' } };

  const fresh = ctx.acts.length === 0;
  yield* pump(signal, (emit) =>
    outlineDraft(
      {
        cfg: ctx.agents[ctx.agentId],
        fallbackPreamble: personaById(ctx.agentId).preamble,
        globals: ctx.globalModels,
        providers: {},
        input: {
          project: ctx.proj,
          idea: ctx.input,
          actCount: ctx.acts.length,
          beatCount: allBeats(ctx.acts).length,
        },
        skill: SKILL_FOR_TASK['outline.draft'],
        workspace: useSettings.getState().workspace,
      },
      (e) => emit(e, (d) => outlineProposal(d as OutlineDraft, fresh, ctx)),
    ),
  );
}

/* ---------------- 真模型：延展走向 ---------------- */

const EXPAND_STEPS = [
  { icon: 'map', label: '读这一场与前后场次' },
  { icon: 'spark', label: '让模型给三条走向' },
  { icon: 'book', label: '收拾成可选的几条' },
];

/** 选中的那一场。没选就取第一场；一场都没有返回 undefined */
export const selectedBeat = (ctx: AgentContext) =>
  allBeats(ctx.acts).find((b) => b.id === ctx.sel.beatId) ?? allBeats(ctx.acts)[0];

/** 这一场前后各取几场。给多了没用：模型只需要知道它接在哪两件事之间 */
const NEIGHBORS = 2;

/**
 * 这一场的上下文 → 送给模型的输入。
 *
 * **前后场次和已定稿角色必须送**：只给这一场的标题的话，模型给的三条和
 * 上一版那份写死的模板差别不大（那一版就是三个固定句式套标题）。
 * 走向之所以有意义，是因为它要接得上前后已经定了的东西。
 */
export function expandInput(ctx: AgentContext, beatId: string): ExpandInput {
  const beats = allBeats(ctx.acts);
  const at = beats.findIndex((b) => b.id === beatId);
  const beat = beats[at]!;
  const act = actOfBeat(ctx.acts, beatId);
  const brief = (b: { k: string; t: string }): SceneBrief => ({ k: b.k, t: b.t });
  return {
    project: ctx.proj,
    beatKey: beat.k,
    beatT: beat.t,
    actTitle: act?.t ?? '',
    actSpan: act?.span ?? '',
    before: beats.slice(Math.max(0, at - NEIGHBORS), at).map(brief),
    after: beats.slice(at + 1, at + 1 + NEIGHBORS).map(brief),
    // **只送定稿的**：草稿资产随时会改，让模型围着一个会变的设定写走向没意义
    leads: ctx.assets.角色
      .filter((a) => a.status === 'locked')
      .map((a) => `${a.name}：${a.desc}`),
    idea: ctx.input,
  };
}

/** 桌面端的「延展走向」 */
async function* runExpandOnDesktop(
  ctx: AgentContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  yield { t: 'plan', plan: { kind: 'outline.expand', steps: EXPAND_STEPS, reply: '' } };

  const beat = selectedBeat(ctx)!;
  yield* pump(signal, (emit) =>
    outlineExpand(
      {
        cfg: ctx.agents[ctx.agentId],
        fallbackPreamble: personaById(ctx.agentId).preamble,
        globals: ctx.globalModels,
        providers: {},
        input: expandInput(ctx, beat.id),
        skill: SKILL_FOR_TASK['outline.expand'],
        workspace: useSettings.getState().workspace,
      },
      (e) => emit(e, (d) => altsProposal(d as AltsDraft, beat)),
    ),
  );
}

/** Rust 产物 → 前端产物卡。条数与长度 Rust 已经收拾过，这里只管怎么摆 */
export function altsProposal(draft: AltsDraft, beat: { id: string; k: string }) {
  return {
    title: `${beat.k} · ${draft.alts.length} 条备选走向`,
    rows: draft.alts.map((v, i) => ({ k: `走向 ${i + 1}`, v })),
    patch: { t: 'alts' as const, beatId: beat.id, alts: draft.alts },
    // 与本地那条路同一个消耗：同一件事在两条路上记不同的账，对不上
    cost: 2,
    goto: 'outline',
  };
}

/* ---------------- 真模型：补写提示词 ---------------- */

const PROMPT_STEPS = [
  { icon: 'text', label: '清点缺提示词的镜头' },
  { icon: 'users', label: '让模型按引用合成' },
  { icon: 'wand', label: '核对镜号并落回' },
];

/**
 * 桌面端的「补写提示词」。
 *
 * 引用资产在**这里**展开成描述再送过去：Rust 侧不认识项目库，也不该认识 ——
 * 它只负责「把几段文字合成一条提示词，并且别把镜号写错」。
 */
async function* runShotPromptsOnDesktop(
  ctx: AgentContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  yield { t: 'plan', plan: { kind: 'shots.prompt', steps: PROMPT_STEPS, reply: '' } };

  const miss = shotsMissingPrompt(ctx);

  yield* pump(signal, (emit) =>
    shotsPrompt(
      {
        cfg: ctx.agents[ctx.agentId],
        fallbackPreamble: personaById(ctx.agentId).preamble,
        globals: ctx.globalModels,
        providers: {},
        input: {
          project: ctx.proj,
          stylePrompt: ctx.stylePrompt,
          shots: shotBriefs(ctx, miss),
        },
        skill: SKILL_FOR_TASK['shots.prompt'],
        workspace: useSettings.getState().workspace,
      },
      (e) => emit(e, (d) => promptProposal(d as PromptDraft, miss.length)),
    ),
  );
}

/**
 * 镜头 → 送给模型的简报。引用在这里展开成「名字：描述」，
 * 景别用项目词表里的英文术语 —— 不让模型自己翻，术语要和手写提示词一致。
 */
export function shotBriefs(ctx: AgentContext, shots: readonly Shot[]): ShotBrief[] {
  const assets = ctxAssets(ctx);
  return shots.map((s) => ({
    id: s.id,
    size: s.size,
    sizeEn: SIZE_EN[s.size] ?? 'medium shot',
    desc: s.desc,
    refs: assets.filter((a) => s.refs.includes(a.aid)).map((a) => `${a.name}：${a.desc}`),
  }));
}

/** Rust 产物 → 前端产物卡。镜号 Rust 已经核对过，这里只管怎么摆 */
export
function promptProposal(draft: PromptDraft, asked: number) {
  const edits = draft.prompts.map((p) => ({ id: p.id, own: p.own }));
  const missed = asked - edits.length;
  return {
    title: missed > 0
      ? `补写提示词 · ${edits.length}/${asked} 镜`
      : `补写提示词 · ${edits.length} 镜`,
    rows: edits.slice(0, 8).map((e) => ({ k: e.id, v: e.own })),
    patch: { t: 'shotPrompts' as const, edits },
    cost: 2,
    goto: 'storyboard',
  };
}

/* ---------------- IPC 事件泵 ---------------- */

/**
 * 把 Rust 的 RunEvent 翻译成本地 AgentEvent，并把「回调推送」倒成「异步生成器」。
 *
 * 两套事件**故意不合并**：前端的 AgentEvent 还要伺候浏览器 mock 那条路，
 * 合并会让 mock 背上 IPC 的形状。
 *
 * `toProposal` 由各条链路自己给 —— 产物怎么变成卡片是链路的事，泵不管。
 */
async function* pump(
  signal: AbortSignal,
  start: (emit: (e: RunEvent, toProposal: (d: unknown) => NonNullable<Plan['proposal']>) => void) => Promise<void>,
): AsyncGenerator<AgentEvent> {
  const queue: AgentEvent[] = [];
  let finished = false;
  let wake: (() => void) | null = null;
  const push = (e: AgentEvent) => { queue.push(e); wake?.(); };

  const emit = (e: RunEvent, toProposal: (d: unknown) => NonNullable<Plan['proposal']>) => {
    switch (e.t) {
      case 'step':
        push({ t: 'step', index: e.index });
        break;
      case 'delta':
        push({ t: 'delta', text: e.text });
        break;
      case 'proposal':
      case 'prompts':
      case 'alts':
        push({ t: 'proposal', proposal: toProposal(e.draft) });
        break;
      case 'done':
        finished = true;
        push({ t: 'done' });
        break;
      case 'failed':
        finished = true;
        // 失败当成一段正文说出来：用户要知道为什么没成，而不是看一个空面板
        push({ t: 'delta', text: failureText(e.code, e.message) });
        push({ t: 'done' });
        break;
    }
  };

  void start(emit).catch((err: unknown) => {
    finished = true;
    push({ t: 'delta', text: `调用失败：${String(err)}` });
    push({ t: 'done' });
  });

  while (!finished || queue.length) {
    if (signal.aborted) { yield { t: 'aborted' }; return; }
    if (!queue.length) {
      await new Promise<void>((r) => { wake = r; setTimeout(r, 40); });
      wake = null;
      continue;
    }
    yield queue.shift()!;
  }
}

/** 常见失败给人话，而不是把错误码甩出去 */
function failureText(code: string, message: string): string {
  switch (code) {
    case 'no_key':
      return `${message}。去设置 → 模型服务商里填一个。`;
    case 'no_model':
      return `${message}。去设置 → Agent 配置里给它选一个文本模型。`;
    case 'no_base_url':
      return `${message}。自定义端点必须填 baseURL。`;
    case 'decode':
      return `模型没按要求的结构返回，重试几次都没成：${message}`;
    default:
      return message;
  }
}

/** Rust 产物 → 前端产物卡。id 在这里生成 —— 前端才知道现有 id 用到哪 */
function outlineProposal(draft: OutlineDraft, fresh: boolean, ctx: AgentContext) {
  const known = new Set(ctx.acts.map((a) => a.id));
  let n = 1;
  const nextId = () => {
    let id = `a${n++}`;
    while (known.has(id)) id = `a${n++}`;
    known.add(id);
    return id;
  };
  let beatSeq = allBeats(ctx.acts).length;
  const acts = draft.acts.map((a) => ({
    id: nextId(),
    t: a.t,
    span: a.span,
    beats: a.beats.map((b) => ({ id: `b${++beatSeq}`, k: b.k, t: b.t })),
  }));
  const merged = fresh ? acts : [...ctx.acts, ...acts];
  const added = acts.flatMap((a) => a.beats);
  return {
    title: fresh ? `新大纲 · ${acts.length} 幕 ${added.length} 场` : `补 ${added.length} 场`,
    rows: added.map((b) => ({ k: b.k, v: b.t })),
    patch: { t: 'acts' as const, acts: merged },
    cost: 2,
    goto: 'outline',
  };
}

/* ---------------- 工具调用 ---------------- */

/**
 * 工具的补丁 → 产物卡。
 *
 * 每个工具的补丁形状不同，摘要行也不同：时间线要看几段多长，字幕要看几条，
 * 建资产要看建了谁。一律摆成 `{t: 'xxx'}` 这种原始 JSON 是没法审的 ——
 * 产物卡的用处就是让人在写进项目**之前**看一眼。
 */
export function toolProposal(tool: ToolId, patch: ProposalPatch, value: unknown): Proposal {
  const spec = TOOLS.find((t) => t.id === tool);
  const title = spec?.name ?? tool;
  const v = (value ?? {}) as Record<string, unknown>;

  switch (patch.t) {
    case 'timeline': {
      const n = patch.timeline.clips.length;
      const ms = Number(v['totalMs'] ?? 0);
      return {
        title: `${title} · ${n} 段`,
        rows: [
          { k: '片长', v: secText(ms) },
          { k: '卡点', v: patch.timeline.beatMs ? `${patch.timeline.beatMs}ms 对齐` : '不对齐' },
          ...patch.timeline.clips.slice(0, 6).map((c) => ({ k: c.shotId, v: `${secText(c.at)} 起 · ${secText(c.dur)}` })),
        ],
        patch, cost: 0, goto: 'editing',
      };
    }
    case 'subtitles':
      return {
        title: `${title} · ${patch.subtitles.cues.length} 条`,
        rows: patch.subtitles.cues.slice(0, 8).map((c) => ({ k: secText(c.at), v: c.text })),
        patch, cost: 0, goto: 'editing',
      };
    case 'assetsDraft':
      return {
        title: `${title} · ${patch.add.length} 个`,
        rows: patch.add.map((a) => ({ k: `${a.group} ${a.aid}`, v: a.name })),
        patch, cost: 0, goto: 'assets',
      };
    case 'blocks':
      return {
        title: `${title} · ${patch.blocks.length} 块`,
        rows: patch.blocks.map((b) => ({ k: b.label, v: `${b.body.slice(0, 40)}…` })),
        patch, cost: 0, goto: 'script',
      };
    case 'style':
      return {
        title: `${title} · ${patch.style}`,
        rows: [{ k: '英文片段', v: patch.stylePrompt }],
        patch, cost: 0, goto: 'storyboard',
      };
    case 'shotRig':
      return {
        title: `${title} · ${patch.edits.length} 镜`,
        rows: patch.edits.map((e) => ({ k: e.id, v: Object.entries(e.rig).map(([k, x]) => `${k}=${String(x)}`).join(' ') })),
        patch, cost: 0, goto: 'storyboard',
      };
    default:
      // 其余补丁形状（大纲、分镜、定稿…）已经有各自的入口，这里只兜个底
      return { title, rows: [{ k: '改动', v: patch.t }], patch, cost: 0 };
  }
}

/** 工具跑完但没有补丁（只读类）→ 摘要文字。别把整份 JSON 甩给人看 */
export function toolOkText(tool: ToolId, value: unknown): string {
  const v = (value ?? {}) as Record<string, unknown>;
  if (tool === 'file.export') {
    return `已生成 ${String(v['filename'])}（${Math.round(Number(v['bytes'] ?? 0) / 1024)} KB）。保存位置由你在保存对话框里选。`;
  }
  if (tool === 'prompt.compile') {
    const list = (v['prompts'] ?? []) as { id: string; text: string }[];
    return list.slice(0, 6).map((x) => `${x.id}：${x.text}`).join('\n');
  }
  return JSON.stringify(v).slice(0, 300);
}
