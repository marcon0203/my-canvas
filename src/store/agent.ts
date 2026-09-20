import { create } from 'zustand';
import { runAgent, toolOkText, toolProposal } from '@/api/agent';
import { toolCall } from '@/api/desktop';
import { TOOLS, type ToolId } from '@/domain/agent/tools';
import type { AgentContext } from '@/domain/agent/context';
import type { AgentId } from '@/domain/agent/roster';
import { personaById, personaForStep } from '@/domain/agent/roster';
import type { AgentMessage, IntentKind, Proposal } from '@/domain/agent/types';
import { pipelineFor, type ProjectKind, type Stage } from '@/domain/agent/pipeline';
import {
  archive, dropArchive, listArchive, loadLive, saveLive, takeArchive, type ChatSession,
} from '@/api/chatlog';
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
  /**
   * 这条流水线一共几步。**不能用 queue.length 反推** —— 队列是边跑边弹空的，
   * 弹完就说不出「第几步 / 共几步」了，而界面必须说得出，否则用户看到的是
   * 一次孤立的结果，不知道自己在一条七步的路上
   */
  planTotal: number;
  /** 这条流水线要做什么，摆在会话开头，也写进项目的 brief.md */
  brief: string;
  /** 这个项目是哪一类。决定主干跳哪几步，也决定「接着做什么」 */
  kind: ProjectKind;
  startPipeline: (brief: string, kind: ProjectKind) => void;
  /** 停下剩下的步骤，但不动已经采纳的产物 */
  stopPlan: () => void;
  /**
   * 换项目：把当前会话存到旧项目名下，再把新项目的读出来。
   *
   * **会话按项目分**。一个项目里换环节（大纲 → 剧本 → 分镜）是同一条会话
   * 往下走，不该清 —— 换环节只是换当班的那位。
   */
  bindProject: (projectId: string) => void;
  /** 这条会话属于哪个项目。空串 = 还没进项目（首页） */
  projectId: string;
  /** 存档列表，界面上「会话历史」按它画 */
  archived: ChatSession[];
  /** 恢复一份存档：当前这条先存档，再把它读成当前会话 */
  restore: (id: string) => void;
  dropArchived: (id: string) => void;
  /** 环节变了就清空。send 会先认领当前环节，所以「跳页并发起」不会被清掉 */
  syncStep: (step: string) => void;
  stop: () => void;
  accept: (msgId: number) => void;
  discard: (msgId: number) => void;
  /**
   * 直接调一个工具（页面上的按钮走这条，不经过模型）。
   *
   * 为什么结果落在会话里：写项目统一走「产物卡 → 采纳 → 一条撤销」。
   * 页面按钮自己写一遍会绕开撤销和权限那两道，迟早对不上。
   */
  runTool: (tool: ToolId, args?: Record<string, unknown>) => void;
  /** 人点了「同意并执行」：拿同一份参数再调一次，这一次带上放行标记 */
  approveTool: (msgId: number) => void;
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
    proj: p.proj, projectId: p.hydratedFor ?? '',
    style: p.style, stylePrompt: p.stylePrompt, styles: p.styles,
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
  planTotal: 0,
  brief: '',
  kind: '短剧',
  projectId: '',
  archived: [],

  /**
   * 换环节。**只换当班的那位，不清会话。**
   *
   * 原来这里会把消息清空（「换环节开新会话」），于是从大纲跳到剧本，
   * 刚才那几轮就没了 —— 反馈原话是「对话历史记录也丢了」。
   * 会话按项目分，一个项目里的几个环节是同一条流水线，本来就该连着看。
   */
  syncStep: (step) => {
    if (get().step === step) return;
    set({ step, agentId: personaForStep(step).id });
  },

  bindProject: (projectId) => {
    if (get().projectId === projectId) return;
    const prev = get().projectId;
    if (prev) saveLive(prev, snap(get()));
    get().stop();
    const live = loadLive(projectId);
    set({
      projectId,
      archived: listArchive(projectId),
      messages: live ? [...live.messages] : [],
      queue: live ? [...live.queue] : [],
      planTotal: live?.planTotal ?? 0,
      brief: live?.brief ?? '',
      kind: live?.kind ?? '短剧',
      agentId: live?.agentId ?? personaForStep(useUi.getState().step).id,
      runningId: null,
      step: useUi.getState().step,
    });
  },

  restore: (id) => {
    const pid = get().projectId;
    if (!pid) return;
    // 当前这条先存档，否则恢复旧的就把现在这条弄没了
    archive(pid, snap(get()));
    const { session, rest } = takeArchive(pid, id);
    if (!session) { set({ archived: rest }); return; }
    get().stop();
    set({
      messages: [...session.messages],
      queue: [...session.queue],
      planTotal: session.planTotal,
      brief: session.brief,
      kind: session.kind,
      agentId: session.agentId,
      runningId: null,
      archived: listArchive(pid),
    });
  },

  dropArchived: (id) => {
    const pid = get().projectId;
    if (!pid) return;
    set({ archived: dropArchive(pid, id) });
  },

  send: (text, kind, relayed = false) => {
    get().stop();
    const meId = seq++;
    const aiId = seq++;
    // 认领当前环节。**消息一律接着往后加** —— 换环节不再清会话，
    // 会话按项目分，一个项目里几个环节是同一条流水线
    const step = useUi.getState().step;
    const agentId = get().step === step ? get().agentId : personaForStep(step).id;
    set((s) => ({
      step, agentId,
      messages: [
        ...s.messages,
        ...(relayed ? [] : [{ id: meId, who: 'me' as const, text }]),
        { id: aiId, who: 'ai', agentId, text: '', streaming: true, stepDone: 0, kind },
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
          case 'think':
            patch((m) => ({ ...m, think: (m.think ?? '') + ev.text }));
            break;
          case 'usage':
            // **立刻记，不等采纳**：token 在请求发出去的那一刻就烧掉了，
            // 产物丢弃也退不回来。积分是采纳时才扣（那是预估口径，
            // 表达的是「你打算为这份产物付多少」）—— 两个数记在不同时机，
            // 正因为它们是两件事
            useProject.getState().addUsage(ev);
            patch((m) => ({
              ...m,
              usage: {
                inputTokens: (m.usage?.inputTokens ?? 0) + ev.inputTokens,
                outputTokens: (m.usage?.outputTokens ?? 0) + ev.outputTokens,
              },
            }));
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
      useUi.getState().toast('已停下。后面几步要用这一步的产物，改完再让我接着跑。');
    }
  },

  startPipeline: (brief, kind) => {
    const stages = pipelineFor(kind);
    set({ brief, kind, queue: stages.slice(1), planTotal: stages.length });
    // 第一步带上原始需求，后面几步靠项目里已有的内容推进
    get().send(brief, stages[0]!.kind);
  },

  stopPlan: () => {
    if (!get().queue.length) return;
    set({ queue: [] });
    useUi.getState().toast('剩下的步骤停下了。已采纳的产物都留着，想接着跑再说一句。');
  },

  runTool: (tool, args = {}) => {
    void dispatchTool(get, set, tool, args, false);
  },

  approveTool: (msgId) => {
    const msg = get().messages.find((m) => m.id === msgId);
    if (msg?.tool?.state !== 'approval') return;
    void dispatchTool(get, set, msg.tool.id, msg.tool.args, true, msgId);
  },

  reset: () => {
    get().stop();
    const pid = get().projectId;
    // 「新会话」= 把这条收进历史，不是把它删掉
    const archived = pid ? archive(pid, snap(get())) : [];
    const step = useUi.getState().step;
    set({
      messages: [], runningId: null, queue: [], planTotal: 0, brief: '',
      step, agentId: personaForStep(step).id, archived,
    });
    if (pid) saveLive(pid, snap(useAgent.getState()));
  },
}));

