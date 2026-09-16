import { hitRate, totalTries, usableShots } from '@/domain/metrics/model';
import { STYLES } from '@/domain/prompt/vocabulary';
import { STYLEMAP } from '@/domain/prompt/vocabulary';
import { actOfBeat, allBeats } from '@/domain/story/model';
import type { AgentContext } from './context';
import { ctxAssets } from './context';
import {
  beatsWithoutShots, candidateToAsset, draftAlts, draftOutline, draftScriptBlock,
  draftShotPrompt, draftShots, extractCandidates, polishBody, shotsMissingPrompt, ungeneratedViews,
} from './drafts';
import type { IntentKind, Plan, PlanStep, PreviewRow, Proposal } from './types';

/**
 * 意图 → 计划。每个计划都是纯函数 (ctx) => Plan：
 * 步骤卡（界面上自己走完）、流式正文、以及一份待采纳的产物。
 * 前置条件不满足时返回 blocked —— Agent 说不行，而不是假装做了。
 */

const step = (icon: string, label: string, note?: string): PlanStep => ({ icon, label, note });

const blocked = (kind: IntentKind, why: string): Plan => ({ kind, steps: [], reply: why, blocked: why });

/* ---------------- 各意图 ---------------- */

function planOutlineDraft(c: AgentContext): Plan {
  const { acts, added } = draftOutline(c);
  const fresh = !c.acts.length;
  const rows: PreviewRow[] = added.map((b) => ({ k: b.k, v: b.t }));
  const proposal: Proposal = {
    title: fresh ? `新大纲 · ${acts.length} 幕 ${added.length} 场` : `补 ${added.length} 场`,
    rows, patch: { t: 'acts', acts }, cost: 2, goto: 'outline',
  };
  return {
    kind: 'outline.draft',
    steps: [
      step('spark', '读取灵感与现有结构'),
      step('map', fresh ? '搭三幕骨架' : '找结构最薄的一幕'),
      step('book', '落成场次'),
    ],
    reply: fresh
      ? `按三幕结构搭了个骨架，${acts.length} 幕共 ${added.length} 场。每一场先写它承担什么功能，具体内容留到正文再填 —— 结构定了再写字，改起来便宜。`
      : `你已经有 ${c.acts.length} 幕 ${allBeats(c.acts).length} 场了，我没有推翻重来，而是补在场次最少的那一幕：${added.map((b) => b.k).join('、')}。结构别越加越偏。`,
    proposal,
  };
}

function planOutlineExpand(c: AgentContext): Plan {
  const beat = allBeats(c.acts).find((b) => b.id === c.sel.beatId) ?? allBeats(c.acts)[0];
  if (!beat) return blocked('outline.expand', '大纲还是空的 —— 先让我起草一版，再来延展走向。');
  const alts = draftAlts(beat);
  return {
    kind: 'outline.expand',
    steps: [step('map', `分析「${beat.t}」的功能`), step('spark', '给出三条不同走向')],
    reply: `围绕${beat.k}给了三条走向。它们改的是**谁在场、谁知情**，不是换形容词 —— 这一层变了，后面的分镜和资产才会真的不一样。`,
    proposal: {
      title: `${beat.k} · 3 条备选走向`,
      rows: alts.map((v, i) => ({ k: `走向 ${i + 1}`, v })),
      patch: { t: 'alts', beatId: beat.id, alts },
      cost: 2, goto: 'outline',
    },
  };
}

function planScriptDraft(c: AgentContext): Plan {
  const beats = allBeats(c.acts);
  const beat = beats.find((b) => b.id === c.sel.beatId) ?? beats[0];
  if (!beat) return blocked('script.draft', '还没有大纲 —— 先起草大纲，我才知道这一场要写什么。');
  const block = draftScriptBlock(c, beat, actOfBeat(c.acts, beat.id));
  return {
    kind: 'script.draft',
    steps: [step('book', `读取${beat.k}的设定`), step('users', '接入已定稿的角色'), step('text', '写成正文块')],
    reply: `写了${beat.k}的正文骨架：环境、动作、一句最必要的台词。结尾留了一行「观众应该多知道什么」的待补 —— 这一行答不上来，这场就还不该拍。`,
    proposal: {
      title: `新正文块 · ${beat.k}`,
      rows: [{ k: '标签', v: block.label }, { k: '预览', v: block.body.split('\n').filter(Boolean).slice(0, 4).join(' / ') }],
      patch: { t: 'blocks', blocks: [block] },
      cost: 3, goto: 'script',
    },
  };
}

