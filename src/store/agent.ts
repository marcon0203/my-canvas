import { create } from 'zustand';
import { runAgent } from '@/api/agent';
import type { AgentContext } from '@/domain/agent/context';
import type { AgentId } from '@/domain/agent/roster';
import { personaById, personaForStep } from '@/domain/agent/roster';
import type { AgentMessage, IntentKind, Proposal } from '@/domain/agent/types';
import { pipelineFor, type ProjectKind, type Stage } from '@/domain/agent/pipeline';
import { autoAllowed, holdReason, riskOfProposal } from '@/domain/agent/policy';
import { useProject } from './project';
import { useUi } from './ui';
import { effectiveGlobals, useSettings } from './settings';

/**
 * Agent 会话态：消息、流式进度、待采纳产物。不进撤销历史 ——
 * 撤销的粒度是「采纳的那份产物」，由 project.applyAgentPatch 记一条。
 *
 * 一个环节一位 Agent（见 domain/agent/roster）。当班的接不了的活儿会转交，
 * 转交 = 跳到接手方的主场环节 + 由它重跑同一句输入。
 */

export interface AgentState {
  messages: AgentMessage[];
  /** 正在跑的那条 ai 消息 id */
  runningId: number | null;
  /** 这轮会话属于哪个环节 —— 换环节开新会话 */
  step: string;
  /** 当班的 Agent */
  agentId: AgentId;
  /** relay=true 时不再冒一次用户气泡：转交是同一个请求换人接，不是新请求 */
  send: (text: string, kind?: IntentKind, relayed?: boolean) => void;
  /**
   * 待跑的流水线。首页给一句需求，Agent 按 pipeline 一步步跑：
   * 每步出产物 → 人采纳（或按自主度自动）→ 接着下一步。
   * 丢弃或中断就停在这儿，不会自己往下冲。
   */
  queue: Stage[];
  /** 这条流水线要做什么，摆在会话开头，也写进项目的 brief.md */
  brief: string;
  startPipeline: (brief: string, kind: ProjectKind) => void;
  /** 环节变了就清空。send 会先认领当前环节，所以「跳页并发起」不会被清掉 */
  syncStep: (step: string) => void;
  stop: () => void;
  accept: (msgId: number) => void;
  discard: (msgId: number) => void;
  reset: () => void;
}

let seq = 1;
let abort: AbortController | null = null;

/**
 * 跑流水线的下一步。
 *
 * 被挡住的一步（前置条件不满足）**跳过而不是停住** —— 比如空项目里没有
 * 可用片段，自动成片本来就轮不到；为此把整条流水线卡死没有意义。
 * 真正该停的是人主动丢弃或中断。
 */
function advance(get: () => AgentState, set: (p: Partial<AgentState>) => void): void {
  const q = get().queue;
  if (!q.length) return;
  const [next, ...rest] = q;
  set({ queue: rest });
  get().send(`${next!.why}`, next!.kind, true);
}

/** 从两个 store 组装 Agent 看到的项目快照 */
function snapshot(input: string, agentId: AgentId): AgentContext {
  const p = useProject.getState();
  const u = useUi.getState();
  return {
    proj: p.proj, style: p.style, stylePrompt: p.stylePrompt, styles: p.styles,
    ratio: p.ratio, credits: p.credits, budget: p.budget,
    acts: p.acts, blocks: p.blocks, assets: p.assets, shots: p.shots,
    sel: {
      step: u.step, beatId: u.nodeSel, assetId: u.assetSel,
      shotId: u.shotSel, blockId: u.blockEdit,
    },
    input,
    agentId,
    agents: useSettings.getState().agents,
    globalModels: effectiveGlobals(useSettings.getState()),
  };
}

