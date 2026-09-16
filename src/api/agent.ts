import type { AgentContext } from '@/domain/agent/context';
import { plan } from '@/domain/agent/plans';
import { route } from '@/domain/agent/router';
import { personaById } from '@/domain/agent/roster';
import { canHandleConfigured, ownerOfConfigured } from '@/domain/agent/config';
import type { Handoff, IntentKind, Plan } from '@/domain/agent/types';

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