function planScriptPolish(c: AgentContext): Plan {
  const block = c.blocks.find((b) => b.id === c.sel.blockId)
    ?? [...c.blocks].reverse().find((b) => b.type === 'text');
  if (!block) return blocked('script.polish', '没有可润色的正文块 —— 先写一场出来。');
  const body = polishBody(block.body);
  if (body === block.body) {
    return blocked('script.polish', `「${block.label}」已经是一句一行了，再拆就碎了。想改别的，直接告诉我要什么感觉。`);
  }
  const before = block.body.split('\n').length;
  const after = body.split('\n').length;
  return {
    kind: 'script.polish',
    steps: [step('text', `读取「${block.label}」`), step('wand', '逐句拆行，留住停顿')],
    reply: `把塞在一行里的多句话拆成了逐句成行：${before} 行 → ${after} 行。分镜是按句子拆的，句子分开了，后面拆镜才不会把两个动作压进一个镜头。`,
    proposal: {
      title: `润色 · ${block.label}`,
      rows: [{ k: '行数', v: `${before} → ${after}` }, { k: '预览', v: body.split('\n').filter(Boolean).slice(0, 3).join(' / ') }],
      patch: { t: 'blockBody', id: block.id, body },
      cost: 2, goto: 'script',
    },
  };
}

function planAssetsExtract(c: AgentContext): Plan {
  const cands = extractCandidates(c);
  if (!cands.length) {
    return blocked('assets.extract', '剧本里出现过的角色和场景都已经在资产库里了。要我补形状照，还是先去定稿？');
  }
  const existing = ctxAssets(c);
  const add = cands.map((cand) => ({ group: cand.group, asset: candidateToAsset(cand, existing) }));
  return {
    kind: 'assets.extract',
    steps: [step('book', `扫描 ${c.blocks.length} 个文档块`), step('users', '比对资产库'), step('layers', `建 ${add.length} 个草稿资产`)],
    reply: `从剧本里找出 ${add.length} 个还没进库的：${add.map((x) => x.asset.name).join('、')}。都建成**草稿**态 —— 定稿之后才能被分镜引用，这条规矩我不绕过。`,
    proposal: {
      title: `新资产 · ${add.length} 个草稿`,
      rows: add.map((x) => ({ k: `${x.group} · ${x.asset.aid}`, v: `${x.asset.name} —— ${x.asset.desc}` })),
      patch: { t: 'assets', add },
      cost: 4, goto: 'assets',
    },
  };
}

function planAssetsViews(c: AgentContext): Plan {
  const miss = ungeneratedViews(c);
  if (!miss.length) return blocked('assets.views', '所有形状照都已经出过图了。');
  const gen = miss.map((m) => ({ assetId: m.assetId, viewName: m.viewName }));
  return {
    kind: 'assets.views',
    steps: [step('image', `清点 ${miss.length} 张未出图`), step('wand', '套用各自的镜头语言'), step('layers', '排进生成队列')],
    reply: `有 ${miss.length} 张形状照还没出图。每张都带着自己那套机位与布光参数（就是你在布光台上调的那份），我按各自的参数排队，不是一个提示词套所有。`,
    proposal: {
      title: `补齐形状照 · ${miss.length} 张`,
      rows: miss.slice(0, 8).map((m) => ({ k: m.assetName, v: m.viewName })),
      patch: { t: 'assetViews', gen },
      cost: miss.length * 2, goto: 'assets',
    },
  };
}

