import { create } from 'zustand';
import { runAgent } from '@/api/agent';
import type { AgentContext } from '@/domain/agent/context';
import type { AgentMessage, IntentKind, Proposal } from '@/domain/agent/types';
import { useProject } from './project';
import { useUi } from './ui';

/**
 * Agent 会话态：消息、流式进度、待采纳产物。不进撤销历史 ——
 * 撤销的粒度是「采纳的那份产物」，由 project.applyAgentPatch 记一条。
 */

export interface AgentState {
  messages: AgentMessage[];
  /** 正在跑的那条 ai 消息 id */
  runningId: number | null;
  /** 这轮会话属于哪个环节 —— 换环节开新会话 */
  step: string;
  send: (text: string, kind?: IntentKind) => void;
  /** 环节变了就清空。send 会先认领当前环节，所以「跳页并发起」不会被清掉 */
  syncStep: (step: string) => void;
  stop: () => void;
  accept: (msgId: number) => void;
  discard: (msgId: number) => void;
  reset: () => void;
}

let seq = 1;
let abort: AbortController | null = null;

/** 从两个 store 组装 Agent 看到的项目快照 */
function snapshot(input: string): AgentContext {
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
  };
}

export const useAgent = create<AgentState>((set, get) => ({
  messages: [],
  runningId: null,
  step: '',

  syncStep: (step) => {
    if (get().step === step) return;
    get().stop();
    set({ messages: [], runningId: null, step });
  },

  send: (text, kind) => {
    get().stop();
    const meId = seq++;
    const aiId = seq++;
    // 认领当前环节：随后 AgentPanel 的 syncStep 就不会把这轮清掉
    const step = useUi.getState().step;
    set((s) => ({
      step,
      messages: [
        ...(s.step === step ? s.messages : []),
        { id: meId, who: 'me', text },
        { id: aiId, who: 'ai', text: '', streaming: true, stepDone: 0 },
      ],
      runningId: aiId,
    }));

    const ctrl = new AbortController();
    abort = ctrl;

    const patch = (fn: (m: AgentMessage) => AgentMessage) => set((s) => ({
      messages: s.messages.map((m) => (m.id === aiId ? fn(m) : m)),
    }));

    void (async () => {
      for await (const ev of runAgent(snapshot(text), kind, ctrl.signal)) {
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
          case 'done':
            patch((m) => ({ ...m, streaming: false }));
            set({ runningId: null });
            break;
          case 'aborted':
            patch((m) => ({ ...m, streaming: false, text: m.text + (m.text ? '\n\n（已中断）' : '（已中断）') }));
            set({ runningId: null });
            break;
        }
      }
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
  },

  discard: (msgId) => set((s) => ({
    messages: s.messages.map((m) => (m.id === msgId ? { ...m, verdict: 'discarded' } : m)),
  })),

  reset: () => {
    get().stop();
    set({ messages: [], runningId: null, step: useUi.getState().step });
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
