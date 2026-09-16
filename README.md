# AI 短视频工厂 · 前端

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # 领域层单测 + 页面渲染烟雾测试
npm run build      # 类型检查 + 生产构建
npm run verify     # token 分层自检（需先 build）
```

## 样式策略（重要）

组件视觉以冻结原型为准，分两层落地：

- `src/styles/prototype.css` —— 原型整份样式表作为**组件样式层**移植进工程
  （`.seg/.pill/.tbtn/.expl/.blk/.apv/.mo/.stagegrid/.tl/.cv/.mstat…`），
  颜色与尺寸全部走语义别名 token（`--color-bg-*`、`--color-text-*`、`--color-border-*`），
  文件头只补了原型使用而 token 层未定义的刻度（`--space-*`、`--radius-full`）。
- React 组件（`ui/`、`components/`、`features/`）的模板引用这套 class 契约 ——
  **组件化架构不变，搬的是样式规格，不是原型元素**。
  Tailwind 工具类与 `ui/` 原语保留，用于原型没有的新组件（如 TakeGrid 的 `.takes`）。

## 进度

- **阶段 0**（已完成）：Vite + React + TypeScript(strict) 脚手架，三层 design token，
  Tailwind v4 CSS-first 配置，Token 验收页 `/tokens`，3D 取色桥。
- **阶段 1 · ui 原语全套**（已完成）：`src/ui/` 按 frontend-design.md §4.1 全套实现，
  一个组件一个文件（Button/IconButton/Chip/ToggleChip/Segmented/Switch/Slider/Select/
  Input/ColorSwatch/Tooltip/Modal/Popover/Tabs/Collapse/Tree/Panel/Table/Toast/Meter/
  Thumbnail/EmptyState/Skeleton/Icon）。
- **阶段 2 · domain 层**（已完成）：`src/domain/` — camera/geometry+naming+framing、
  prompt/vocabulary+compile+apply、assets/model+locking、shots、metrics，
  27 个单测覆盖几何换算、提示词合成、引用与版本、记账口径。
- **阶段 3 · store + api + 路由**（已完成）：zustand + immer + zundo（内容变更可撤销），
  TanStack Query 接生成任务队列（`api/generation.ts` 本地模拟同一套生命周期），
  路由 `/project/:step` —— 选中环节入 URL，可刷新可分享。
- **阶段 4 · three/ 布光台**（已完成）：R3F 舞台俯瞰（拖拽机位/灯）+ 摄影机取景双画布，
  白模 `/Xbot.glb`（动画采样姿态 + 三档底色），取景可离屏渲 720×1280 参考图。
- **阶段 5 · features**（已完成）：剧情大纲 / 剧本 / 资产 / 分镜 / 剪辑 / 总览画布 / 数据看板，
  外加首页。原型《The Dream of Cats》数据完整移植于 `store/seed.ts`。
- **阶段 6 · Agent 班底驱动全流程**（已完成）：一个环节一位 Agent，各有专长，
  接不了的活儿会转交 —— 见下节。
- **阶段 7 · 配置体系**（已完成）：厂商/模型注册表（火山、DeepSeek、智谱、百炼、
  混元、月之暗面 + 自定义 OpenAI 兼容端点），每个 Agent 单独配**侧重方向（系统提示词）**、
  自主度、skill、模型、工具。设置是**应用级**的（`/settings`），跨项目共用 ——
  项目详情里不出现任何模型与配置。
  桌面端（Tauri + Rust + Rig）架构见 `docs/desktop-architecture.md`。

## Agent 班底：一个环节一位，各有专长

侧栏 Agent 是产品主入口，不是装饰。一轮应答 = **步骤卡**（自己走完）→ **流式正文** →
**产物卡**（采纳 / 丢弃）。产物只有点了「采纳」才写进项目，并记一条撤销 ——
Agent 不背着人改东西。

| Agent | 主场 | 专长（`owns`） |
|---|---|---|
| **编剧** Writer | 大纲 / 剧本 | 起草大纲、延展走向、写正文、润色 |
| **美术** Art Director | 资产 | 提取角色场景、补齐形状照、统一画风 |
| **摄影指导** DP | 分镜 | 拆镜、写提示词、批量转视频（**布光台是它的地盘**） |
| **剪辑** Editor | 剪辑 | 按节拍自动成片 |
| **制片** Producer | 看板 / 总览 | 成本与命中率报告 |

**「专长」不是文案，是 `owns`** —— 这位 Agent 能接哪些 `IntentKind`。
每件活儿恰好一位认领（有测试兜底：没有孤儿，也没有两人抢）。
技能卡直接由 `owns` 派生，所以卡片和能力不会走偏。

**问错人不会卡住，会转交。** 在编剧那儿说「批量转视频」，编剧会说一句
「这不是我的活儿，摄影指导更懂」，然后转交 —— 界面跳到分镜、当班换成摄影指导、
由它重跑同一句输入并交付产物。转交前后的消息留在同一条会话里，
用户那句话只冒一次泡。

**每位的专长可以改。** `roster` 里的 `owns` 只是出厂默认，运行时以设置里的配置为准：
把「批量转视频」从摄影指导挪给制片，转交会跟着走；勾掉某件工具，对应技能立刻接不了
（界面上那个 ⚠ 是真的）。停用某位 Agent，它的活儿就没人接 —— Agent 会明说，
而不是假装转交给一个不接的人。

```
domain/providers/ 厂商与模型目录（种子，端点与模型清单都可在设置里改）
domain/agent/   纯逻辑：roster 班底与分工 / config 每位的配置与校验 / tools 工具注册表 /
                router 自由文本路由 / drafts 草稿生成 / plans 计划装配