function planShotsGenerate(c: AgentContext): Plan {
  const beats = beatsWithoutShots(c);
  if (!beats.length) return blocked('shots.generate', '每一场都已经有镜头了。要我给缺提示词的镜头补写，还是批量转视频？');
  const shots = draftShots(c, beats);
  return {
    kind: 'shots.generate',
    steps: [
      step('map', `找出 ${beats.length} 个没镜头的场次`),
      step('layers', '每场按「环境 → 动作 → 情绪」拆三镜'),
      step('image', '挂上这场的资产引用'),
    ],
    reply: `给 ${beats.length} 场各拆了三镜：交代环境、看清动作、靠近情绪。提示词我故意**留空**了 —— 下一步用「补写提示词」按每镜自己的景别和引用去写，比现在瞎编一版再改要省。`,
    proposal: {
      title: `新分镜 · ${shots.length} 镜`,
      rows: beats.map((b) => ({ k: b.k, v: `${b.t} · 3 镜` })),
      patch: { t: 'shots', shots },
      cost: 3, goto: 'storyboard',
    },
  };
}

function planShotsPrompt(c: AgentContext): Plan {
  const miss = shotsMissingPrompt(c);
  if (!miss.length) return blocked('shots.prompt', '每一镜都有提示词了。要跑生成的话，去分镜页点运行，或者让我批量转视频。');
  const edits = miss.map((s) => ({ id: s.id, own: draftShotPrompt(c, s) }));
  return {
    kind: 'shots.prompt',
    steps: [step('text', `清点 ${miss.length} 镜缺提示词`), step('users', '展开引用资产的设定'), step('wand', '按各自景别合成')],
    reply: `给 ${miss.length} 镜补了提示词。每条都由这镜自己的景别 + 它引用的资产描述 + 画风合成 —— 所以你在提示词框里能看见每一段是**哪来的**，改哪段心里有数。`,
    proposal: {
      title: `补写提示词 · ${edits.length} 镜`,
      rows: edits.slice(0, 8).map((e) => ({ k: e.id, v: e.own })),
      patch: { t: 'shotPrompts', edits },
      cost: 2, goto: 'storyboard',
    },
  };
}

function planStyleTransfer(c: AgentContext): Plan {
  const asked = c.styles.find((s) => c.input.includes(s)) ?? STYLES.find((s) => c.input.includes(s));
  const pool = c.styles.length ? c.styles : STYLES;
  const next = asked ?? pool[(pool.indexOf(c.style) + 1) % pool.length]!;
  if (next === c.style) return blocked('style.transfer', `当前画风已经是「${c.style}」了。想换成别的，直接说名字。`);
  const prompt = [STYLEMAP[next] ?? next, 'film grain', c.ratio].filter(Boolean).join(', ');
  const off = ctxAssets(c).flatMap((a) => a.views).filter((v) => v.style !== '全局' && v.style !== next).length;
  return {
    kind: 'style.transfer',
    steps: [step('wand', `切到「${next}」`), step('layers', '重算全局画风提示词')],
    reply: `把项目画风换成「${next}」。注意：有 ${off} 张形状照是**节点级画风**（单独指定过），它们不跟全局走 —— 这是设计如此，想一起改就在资产页把它们设回「全局」。`,
    proposal: {
      title: `画风 · ${c.style} → ${next}`,
      rows: [{ k: '全局提示词', v: prompt }, { k: '不受影响', v: `${off} 张节点级画风的形状照` }],
      patch: { t: 'style', style: next, stylePrompt: prompt },
      cost: 1, goto: 'storyboard',
    },
  };
}

function planVideoBatch(c: AgentContext): Plan {
  const pending = c.shots.filter((s) => s.vid === 'none');
  if (!pending.length) return blocked('video.batch', '没有待转的镜头了 —— 都已经出过视频。');
  const cost = pending.length * 4;
  return {
    kind: 'video.batch',
    steps: [step('video', `排队 ${pending.length} 镜`), step('bolt', `预估消耗 ${cost} 积分`)],
    reply: `${pending.length} 镜待转，预估 ${cost} 积分（余额 ${c.credits}）。跑完仍然要你逐镜判定**可用/重摇** —— 不判定，命中率就算不出来，这片子花了多少冤枉钱也就说不清。`,
    proposal: {
      title: `批量转视频 · ${pending.length} 镜`,
      rows: [{ k: '待转', v: `${pending.length} 镜` }, { k: '预估', v: `${cost} 积分` }, { k: '余额', v: `${c.credits} 积分` }],
      patch: { t: 'run', action: 'video.batch' },
      cost: 0, goto: 'storyboard',
    },
  };
}

