import type { Asset, AssetGroup, AssetView } from '@/domain/assets/model';
import { AID_PREFIX, defaultRig } from '@/domain/assets/model';
import type { Shot } from '@/domain/shots/model';
import { makeShot } from '@/domain/shots/model';
import type { Act, Beat, DocBlock } from '@/domain/story/model';
import { allBeats, nextId, nextSceneKey } from '@/domain/story/model';
import type { AgentContext } from './context';
import { ctxAssets } from './context';

/**
 * 草稿生成。接真模型时换掉本文件，Plan/Proposal 契约不变。
 *
 * 大多数函数是从项目现状推导的（读场次、幕、资产、已有镜头），
 * **但 `draftAlts` 不是** —— 它只有三个固定句式，套上这一场的标题就完事。
 * 这条别在界面上说成「按这一场的功能算出来」：它一个上下文字段都没读。
 * 每个函数的实际依据在 `skills.ts` 的 `impl.note` 里逐条写着，
 * 改这里的逻辑时那边要跟着改。
 */

/* ---------------- 大纲 ---------------- */

const BEAT_SHAPES: readonly string[] = [
  '建立日常，埋下第一个异样',
  '异样被放大，主角开始怀疑',
  '第一次尝试解决，失败',
  '揭示真正的规则',
  '代价浮现，必须取舍',
  '告别与回声',
];

/** 一句灵感 → 三幕骨架。已有大纲时改为在最短的一幕里补一场 */
export function draftOutline(c: AgentContext): { acts: Act[]; added: Beat[] } {
  const idea = c.input.trim() || c.proj;
  if (!c.acts.length) {
    const titles = ['建立', '失衡', '回归'];
    const spans = ['0:00–1:20', '1:20–2:30', '2:30–3:40'];
    let n = 1;
    const acts: Act[] = titles.map((t, ai) => ({
      id: `a${ai + 1}`,
      t: `${t}：${idea.slice(0, 12)}`,
      span: spans[ai]!,
      beats: BEAT_SHAPES.slice(ai * 2, ai * 2 + 2).map((shape, bi) => ({
        id: `b${ai * 2 + bi + 1}`,
        k: `场景${n++}`,
        t: shape,
      })),
    }));
    return { acts, added: allBeats(acts) };
  }

  // 已有大纲：补在场次最少的那一幕，避免结构越加越偏
  const acts = c.acts.map((a) => ({ ...a, beats: [...a.beats] }));
  const target = acts.reduce((m, a) => (a.beats.length < m.beats.length ? a : m), acts[0]!);
  const shape = BEAT_SHAPES[target.beats.length % BEAT_SHAPES.length]!;
  const beat: Beat = {
    id: nextId('b', allBeats(acts)),
    k: nextSceneKey(acts),
    t: idea ? `${shape}（${idea.slice(0, 14)}）` : shape,
  };
  target.beats.push(beat);
  return { acts, added: [beat] };
}

/**
 * 一场 → 三条备选走向。
 *
 * **三个句式是写死的**，变的只有前面那半句（这一场的标题）。
 * 三条之间的差别是刻意挑的（谁不干预 / 谁在场 / 异样藏在哪），
 * 所以拿来当占位够用；但它不是「分析了这一场」的结果，
 * 界面上不要那么说。接模型见 skills.ts 里 outline.expand 的 note。
 */
export function draftAlts(beat: Beat): string[] {
  return [
    `${beat.t}，但主角这次不去干预，结果自己找上门`,
    `${beat.t}，换成旁人视角目击，主角事后才知道`,
    `${beat.t}，事情如常发生，异样藏在一个没人注意的细节里`,
  ];
}

/* ---------------- 剧本 ---------------- */

/** 一场 → 一个正文块。带场次标题、环境、动作、旁白的骨架 */
export function draftScriptBlock(c: AgentContext, beat: Beat, act: Act | undefined): DocBlock {
  const leads = ctxAssets(c).filter((a) => c.assets.角色.includes(a)).slice(0, 2);
  const place = c.assets.场景[0]?.name ?? '待定场景';
  const who = leads.map((a) => a.name.replace(/\s*\(.*\)/, '')).join(' 与 ') || '主角';
  const body = [
    `# ${act ? act.t : '未归幕'}`,
    '',
    `**${beat.k}**`,
    `${place} · 待定时间`,
    `${beat.t}。`,
    '',
    `${who} 进入这一场。动作先行，台词只留最必要的一句。`,
    `旁白："……"`,
    '',
    `> 待补：这一场结束时，观众应该多知道一件什么事？`,
  ].join('\n');
  return {
    id: nextId('bk', c.blocks),
    type: 'text',
    label: `正文 · ${beat.k}`,
    body,
  };
}

