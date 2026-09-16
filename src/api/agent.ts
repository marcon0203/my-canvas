import type { AgentContext } from '@/domain/agent/context';
import { plan } from '@/domain/agent/plans';
import { route } from '@/domain/agent/router';
import { personaById } from '@/domain/agent/roster';
import { canHandleConfigured, ownerOfConfigured } from '@/domain/agent/config';
import type { Handoff, IntentKind, Plan } from '@/domain/agent/types';
import { isDesktop, outlineDraft, shotsPrompt, type OutlineDraft, type PromptDraft, type RunEvent, type ShotBrief } from './desktop';
import { allBeats } from '@/domain/story/model';
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
      const line = `「${resolved}」现在没有 Agent 接 —— 去设置里给某位加上这项技能和对应工具。`;
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
 * 只有这两件已经有 SKILL.md（在 `src-tauri/skills/`），跑的时候会把那份正文
 * 展开进 preamble。其余十件还是写死在 plans.ts 里的本地逻辑，没有 skill 可展开。
 */
export const SKILL_FOR_INTENT: Partial<Record<IntentKind, string>> = {
  'outline.draft': 'draft-outline',
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
        skill: SKILL_FOR_INTENT['outline.draft'],
        workspace: useSettings.getState().workspace,
      },
      (e) => emit(e, (d) => outlineProposal(d as OutlineDraft, fresh, ctx)),
    ),
  );
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
        skill: SKILL_FOR_INTENT['shots.prompt'],
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
