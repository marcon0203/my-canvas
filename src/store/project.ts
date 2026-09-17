import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';
import { temporal } from 'zundo';
import type { Asset, AssetGroup, AssetView, Rig, CineKey } from '@/domain/assets/model';
import { defaultRig, lockAsset, unlockAsset, viewRig } from '@/domain/assets/model';
import type { Shot, Verdict } from '@/domain/shots/model';
import { addShot as addShotAt } from '@/domain/shots/model';
import type { Intent } from '@/domain/prompt/vocabulary';
import { applyIntentToView, RIG_COPY_KEYS } from '@/domain/prompt/apply';
import type { ProjectBootstrap } from '@/api/mock';
import type { Act, DocBlock } from '@/domain/story/model';
import type { ProposalPatch } from '@/domain/agent/types';
import type { Clip, Cue } from '@/domain/clips/model';
import { assetShell } from '@/domain/agent/drafts';

export type { AssetGroup } from '@/domain/assets/model';

/** 项目内容态：全部可撤销（产品无确认闸口，靠历史兜底） */
export interface ProjectState {
  proj: string;
  credits: number;
  style: string;
  ratio: string;
  stylePrompt: string;
  styles: string[];
  acts: Act[];
  alts: Record<string, string[]>;
  blocks: DocBlock[];
  assets: Record<AssetGroup, Asset[]>;
  shots: Shot[];
  /**
   * 成片顺序与卡点。空 = 还没排过。
   * store 里存可变副本（immer 的 draft 要求），对外仍按 Timeline 读
   */
  timeline: { clips: Clip[]; beatMs?: number };
  /** 字幕轨。空 = 还没生成过 */
  subtitles: { lang: string; cues: Cue[] };
  /** 服务端能力配置（mock 下发） */
  models: string[];
  ratios: string[];
  /** 总览画布 PIN */
  pins: { id: string; n: string }[];
  /** 积分预算（消耗 = 预算 - 余额） */
  budget: number;
  /** 已注入的项目 ID（切换项目时以此判断是否需要重新拉取） */
  hydratedFor?: string;
  /* ---- 内容变更 ---- */
  hydrate: (b: ProjectBootstrap) => void;
  spend: (n: number) => void;
  setStyle: (s: string) => void;
  updateBlock: (id: string, body: string) => void;
  setViewStyle: (assetId: string, viewName: string, style: string) => void;
  genAssetView: (assetId: string, viewName: string) => void;
  lockAsset: (assetId: string) => void;
  unlockAsset: (assetId: string) => void;
  addAssetView: (assetId: string, name: string, style: string, prompt: string) => void;
  applyRigToPeers: (assetId: string, viewName: string) => void;
  patchViewRig: (assetId: string, viewName: string, patch: Partial<Rig>) => void;
  setViewGen: (assetId: string, viewName: string, gen: boolean) => void;
  /** 手改形状照提示词；传 null 交回自动合成 */
  setViewPrompt: (assetId: string, viewName: string, custom: string | null) => void;
  patchShotRig: (shotId: string, patch: Partial<Rig>) => void;
  applyIntentToAssetView: (assetId: string, viewName: string, it: Intent) => void;
  setShotField: (shotId: string, patch: Partial<Pick<Shot, 'own' | 'model' | 'batch' | 'ratio' | 'style' | 'dur' | 'desc' | 'custom' | 'ejected' | 'keyIdx' | 'vid'>>) => void;
  toggleShotRef: (shotId: string, aid: string) => void;
  setShotRefImg: (shotId: string, ref: string) => void;
  commitRun: (shotId: string) => void;
  setVerdict: (shotId: string, v: Verdict, extraTakes?: number) => void;
  genKey: (shotId: string) => void;
  genAllKeys: () => void;
  batchVidStart: () => void;
  batchVidDone: () => void;
  expandAlts: (beatId: string, alts: string[]) => void;
  addShot: (sceneKey: string) => string | undefined;
  deleteShot: (id: string) => void;
  batchRef: () => void;
  /** Agent 产物落库：一次补丁 = 一条撤销记录，采纳错了一次 Ctrl+Z 全退回 */
  applyAgentPatch: (patch: ProposalPatch) => void;
}