/** 当前会话的快照，存盘用 */
const snap = (s: AgentState): Omit<ChatSession, 'id' | 'at' | 'title'> => ({
  messages: s.messages,
  queue: s.queue,
  planTotal: s.planTotal,
  brief: s.brief,
  kind: s.kind,
  agentId: s.agentId,
});

/**
 * 会话变了就存一份。
 *
 * 用订阅而不是在每个 set 后面补一句：会改消息的地方有七八处（发送、流式、
 * 采纳、丢弃、工具卡的五种状态…），补漏一处就是「这种情况下历史会丢」，
 * 而那种 bug 要用户跑到那一步才发现。
 */
let lastSaved: { m: unknown; q: unknown; b: string; t: number } | null = null;
useAgent.subscribe((s) => {
  // 流式输出时每个字都会触发一次 set，那时候不存 —— 一轮结束（runningId 归空）
  // 会再触发一次，存那一次就够
  if (!s.projectId || s.runningId) return;
  if (
    lastSaved
    && lastSaved.m === s.messages
    && lastSaved.q === s.queue
    && lastSaved.b === s.brief
    && lastSaved.t === s.planTotal
  ) {
    return;
  }
  lastSaved = { m: s.messages, q: s.queue, b: s.brief, t: s.planTotal };
  saveLive(s.projectId, snap(s));
});