/**
 * 润色：把塞在一行里的多句话拆开，逐句成行。
 * 这是真的结构变换（不是换几个形容词），所以在界面上看得见差别。
 */
export function polishBody(body: string): string {
  return body
    .split('\n')
    .map((line) => {
      if (line.startsWith('#') || line.startsWith('>') || line.startsWith('**')) return line;
      const parts = line.split(/(?<=[。！？])/).map((x) => x.trim()).filter(Boolean);
      return parts.length > 1 ? parts.join('\n') : line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------------- 资产 ---------------- */

const TIME_WORDS = /^(黄昏|夜晚|清晨|午后|白天|深夜|傍晚|凌晨|正午|雨夜)$/;
const VIEWS_OF: Record<AssetGroup, readonly string[]> = {
  角色: ['正面', '侧面', '背面', '表情'],
  场景: ['全景', '氛围', '细节'],
  道具: ['整体', '细节'],
};

export interface AssetCandidate {
  readonly group: AssetGroup;
  readonly name: string;
  readonly from: string;
}

/**
 * 从剧本正文里找还没进资产库的角色与场景。
 * 场景来自「A · B · C」这类场景头行，角色来自「名字：台词」的说话人。
 */
export function extractCandidates(c: AgentContext): AssetCandidate[] {
  const known = ctxAssets(c).map((a) => a.name);
  const covered = (n: string) => known.some((k) => k.includes(n) || n.includes(k.replace(/\s*\(.*\)/, '')));
  const out: AssetCandidate[] = [];
  const seen = new Set<string>();
  const push = (group: AssetGroup, name: string, from: string) => {
    if (!name || name.length > 12 || covered(name) || seen.has(name)) return;
    seen.add(name);
    out.push({ group, name, from });
  };

  for (const b of c.blocks) {
    if (b.type !== 'text') continue;
    let scene = b.label;
    for (const raw of b.body.split('\n')) {
      const line = raw.trim();
      const sceneHead = /^\*\*(场景\d+)\*\*$/.exec(line);
      if (sceneHead) { scene = sceneHead[1]!; continue; }
      if (line.includes('·')) {
        for (const seg of line.split('·').map((x) => x.trim())) {
          if (!seg || TIME_WORDS.test(seg)) continue;
          push('场景', seg, scene);
        }
        continue;
      }
      const speaker = /^([^\s：:，。"]{2,8})[：:]/.exec(line);
      if (speaker && speaker[1] !== '旁白') push('角色', speaker[1]!, scene);
    }
  }
  return out;
}

/** 候选 → 可入库的资产（草稿态，需人工定稿后才能被分镜引用） */
export function candidateToAsset(cand: AssetCandidate, existing: readonly Asset[]): Asset {
  const prefix = AID_PREFIX[cand.group];
  const nums = existing
    .map((a) => new RegExp(`^${prefix}-(\\d+)$`).exec(a.aid))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return assetShell({
    group: cand.group,
    aid: `${prefix}-${String(n).padStart(3, '0')}`,
    name: cand.name,
    desc: `自剧本${cand.from}提取，待补描述`,
  }, `${cand.name} 的%s，出自${cand.from}`);
}

/**
 * 只有分组/aid/名字/描述的一份草稿 → 完整资产。
 *
 * `asset.write` 工具走这条：**aid 在 Rust 侧编**（它看得到全项目已用的号），
 * 形状照那一堆在这儿补 —— 资产的形状归前端 domain 管，在 Rust 那边照抄
 * 一份 rig 默认值迟早和这边对不上。
 */
export function assetShell(
  d: { group: AssetGroup; aid: string; name: string; desc: string; voice?: string },
  promptTpl = `${'%s'}`,
): Asset {
  const prefix = AID_PREFIX[d.group];
  const n = Number(/(\d+)$/.exec(d.aid)?.[1] ?? 1);
  const views: AssetView[] = VIEWS_OF[d.group].map((name) => ({
    name,
    style: '全局',
    gen: false,
    redo: 0,
    prompt: promptTpl.includes('%s')
      ? promptTpl.replace('%s', name)
      : `${d.name} 的${name}`,
    rig: defaultRig(name),
  }));
  return {
    id: `${prefix.toLowerCase()}${n}`,
    aid: d.aid,
    name: d.name,
    desc: d.desc,
    ...(d.voice ? { voice: d.voice } : {}),
    ver: 0,
    status: 'draft',
    views,
  };
}

/** 还没出图的形状照 */
export function ungeneratedViews(c: AgentContext): { assetId: string; assetName: string; viewName: string }[] {
  return ctxAssets(c).flatMap((a) =>
    a.views.filter((v) => !v.gen).map((v) => ({ assetId: a.id, assetName: a.name, viewName: v.name })));
}

/* ---------------- 分镜 ---------------- */

/** 一场拆几镜：按这场在大纲里的位置给个合理默认，末场收尾镜多一个 */
const SHOTS_PER_BEAT = 3;

/** 还没有任何镜头的场次 */
export const beatsWithoutShots = (c: AgentContext): Beat[] =>
  allBeats(c.acts).filter((b) => !c.shots.some((s) => s.sceneKey === b.k));

/**
 * 还没有正文的场次。正文块的标签里带着场次键（`正文 · 场景3`）。
 *
 * 「写剧本」原来只写选中的那一场，然后流水线就往下走了 —— 六场大纲跑完
 * 只有第一场有正文，剩下五场空着，而后面的资产提取、拆镜头全建在这 1/6 上。
 */
export const beatsWithoutScript = (c: AgentContext): Beat[] =>
  allBeats(c.acts).filter((b) => !c.blocks.some(
    (x) => x.type === 'text' && x.label.includes(b.k) && x.body.trim(),
  ));

/**
 * 大纲 → 分镜。每场一个「交代环境 → 看清动作 → 靠近情绪」的三镜结构，
 * 引用这场已有的场景资产。提示词留空 —— 由 shots.prompt 补，形成可见的流水线。
 */
export function draftShots(c: AgentContext, beats: readonly Beat[]): Shot[] {
  const sceneAid = c.assets.场景[0]?.aid;
  const leadAid = c.assets.角色[0]?.aid;
  const shapes: readonly { size: Shot['size']; desc: string; dur: number }[] = [
    { size: '全景', desc: '交代环境', dur: 4 },
    { size: '中景', desc: '看清动作', dur: 3 },
    { size: '近景', desc: '靠近情绪', dur: 3 },
  ];
  const out: Shot[] = [];
  const pool = [...c.shots];
  for (const b of beats) {
    for (let i = 0; i < SHOTS_PER_BEAT; i++) {
      const shape = shapes[i % shapes.length]!;
      const num = b.k.replace(/\D/g, '') || String(out.length + 1);
      let n = 1;
      let id = `s${num}-${n}`;
      while (pool.some((s) => s.id === id) || out.some((s) => s.id === id)) id = `s${num}-${++n}`;
      const s = makeShot(id, b.k);
      s.size = shape.size;
      s.desc = `${shape.desc} · ${b.t}`;
      s.dur = shape.dur;
      s.rig = defaultRig(shape.size);
      s.refs = [sceneAid, i > 0 ? leadAid : undefined].filter((x): x is string => !!x);
      s.refVer = Object.fromEntries(s.refs.map((aid) => [aid, 1]));
      out.push(s);
    }
  }
  return out;
}

/** 缺提示词的镜头 */
export const shotsMissingPrompt = (c: AgentContext): Shot[] => c.shots.filter((s) => !s.own.trim());

export const SIZE_EN: Record<string, string> = {
  大远景: 'extreme wide shot', 远景: 'wide shot', 全景: 'full shot',
  中景: 'medium shot', 中近景: 'medium close-up', 近景: 'close-up', 特写: 'extreme close-up',
};

/** 一镜 → 英文提示词。用这镜自己的景别、描述与引用资产，不是通用模板 */
export function draftShotPrompt(c: AgentContext, s: Shot): string {
  const refs = ctxAssets(c).filter((a) => s.refs.includes(a.aid));
  return [
    SIZE_EN[s.size] ?? 'medium shot',
    ...refs.map((a) => a.desc.replace(/，/g, ', ')),
    s.desc.split('·').pop()?.trim(),
    c.stylePrompt.split(',')[0]?.trim(),
  ].filter(Boolean).join(', ');
}