/** 深比较（跳过长字符串：dataURL 姿态图不进历史判断） */
const contentEqual = (a: ProjectState, b: ProjectState): boolean => {
  const strip = (x: unknown) => JSON.stringify(x, (_k, v) =>
    typeof v === 'string' && v.length > 512 ? '<long>' : v);
  const of = (x: ProjectState) => [x.blocks, x.assets, x.shots, x.acts, x.alts, x.timeline, x.subtitles];
  return strip(of(a)) === strip(of(b));
};

export const useProject = create<ProjectState>()(
  temporal(
    immer((set) => ({
      proj: '',
      credits: 0,
      style: '',
      ratio: '9:16',
      stylePrompt: '',
      styles: [],
      acts: [],
      alts: {},
      blocks: [],
      assets: { 角色: [], 场景: [], 道具: [] },
      shots: [],
      timeline: { clips: [] },
      subtitles: { lang: 'zh', cues: [] },
      models: [],
      ratios: [],
      pins: [],
      budget: 0,

      hydrate: (b) => set((s) => {
        s.proj = b.project.proj;
        s.credits = b.project.credits;
        s.style = b.project.style;
        s.ratio = b.project.ratio;
        s.stylePrompt = b.project.stylePrompt;
        s.styles = [...b.project.styles];
        s.acts = b.project.acts;
        s.blocks = b.project.blocks;
        s.assets = b.project.assets;
        s.shots = b.project.shots;
        // 结构化克隆：mock 与工作空间给的都是只读形状，直接塞进 draft 会被 immer 冻住
        s.timeline = { clips: [...(b.project.timeline?.clips ?? [])], beatMs: b.project.timeline?.beatMs };
        s.subtitles = { lang: b.project.subtitles?.lang ?? 'zh', cues: [...(b.project.subtitles?.cues ?? [])] };
        s.models = [...b.config.models];
        s.ratios = [...b.config.ratios];
        s.pins = [...b.project.pins];
        s.budget = b.project.budget;
        s.hydratedFor = b.project.id;
      }),

      spend: (n) => set((s) => { s.credits = Math.max(0, s.credits - n); }),
      setStyle: (v) => set((s) => { s.style = v; }),
      updateBlock: (id, body) => set((s) => { const b = s.blocks.find((x) => x.id === id); if (b) b.body = body; }),

      setViewStyle: (assetId, viewName, style) => set((s) => {
        findView(s.assets, assetId, viewName)!.style = style;
      }),
      genAssetView: (assetId, viewName) => set((s) => {
        const v = findView(s.assets, assetId, viewName)!;
        v.gen = true;
        v.redo += 1;
        s.credits = Math.max(0, s.credits - 2);
      }),
      setViewGen: (assetId, viewName, gen) => set((s) => {
        findView(s.assets, assetId, viewName)!.gen = gen;
      }),
      setViewPrompt: (assetId, viewName, custom) => set((s) => {
        const v = findView(s.assets, assetId, viewName)!;
        if (custom === null) delete v.custom;
        else v.custom = custom;
      }),

      lockAsset: (assetId) => set((s) => {
        const a = findAsset(s.assets, assetId)!;
        lockAsset(a);
        for (const shot of s.shots) {
          if (shot.refs.includes(a.aid)) shot.refVer[a.aid] = a.ver;
        }
      }),
      unlockAsset: (assetId) => set((s) => { unlockAsset(findAsset(s.assets, assetId)!); }),

      addAssetView: (assetId, name, style, prompt) => set((s) => {
        const a = findAsset(s.assets, assetId)!;
        a.views.push({ name, style, gen: true, redo: 0, prompt, rig: defaultRig(name) });
        s.credits = Math.max(0, s.credits - 2);
      }),

      applyRigToPeers: (assetId, viewName) => set((s) => {
        const a = findAsset(s.assets, assetId)!;
        const src = viewRig(a.views.find((x) => x.name === viewName)!);
        for (const peer of a.views) {
          if (peer.name === viewName) continue;
          const r = viewRig(peer);
          for (const k of RIG_COPY_KEYS) (r[k] as unknown) = src[k];
        }
      }),

      patchViewRig: (assetId, viewName, patch) => set((s) => {
        Object.assign(viewRig(findView(s.assets, assetId, viewName)!), patch);
      }),
      patchShotRig: (shotId, patch) => set((s) => {
        Object.assign(s.shots.find((x) => x.id === shotId)!.rig, patch);
      }),
      applyIntentToAssetView: (assetId, viewName, it) => set((s) => {
        applyIntentToView(findView(s.assets, assetId, viewName)!, it);
      }),

      setShotField: (shotId, patch) => set((s) => {
        Object.assign(s.shots.find((x) => x.id === shotId)!, patch);
      }),
      toggleShotRef: (shotId, aid) => set((s) => {
        const shot = s.shots.find((x) => x.id === shotId)!;
        const i = shot.refs.indexOf(aid);
        if (i >= 0) {
          shot.refs.splice(i, 1);
          delete shot.refVer[aid];
        } else {
          shot.refs.push(aid);
          const a = allAssets(s.assets).find((x) => x.aid === aid);
          shot.refVer[aid] = a ? Math.max(1, a.ver) : 1;
        }
      }),
      setShotRefImg: (shotId, ref) => set((s) => {
        const shot = s.shots.find((x) => x.id === shotId)!;
        if (ref) shot.refImg = ref;
        else delete shot.refImg;
      }),

      commitRun: (shotId) => set((s) => {
        const shot = s.shots.find((x) => x.id === shotId)!;
        shot.takes += 2;
        shot.key = true;
      }),
      setVerdict: (shotId, v, extraTakes = 0) => set((s) => {
        const shot = s.shots.find((x) => x.id === shotId)!;
        shot.verdict = v;
        if (v === 'ok') { shot.vid = 'ok'; shot.key = true; if (!shot.takes) shot.takes = 4; }
        if (extraTakes) shot.takes += extraTakes;
      }),

      genKey: (shotId) => set((s) => {
        const shot = s.shots.find((x) => x.id === shotId)!;
        shot.key = true;
        shot.takes += 2;
        s.credits = Math.max(0, s.credits - 2);
      }),
      genAllKeys: () => set((s) => {
        for (const shot of s.shots) shot.key = true;
        s.credits = Math.max(0, s.credits - 10);
      }),
      batchVidStart: () => set((s) => {
        for (const shot of s.shots) {
          if (shot.vid === 'none') { shot.vid = 'run'; shot.takes += 4; }
        }
        s.credits = Math.max(0, s.credits - 24);
      }),
      batchVidDone: () => set((s) => {
        for (const shot of s.shots) {
          if (shot.vid === 'run') { shot.vid = 'ok'; shot.key = true; }
        }
      }),

      expandAlts: (beatId, alts) => set((s) => { s.alts[beatId] = alts; }),
      addShot: (sceneKey) => {
        let id: string | undefined;
        set((s) => { id = addShotAt(s.shots, sceneKey).id; });
        return id;
      },
      deleteShot: (id) => set((s) => {
        const i = s.shots.findIndex((x) => x.id === id);
        if (i >= 0) s.shots.splice(i, 1);
      }),
      batchRef: () => set((s) => {
        for (const a of allAssets(s.assets)) {
          for (const v of a.views) v.gen = true;
        }
        s.credits = Math.max(0, s.credits - 18);
      }),

      applyAgentPatch: (patch) => set((s) => {
        switch (patch.t) {
          case 'acts':
            s.acts = patch.acts;
            break;
          case 'alts':
            s.alts[patch.beatId] = patch.alts;
            break;
          case 'blocks':
            s.blocks.push(...patch.blocks);
            break;
          case 'blockBody': {
            const b = s.blocks.find((x) => x.id === patch.id);
            if (b) b.body = patch.body;
            break;
          }
          case 'assets':
            for (const { group, asset } of patch.add) s.assets[group].push(asset);
            break;
          case 'assetsDraft':
            // aid 是 Rust 侧编好的，这儿只把形状补全（见 assetShell 上的说明）
            for (const d of patch.add) s.assets[d.group].push(assetShell(d));
            break;
          case 'shotRig':
            for (const e of patch.edits) {
              const sh = s.shots.find((x) => x.id === e.id);
              // 逐字段合并，不整份替换 —— 整份替换会把布光台上调过的值抹回默认
              if (sh) Object.assign(sh.rig, e.rig);
            }
            break;
          case 'assetLock': {
            const a = [...s.assets.角色, ...s.assets.场景, ...s.assets.道具]
              .find((x) => x.aid === patch.aid);
            if (a) { a.status = 'locked'; a.ver += 1; }
            break;
          }
          case 'assetViews':
            for (const g of patch.gen) {
              const v = findView(s.assets, g.assetId, g.viewName);
              if (v) { v.gen = true; v.redo += 1; }
            }
            break;
          case 'shots':
            // 按场次插到该场最后一镜之后，保证分镜表顺序自然
            for (const shot of patch.shots) {
              const last = s.shots.map((x) => x.sceneKey).lastIndexOf(shot.sceneKey);
              if (last === -1) s.shots.push(shot);
              else s.shots.splice(last + 1, 0, shot);
            }
            break;
          case 'shotPrompts':
            for (const e of patch.edits) {
              const shot = s.shots.find((x) => x.id === e.id);
              if (shot) shot.own = e.own;
            }
            break;
          case 'style':
            s.style = patch.style;
            s.stylePrompt = patch.stylePrompt;
            break;
          case 'timeline':
            // 整条换掉：顺序与时长是一起算出来的，逐段合并会留下上一次的残段
            s.timeline = { clips: [...patch.timeline.clips], beatMs: patch.timeline.beatMs };
            break;
          case 'subtitles':
            s.subtitles = { lang: patch.subtitles.lang, cues: [...patch.subtitles.cues] };
            break;
          case 'run':
            // 运行类产物不改内容，由 store 的既有动作执行（见 store/agent.ts）
            break;
        }
      }),
    })),
    { limit: 50, equality: (past, current) => contentEqual(past as ProjectState, current as ProjectState) },
  ),
);