function planAutocut(c: AgentContext): Plan {
  const done = c.shots.filter((s) => s.vid === 'ok');
  if (!done.length) return blocked('edit.autocut', '还没有可用的视频片段 —— 先批量转视频，再判定可用。');
  const dur = done.reduce((n, s) => n + s.dur, 0);
  return {
    kind: 'edit.autocut',
    steps: [step('scissors', `取 ${done.length} 段可用素材`), step('bolt', '按场次顺序与时长配平')],
    reply: `按场次顺序排好了 ${done.length} 段，共 ${dur}s。判定为「重摇」的没进时间线 —— 成片只用可用素材，这也是命中率那个数字的意义所在。`,
    proposal: {
      title: `自动成片 · ${done.length} 段 / ${dur}s`,
      rows: done.slice(0, 8).map((s) => ({ k: s.id, v: `${s.desc} · ${s.dur}s` })),
      patch: { t: 'run', action: 'edit.autocut' },
      cost: 0, goto: 'editing',
    },
  };
}

function planCostReport(c: AgentContext): Plan {
  const spent = c.budget - c.credits;
  const hit = hitRate(c.shots);
  const tries = totalTries(c.shots);
  const usable = usableShots(c.shots);
  const perUsable = usable ? (spent / usable).toFixed(1) : '—';
  const worst = Object.entries(
    c.shots.reduce<Record<string, { t: number; o: number }>>((acc, s) => {
      if (!s.takes) return acc;
      acc[s.size] ??= { t: 0, o: 0 };
      acc[s.size]!.t += s.takes;
      if (s.verdict === 'ok') acc[s.size]!.o += 1;
      return acc;
    }, {}),
  ).sort((a, b) => (a[1].o / a[1].t) - (b[1].o / b[1].t))[0];
  return {
    kind: 'cost.report',
    steps: [step('bolt', '汇总生成次数与判定'), step('layers', '按景别归因')],
    reply: [
      `已消耗 **${spent}** 积分，余额 ${c.credits}。`,
      `累计生成 ${tries} 次，判定可用 ${usable} 镜 —— 命中率 **${hit}%**，折合每条可用镜头 ${perUsable} 积分。`,
      worst ? `最难拍的是**${worst[0]}**：${worst[1].t} 次生成只过了 ${worst[1].o} 条。这类镜头值得先在布光台把机位定死再跑，而不是多摇几次。` : '还没有足够的判定数据做归因 —— 先去分镜页逐镜判定可用/重摇。',
    ].join('\n'),
  };
}

function planChat(c: AgentContext): Plan {
  const shots = c.shots.length;
  const locked = ctxAssets(c).filter((a) => a.status === 'locked').length;
  return {
    kind: 'chat',
    steps: [],
    reply: [
      `我没把这句话对上具体的活儿，说说现在的进度：《${c.proj}》${c.acts.length} 幕 ${allBeats(c.acts).length} 场，${shots} 个镜头，${locked}/${ctxAssets(c).length} 个资产已定稿，余额 ${c.credits} 积分。`,
      '可以直接说「起草大纲」「拆镜」「补写提示词」「统一画风」「算一下成本」，或者点上面的技能卡。',
    ].join('\n'),
  };
}

const PLANNERS: Record<IntentKind, (c: AgentContext) => Plan> = {
  'outline.draft': planOutlineDraft,
  'outline.expand': planOutlineExpand,
  'script.draft': planScriptDraft,
  'script.polish': planScriptPolish,
  'assets.extract': planAssetsExtract,
  'assets.views': planAssetsViews,
  'shots.generate': planShotsGenerate,
  'shots.prompt': planShotsPrompt,
  'style.transfer': planStyleTransfer,
  'video.batch': planVideoBatch,
  'edit.autocut': planAutocut,
  'cost.report': planCostReport,
  chat: planChat,
};

export const plan = (kind: IntentKind, c: AgentContext): Plan => PLANNERS[kind](c);