export const useAgent = create<AgentState>((set, get) => ({
  messages: [],
  runningId: null,
  step: '',
  agentId: 'writer',
  queue: [],
  brief: '',

  syncStep: (step) => {
    if (get().step === step) return;
    // 流水线自己会跳页（采纳产物后落到产物所在环节）。那不是用户换了话题，
    // 是同一条流水线往下走了一步 —— 清掉会话等于把后面几步一起清掉。
    if (get().queue.length) {
      set({ step, agentId: personaForStep(step).id });
      return;
    }
    get().stop();
    set({ messages: [], runningId: null, queue: [], brief: '', step, agentId: personaForStep(step).id });
  },

  send: (text, kind, relayed = false) => {
    get().stop();
    const meId = seq++;
    const aiId = seq++;
    // 认领当前环节：随后 AgentPanel 的 syncStep 就不会把这轮清掉
    const step = useUi.getState().step;
    // 流水线跨环节，整条算一次会话；否则每跳一页就把前几步的消息清了
    const sameSession = get().step === step || get().queue.length > 0;
    const agentId = sameSession ? get().agentId : personaForStep(step).id;
    set((s) => ({
      step, agentId,
      messages: [
        ...(sameSession ? s.messages : []),
        ...(relayed ? [] : [{ id: meId, who: 'me' as const, text }]),
        { id: aiId, who: 'ai', agentId, text: '', streaming: true, stepDone: 0 },
      ],
      runningId: aiId,
    }));

    const ctrl = new AbortController();
    abort = ctrl;

    const patch = (fn: (m: AgentMessage) => AgentMessage) => set((s) => ({
      messages: s.messages.map((m) => (m.id === aiId ? fn(m) : m)),
    }));

    // 转交后要接着跑的那一轮
    let relay: { text: string; kind: IntentKind } | null = null;

    void (async () => {
      for await (const ev of runAgent(snapshot(text, agentId), kind, ctrl.signal)) {
        switch (ev.t) {
          case 'plan':
            patch((m) => ({ ...m, steps: ev.plan.steps }));
            break;
          case 'proposal':
            patch((m) => ({ ...m, proposal: ev.proposal, verdict: 'pending' }));
            break;
          case 'step':
            patch((m) => ({ ...m, stepDone: ev.index }));
            break;
          case 'delta':
            patch((m) => ({ ...m, text: m.text + ev.text }));
            break;
          case 'handoff': {
            patch((m) => ({ ...m, handoff: ev.handoff }));
            const to = personaById(ev.handoff.to);
            const nextStep = to.steps[0]!;
            // 跳到接手方的主场，再由它重跑同一句输入 —— 转交不是把活儿丢掉
            useUi.getState().setStep(nextStep as ReturnType<typeof useUi.getState>['step']);
            set({ step: nextStep, agentId: to.id });
            relay = { text, kind: ev.handoff.kind };
            break;
          }
          case 'done': {
            patch((m) => ({ ...m, streaming: false }));
            set({ runningId: null });
            const done = get().messages.find((m) => m.id === aiId);
            // 转交的那条消息本来就没有产物 —— 真正的产物由接手方那一轮出。
            // 这里若当成「被挡住」去推进队列，就会和 relay 的那一轮并发跑。
            if (get().queue.length && !ctrl.signal.aborted && !done?.handoff && !relay) {
              if (!done?.proposal) {
                // 这一步被前置条件挡住，没有产物可采纳 —— 跳过，别卡住整条流水线
                setTimeout(() => advance(get, set), 300);
              } else if (useSettings.getState().agents[agentId]?.autonomy === 'auto') {
                // 自主执行也有边界：花钱与出本机的动作照样停下来等人点头。
                // 「自主」省的是点采纳的手，不是取消把关。
                const cfg = useSettings.getState().agents[agentId];
                const risk = riskOfProposal(done.proposal);
                if (autoAllowed(risk, cfg?.autoMax)) {
                  setTimeout(() => get().accept(aiId), 300);
                } else {
                  patch((m) => ({ ...m, hold: holdReason(risk) }));
                  useUi.getState().toast(holdReason(risk));
                }
              }
            }
            break;
          }
          case 'aborted':
            patch((m) => ({ ...m, streaming: false, text: m.text + (m.text ? '\n\n（已中断）' : '（已中断）') }));
            set({ runningId: null });
            break;
        }
      }
      if (relay && !ctrl.signal.aborted) get().send(relay.text, relay.kind, true);
    })();
  },

  stop: () => {
    abort?.abort();
    abort = null;
  },

  accept: (msgId) => {
    const msg = get().messages.find((m) => m.id === msgId);
    if (!msg?.proposal || msg.verdict !== 'pending') return;
    applyProposal(msg.proposal);
    set((s) => ({ messages: s.messages.map((m) => (m.id === msgId ? { ...m, verdict: 'accepted' } : m)) }));
    // 采纳了才往下走 —— 上一步的产物是下一步的输入
    if (get().queue.length) setTimeout(() => advance(get, set), 300);
  },

  discard: (msgId) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === msgId ? { ...m, verdict: 'discarded' } : m)),
    }));
    // 丢弃 = 这条路不走了。剩下的步骤基于这份产物，接着跑没有意义
    if (get().queue.length) {
      set({ queue: [] });
      useUi.getState().toast('已停下 —— 后面的步骤要等这一步的产物，改完再让我接着跑');
    }
  },

  startPipeline: (brief, kind) => {
    const stages = pipelineFor(kind);
    set({ brief, queue: stages.slice(1) });
    // 第一步带上原始需求，后面几步靠项目里已有的内容推进
    get().send(brief, stages[0]!.kind);
  },

  reset: () => {
    get().stop();
    const step = useUi.getState().step;
    set({ messages: [], runningId: null, queue: [], brief: '', step, agentId: personaForStep(step).id });
  },
}));