/**
 * 等某个项目的内容注入 store。
 *
 * 新建项目后要立刻让 Agent 开跑，但注入是 AppShell 那边的 query 回来才发生的。
 * 原来这里等的是 `setTimeout(900)`：慢机器或大项目上，900ms 到了内容还没进来，
 * Agent 就会在**上一个项目**上开跑 —— 而且看不出来，因为界面已经切过去了。
 *
 * 超时不静默：到点还没注入就 reject，调用方负责告诉人「项目建好了但没打开」。
 */
export function waitHydrated(id: string, timeoutMs = 8000): Promise<void> {
  if (useProject.getState().hydratedFor === id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => { clearTimeout(timer); unsub(); fn(); };
    const timer = setTimeout(
      () => done(() => reject(new Error(`等了 ${Math.round(timeoutMs / 1000)} 秒，项目 ${id} 的内容还没加载出来`))),
      timeoutMs,
    );
    const unsub = useProject.subscribe((s) => {
      if (s.hydratedFor === id) done(resolve);
    });
  });
}

/* ---- 内部查找 ---- */
type Assets = Record<AssetGroup, Asset[]>;
export const allAssets = (assets: Assets): Asset[] => [...assets.角色, ...assets.场景, ...assets.道具];
const findAsset = (assets: Assets, id: string): Asset | undefined => allAssets(assets).find((a) => a.id === id);
const findView = (assets: Assets, assetId: string, viewName: string): AssetView | undefined =>
  findAsset(assets, assetId)?.views.find((x) => x.name === viewName);

/** 便捷 hooks（树/检查器共用）。allAssets 每次建新数组，必须配 useShallow，否则无限重渲染 */
export const useAssetList = (): Asset[] => useProject(useShallow((s) => allAssets(s.assets)));
export const useAssetById = (id: string): Asset | undefined => useAssetList().find((a) => a.id === id);
export const useAssetByAid = (aid: string): Asset | undefined => useAssetList().find((a) => a.aid === aid);
export type { Asset, AssetView, Rig, CineKey, Shot };
