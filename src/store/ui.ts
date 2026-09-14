import { create } from 'zustand';

export type Step = 'outline' | 'script' | 'assets' | 'storyboard' | 'editing' | 'overview' | 'metrics';
export type Modal = null | 'stage' | 'gear';

export interface AgentMsg {
  who: 'me' | 'ai';
  t: string;
}

export interface Toast {
  id: number;
  text: string;
}

/** UI 态：选中、弹窗、折叠、画布相机 —— 全部不进撤销历史 */
export interface UiState {
  route: 'home' | 'project';
  projectId: string;
  step: Step;
  nodeSel: string;
  assetSel: string;
  viewSel: Record<string, string>;
  shotSel: string;
  clipSel: string;
  docTab: 'character' | 'outline' | 'text';
  blockEdit: string | null;
  modal: Modal;
  stageSel: 'cam' | 'light';
  proMode: boolean;
  dimPick: boolean;
  auxOpen: boolean;
  learnOpen: boolean;
  agent: AgentMsg[];
  toasts: Toast[];
  cv: { tx: number; ty: number; zoom: number; sel: string | null; confirmDel: string | null };
  /* ---- 动作 ---- */
  setRoute: (r: UiState['route']) => void;
  setStep: (s: Step) => void;
  set: <K extends keyof UiState>(k: K, v: UiState[K]) => void;
  selectNode: (id: string) => void;
  selectAsset: (id: string, viewName?: string) => void;
  selectShot: (id: string) => void;
  toast: (text: string) => void;
  agentSay: (me: string, ai?: string) => void;
  agentReset: () => void;
  openModal: (m: Modal) => void;
}

let toastSeq = 1;

export const useUi = create<UiState>((set) => ({
  route: 'home',
  projectId: '',
  step: 'outline',
  nodeSel: 'b3',
  assetSel: 'c1',
  viewSel: {},
  shotSel: 's1-1',
  clipSel: 's1-1',
  docTab: 'character',
  blockEdit: null,
  modal: null,
  stageSel: 'cam',
  proMode: false,
  dimPick: false,
  auxOpen: false,
  learnOpen: false,
  agent: [],
  toasts: [],
  cv: { tx: 20, ty: 10, zoom: 0.85, sel: null, confirmDel: null },

  setRoute: (route) => set({ route }),
  setStep: (step) => set({ step, agent: [] }),
  set: (k, v) => set({ [k]: v } as Partial<UiState>),
  selectNode: (id) => set({ nodeSel: id }),
  selectAsset: (id, viewName) => set((s) => ({
    assetSel: id,
    viewSel: viewName ? { ...s.viewSel, [id]: viewName } : s.viewSel,
  })),
  selectShot: (id) => set({ shotSel: id }),
  toast: (text) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2400);
  },
  agentSay: (me, ai) => set((s) => ({
    agent: [...s.agent, { who: 'me', t: me }, ...(ai ? [{ who: 'ai' as const, t: ai }] : [])],
  })),
  agentReset: () => set({ agent: [] }),
  openModal: (modal) => set({ modal }),
}));

/** 每个 flow 环节 Agent 建议的技能 */
export const SKILLS: Record<string, [string, string][]> = {
  outline: [['spark', 'Start from an idea'], ['map', 'Expand plot paths'], ['book', 'Draft an outline'], ['wand', 'Polish prompts']],
  script: [['spark', 'Start from an idea'], ['text', 'Draft a Script'], ['users', 'Generate Multi-View Character'], ['wand', 'Polish prompts']],
  assets: [['users', 'Generate Multi-View Character'], ['image', 'Batch reference images'], ['wand', 'Style transfer'], ['layers', 'Re-extract from script']],
  storyboard: [['image', 'Generate keyframes'], ['text', 'Write shot prompts'], ['video', 'Batch to video'], ['wand', 'Polish prompts']],
  editing: [['scissors', 'Auto-cut to music'], ['text', 'Add subtitles'], ['mic', 'Voice-over'], ['dl', 'Export MP4']],
  overview: [['spark', 'Start from an idea'], ['layers', 'Re-extract from script'], ['video', 'Batch to video'], ['dl', 'Export MP4']],
  metrics: [['wand', 'Polish prompts'], ['bolt', 'Cost report'], ['layers', 'Re-extract from script']],
};