/** 采纳：写项目 + 扣分 + 提示 + 跳到产物所在环节 */
function applyProposal(p: Proposal): void {
  const project = useProject.getState();
  const ui = useUi.getState();
  // 必须在补丁落库前拍下来：落库后新旧场次就分不出来了
  const beatsBefore = new Set(project.acts.flatMap((a) => a.beats.map((b) => b.id)));

  if (p.patch.t === 'run') {
    if (p.patch.action === 'video.batch') {
      project.batchVidStart();
      ui.toast('批量转视频已排队 —— 跑完记得逐镜判定');
      setTimeout(() => useProject.getState().batchVidDone(), 1500);
    } else {
      ui.toast('已按场次顺序排好可用片段');
    }
  } else {
    project.applyAgentPatch(p.patch);
    if (p.cost) project.spend(p.cost);
    ui.toast(p.cost ? `${p.title} · 消耗 ${p.cost} 积分` : p.title);
  }

  if (p.goto && p.goto !== ui.step) ui.setStep(p.goto as ReturnType<typeof useUi.getState>['step']);
  // 采纳了新资产/新镜头时把选中挪过去，人一眼能看见产物落在哪
  focusProduct(p, beatsBefore);
}

function focusProduct(p: Proposal, beatsBefore: ReadonlySet<string>): void {
  const ui = useUi.getState();
  switch (p.patch.t) {
    case 'assets': {
      const first = p.patch.add[0];
      if (first) ui.selectAsset(first.asset.id);
      break;
    }
    case 'shots': {
      const first = p.patch.shots[0];
      if (first) ui.selectShot(first.id);
      break;
    }
    case 'acts': {
      const beats = p.patch.acts.flatMap((a) => a.beats);
      const fresh = beats.find((b) => !beatsBefore.has(b.id)) ?? beats[0];
      if (fresh) ui.selectNode(fresh.id);
      break;
    }
    case 'assetViews': {
      const g = p.patch.gen[0];
      if (g) ui.selectAsset(g.assetId, g.viewName);
      break;
    }
    case 'shotPrompts': {
      const e = p.patch.edits[0];
      if (e) ui.selectShot(e.id);
      break;
    }
  }
}