api/agent.ts    传输层：本地模拟流式应答（plan → step → delta → proposal → done），可中断；
                当班接不了时改发 handoff
store/agent.ts  会话态：消息、当班 Agent、流式进度、采纳落库、转交接力（不进撤销历史）
```

**产物全部由项目现状推导，不是写死的文案。** 「按大纲拆镜」只补没有镜头的场次；
「补齐形状照」只挑 `gen: false` 的那几张；「提取资产」扫的是剧本正文里出现过、
资产库里还没有的名字；成本报告用的是 `domain/metrics` 的真实记账口径。
前置条件不满足时 Agent 明说做不了（`Plan.blocked`），不产出假产物。

**意图路由的规则是「动词决定意图，主题词只加权」**——「按大纲拆镜」要落到分镜而不是大纲，
「润色一下这段台词」要落到润色而不是写正文。接真 LLM 时 `router.ts` 换成一次
function-calling，下游 `IntentKind` 契约不变。

**产物与 3D 布光台同源，摄影指导是它的代言人。** 补形状照时每张带的是它自己那套
机位与布光参数（就是在布光台上拖出来的那份 `Rig`），不是一个提示词套所有；
补写提示词时每条由该镜的景别 + 引用资产描述 + 画风合成，所以提示词框里能看见
每段是哪来的。

流式节奏在测试环境下自动压扁（`api/agent.ts` 的 `FAST`），跑的是同一条代码路径。


## 原型修复对照

以冻结原型 `../asset-locking-studio.html` 为规格开发，并在 React 版中修掉原型的已知问题：

| 原型问题 | React 版处理 |
|---|---|
| 姿态只有「站立」一档，UI 却引用九种 | `three/usePose.ts` 补全九档（clip 采样 + 骨骼微调），`PosePanel` 提供选择 |
| 布光台里点「文字/图片/两者」弹窗被换成旧机位弹窗 | 弹窗状态统一在 `ui store.modal`，StageModal 自持姿态切换 |
| 专业模式「添加维度」无入口 | `ProDims` 提供「添加维度」，StageModal 也有快捷入口 |
| 候选图网格（TakeGrid）缺失 | `components/TakeGrid`：按 ×N 生成候选，点选换关键帧 |
| 若干死按钮（导入/导出/转场等） | 导出剧本真下载 .md、导入真读文件，其余明确 toast 占位语义 |
| Agent 侧栏只回一句固定话术 | `domain/agent` + `api/agent` + `store/agent`，流式应答且真写项目 |
| 所有环节共用一个万能 Agent | 五位各有专长（`roster.ts`），接不了的活儿转交给对的那位 |
| 形状照挤在右侧检查器的切换条里 | 形状照长在它所属的资产下（`TreeBranch`/`TreeLeaf`），树里就是层级本身 |
| 画风单独占一整行 | 降为提示词的参数，挂在输入框底部参数条上 |
| 提示词只读，生成按钮在别处 | `PromptComposer` 可直接改，自带运行；手改即脱管，可一键交回自动 |
| 「解析剧本」报写死的「2 角色 4 场景 3 道具」 | 改走 Agent 真扫剧本，报的是实际找到的 |

## Token 分层纪律

```
tokens.primitive.css   原始值（调色板、尺度）——业务代码禁止引用
tokens.semantic.css    语义层 + @theme 生成 Tailwind 工具类
tokens.component.css   结构尺寸（侧栏宽、表头高、舞台边长…）
base.css               reset + 全局基线
```

`npm run verify` 会检查：语义层不得出现裸 hex、组件层不得出现颜色、
原始层不得反向依赖语义层、深色必须覆盖关键 token。**这些规则进 CI。**

## 已知约束

- `@react-three/fiber` 当前要求 `react >=19 <19.3`，React 固定在 `~19.2`。
  升级 React 前先确认 R3F 的 peer 范围。
- 深色模式是推导值，落地前需单独跑 WCAG 对比度检查。
- 生产构建单 chunk 偏大（three.js），接入真实路由懒加载时可按 route code-split。
- `api/generation.ts` 与 `api/agent.ts` 都是本地模拟，接后端时只换 transport，生命周期语义不变。
- Agent 的"理解"是关键词路由，不是语言模型：没覆盖到的说法会落到 chat 兜底。