/** 采纳：写项目 + 扣分 + 提示 + 跳到产物所在环节 */
function applyProposal(p: Proposal): void {
  const project = useProject.getState();
  const ui = useUi.getState();
  // 必须在补丁落库前拍下来：落库后新旧场次就分不出来了
  const beatsBefore = new Set(project.acts.flatMap((a) => a.beats.map((b) => b.id)));

  // 采纳**只写项目**，不再在这儿触发任何后台活儿。
  //
  // 原来这儿有一段：`video.batch` 的产物采纳后调 `batchVidStart()` 就立刻返回，
  // 1500ms 后一个 setTimeout 把所有镜头置成可用。于是队列在活儿还没干完时
  // 就推进到了下一步「自动成片」，而自动成片取的是已出片的镜头 —— 必然为空。
  // 走查里第 6 步刚采纳「批量转视频 · 18 镜」，第 7 步就回「还没有可用的
  // 视频片段」，就是这段代码。
  //
  // 现在真活儿在产物**产生之前**就干完了（见 runVideoBatchOnDesktop），
  // 采纳拿到的是一份已经落盘的文件清单，同步写完即可，竞态不存在了。
  project.applyAgentPatch(p.patch);
  // 示例产物不扣分 —— 没调模型的东西不该记账
  if (p.cost && !p.demo) project.spend(p.cost);
  ui.toast(p.demo
    ? `${p.title}（示例，未调用模型，不计费）`
    : p.cost ? `${p.title} · 消耗 ${p.cost} 积分` : p.title);

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


/**
 * 调一次工具，把结果落成会话里的一条消息。
 *
 * 六种结果各有各的下一步，所以不能合成一个「成功/失败」：
 * - patch        → 产物卡，人采纳才写项目
 * - ok           → 摘要文字（只读类工具，没有东西要写）
 * - needsApproval→ 同意卡，点了再带 approved 调一次
 * - needsSetup   → 去设置卡，缺的是模型/密钥/厂商适配
 * - notImplemented → 如实说还没做，并说清缺什么
 * - elsewhere    → 这个工具在浏览器里跑（布光台），交给 toolhost
 *
 * `msgId` 有值表示是「同意后重跑」，复用原来那条消息，不再冒一条新的。
 */
async function dispatchTool(
  get: () => AgentState,
  set: (p: Partial<AgentState> | ((s: AgentState) => Partial<AgentState>)) => void,
  tool: ToolId,
  args: Record<string, unknown>,
  approved: boolean,
  msgId?: number,
): Promise<void> {
  const spec = TOOLS.find((t) => t.id === tool);
  const name = spec?.name ?? tool;
  const agentId = get().agentId;
  const id = msgId ?? seq++;
  const base = { id, who: 'ai' as const, agentId, text: '' };

  const patchMsg = (fn: (m: AgentMessage) => AgentMessage) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }));

  if (msgId === undefined) {
    set((s) => ({
      messages: [...s.messages, { ...base, tool: { id: tool, name, args, state: 'running' } }],
    }));
  } else {
    patchMsg((m) => ({ ...m, text: '', tool: { ...m.tool!, state: 'running' } }));
  }

  const projectId = useProject.getState().hydratedFor ?? '';
  if (!projectId) {
    patchMsg((m) => ({ ...m, tool: { ...m.tool!, state: 'failed', why: '没有打开的项目' } }));
    return;
  }

  const cfg = useSettings.getState().agents[agentId];
  try {
    const out = await toolCall({
      projectId, tool, args,
      autoMax: cfg?.autoMax,
      approved,
      cfg, globals: effectiveGlobals(useSettings.getState()),
      providers: useSettings.getState().providers,
      workspace: useSettings.getState().workspace,
    });

    switch (out.t) {
      case 'patch':
        patchMsg((m) => ({
          ...m,
          tool: { ...m.tool!, state: 'done' },
          proposal: toolProposal(tool, out.patch, undefined),
          verdict: 'pending',
        }));
        break;
      case 'ok':
        patchMsg((m) => ({ ...m, tool: { ...m.tool!, state: 'done' }, text: toolOkText(tool, out.value) }));
        break;
      case 'needsApproval':
        patchMsg((m) => ({ ...m, tool: { ...m.tool!, state: 'approval', why: out.why, risk: out.risk } }));
        break;
      case 'needsSetup':
        patchMsg((m) => ({ ...m, tool: { ...m.tool!, state: 'setup', why: out.missing } }));
        break;
      case 'notImplemented':
        patchMsg((m) => ({ ...m, tool: { ...m.tool!, state: 'blocked', why: out.blockedBy } }));
        break;
      case 'elsewhere':
        patchMsg((m) => ({
          ...m,
          tool: { ...m.tool!, state: 'blocked', why: '这个工具在浏览器里跑，还没接到会话上' },
        }));
        break;
    }
  } catch (e) {
    // 工具自己的校验错误（没有可用片段、镜头不存在…）也走这儿。
    // 这些不是崩溃，是「这活现在做不了」，所以照原话摆出来
    patchMsg((m) => ({
      ...m,
      tool: { ...m.tool!, state: 'failed', why: String((e as { message?: string })?.message ?? e) },
    }));
  }
}
