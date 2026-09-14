# AI 短视频工厂 · 前端设计文档

## 一、技术栈

| 类别 | 选型 | 一句话理由 |
|---|---|---|
| 构建 | Vite | 内部工具，无 SEO 需求，HMR 快 |
| 语言 | TypeScript（strict） | 领域模型复杂，角度/焦段/景别档需要类型区分 |
| 框架 | React | — |
| 路由 | React Router（data mode） | 选中态入 URL，可刷新可分享 |
| 状态 | Zustand + immer | 深层嵌套的项目树，样板少 |
| 撤销 | zundo | 产品无确认闸口，靠历史兜底 |
| 服务端状态 | TanStack Query | 生成任务的轮询、取消、去重 |
| 3D | React Three Fiber + drei + three | 场景由状态派生，不手动维护 |
| 样式 | Tailwind + CSS Variables | 复用现有 design tokens |
| 无样式原语 | Radix UI | 焦点管理与可访问性 |
| 富文本 | TipTap | 剧本块模型，输出结构化数据 |
| 校验 | Zod | API 出入参 + 参考图尺寸约束 |
| 本地存储 | Dexie | 缓存 GLB、生成图、草稿 |
| 测试 | Vitest + Testing Library + Playwright | 领域层高覆盖，UI 覆盖关键流程 |

不用：Next.js / SSR、Redux、GraphQL、i18n、组件库全家桶。

---

## 二、分层

```
┌─────────────────────────────────────────────┐
│  routes/          路由与页面装配              │
├─────────────────────────────────────────────┤
│  features/        业务环节（剧本/资产/分镜…）   │
├──────────────────────┬──────────────────────┤
│  ui/   设计系统原语     │  three/   3D 场景组件  │
├──────────────────────┴──────────────────────┤
│  domain/          纯逻辑（无 React/DOM/three）│
├─────────────────────────────────────────────┤
│  api/  store/  lib/  styles/                │
└─────────────────────────────────────────────┘
```

**依赖方向单向向下。** `domain/` 不 import 任何上层；`ui/` 不 import `features/`；`three/` 只依赖 `domain/` 和 `ui/`。

**domain/ 是共享语言。** 几何换算、提示词合成、引用与版本、记账口径各只有一份实现，`three/`、`features/`、`api/` 都从这里取。

---

## 三、目录结构

```
src/
├── domain/
│   ├── camera/
│   │   ├── geometry.ts      方位/俯仰/距离 ↔ 世界坐标；视高、轨道半径
│   │   ├── framing.ts       景别 ↔ 距离档；画幅 → 传感器 → 视场角
│   │   └── naming.ts        角度 → 界面名 / 画面朝向 / 英文提示词片段
│   ├── prompt/
│   │   ├── vocabulary.ts    镜头语言词表、色片、器材、镜头意图（纯数据）
│   │   └── compile.ts       画风 + 资产 + 镜头语言 + 本镜内容 → 片段数组
│   ├── assets/
│   │   ├── model.ts         资产、形状照、版本
│   │   └── locking.ts       定稿、升版、引用漂移
│   ├── shots/               镜头、场次归属、分镜表
│   ├── metrics/             命中率、按模型/景别归因、单条成本
│   └── types.ts             branded types（Degrees / Millimetres / DistStep）
│
├── ui/                      设计系统原语，见第四节
├── three/                   3D 组件，见第五节
├── features/
│   ├── script/              剧本编辑
│   ├── assets/              资产库与形状照
│   ├── stage/               布光台（机位 + 灯光）
│   ├── storyboard/          分镜表
│   ├── shotgen/             出图与判定
│   └── clips/               片段生成与交付
│
├── api/
│   ├── client.ts            fetch 封装、错误码映射
│   ├── schemas.ts           Zod schema
│   ├── generation.ts        生成任务队列：提交/轮询/取消/成本累计
│   └── queries.ts           TanStack Query hooks
│
├── store/
│   ├── project.ts           项目内容（进撤销历史）
│   ├── ui.ts                选中、弹窗、折叠（不进历史）
│   └── jobs.ts              任务与成本
│
├── lib/                     颜色、数学、id、格式化
├── routes/
└── styles/                  见第六节
```

---

## 四、组件清单

### 4.1 基础原语 `ui/`

| 组件 | 变体 / 要点 |
|---|---|
| `Button` | primary / secondary / ghost / danger；sm / md；loading、icon 前后置 |
| `IconButton` | 方形与圆形；tooltip 可选 |
| `Chip` | 静态标签。tone: neutral / accent / success / warning / error |
| `ToggleChip` | 可按下的 chip，`aria-pressed`。色片、镜头语言、画幅、运镜都用它 |
| `Segmented` | 分段控件。简单/专业、拖谁、透视/俯视/正面 |
| `Switch` | 轮廓光等开关 |
| `Slider` | 基础 + `gradient` 变体（色温轨道）；带值标签与刻度端点 |
| `Select` | 模型、时长、数量 |
| `Input` / `Textarea` | 提示词、描述、本镜内容 |
| `ColorSwatch` | 圆形色块，带发光；`ColorPicker` 为其 + 原生 input[type=color] |
| `Tooltip` | 悬停说明。镜头语言每项都要 |
| `Modal` | 标题 + 内容 + 底部操作；`wide` 变体给布光台 |
| `Popover` | 轻量浮层 |
| `Tabs` | — |
| `Collapse` | 折叠区，状态可受控（需持久化展开态） |
| `Tree` / `TreeItem` | 分组折叠、缩略图、计数、状态点。资产库与分镜列表共用 |
| `Panel` | 带标题栏的卡片容器 |
| `Table` | 分镜表基础 |
| `Toast` | — |
| `Meter` | 进度/比率条，tone 随阈值变 |
| `Thumbnail` | 图片瓦片，支持空态、角标、选中态 |
| `EmptyState` | 图标 + 文案 + 可选操作 |
| `Skeleton` | 生成中占位 |

### 4.2 业务组件（跨 feature 复用）

| 组件 | 职责 |
|---|---|
| `AssetTree` | 资产库树，分组 + 状态 + 已生成计数 |
| `ViewStrip` | 形状照切换条，缩略图 + 未生成标记 + 新增 |
| `PromptBox` | 提示词展示，按来源上色（画风/资产/镜头/内容/环境） |
| `PromptSegment` | 单个片段 chip，携带来源 tone |
| `StyleChips` | 画风选择 |
| `GelPalette` | 色片 9 色 + 自定义取色 |
| `GearWheel` | 器材滚筒（机身/镜头/焦段/光圈） |
| `EntryRow` | 入口行：标题 + 当前值摘要 + 箭头，点开弹窗 |
| `FramePreview` | 取景示意 SVG（无 WebGL 时的回退） |
| `RefChips` | 资产引用，带版本与未定稿告警 |
| `LockBadge` | 定稿状态 + 版本号 |
| `RunBar` | 模型 + 画幅 + 数量 + 预计消耗 + 运行 |
| `CostTag` | 消耗标签，本次 / 累计 |
| `TakeGrid` | 候选图网格，选中 + 出身信息 |
| `VerdictToggle` | 可用 / 重摇 |
| `ShotTable` / `ShotRow` | 六列分镜表与展开详情 |
| `MetricCard` / `AttributionBar` | 记账看板 |

### 4.3 3D 组件 `three/`

| 组件 | 职责 |
|---|---|
| `StageCanvas` | R3F 根，负责尺寸、像素比、阴影配置 |
| `WhiteModel` | GLB 加载、材质覆盖、底色切换、加载失败回退 |
| `StageLights` | 主光 / 轮廓光 / 环境光，颜色由 domain 计算 |
| `CameraGizmo` | 摄影机指示物 + 视锥 + 轨道环 |
| `LightGizmo` | 灯泡 + 辉光 + 光线 |
| `GroundPlane` | 地面、同心圈、方位标签 |
| `useShotCamera` | 把 `domain/camera` 的结果套到 three 相机 |
| `useOffscreenShot` | 离屏渲染出参考图（`useFBO` + readPixels） |
| `usePickDrag` | 射线拾取 + 拖拽，返回拖的是谁 |

---

## 五、样式与 Token

**开发第一步做这个，先于任何业务组件。**

### 三层 token

```
styles/
├── tokens.primitive.css   原始值：色板、尺度、字号、圆角、阴影、动效
├── tokens.semantic.css    语义：bg/text/border/status/data/accent
├── tokens.component.css   组件级：按钮高度、表头高度、侧栏宽度…
└── base.css               reset + 字体 + 全局
```

业务代码**只允许引用 semantic 和 component 层**，不直接写 primitive 值，更不写 hex。

### 语义 token 分组

| 组 | 用途 |
|---|---|
| `--color-bg-*` | canvas / surface / muted / hover / sidebar / overlay |
| `--color-text-*` | primary / secondary / tertiary / inverse / accent |
| `--color-border-*` | subtle / default / strong / focus / accent |
| `--color-accent-*` | 主色及其 soft / subtle / active |
| `--color-{success,warning,error}` | 各含 `-bg` 变体 |
| `--color-data-1..5` | 图表与提示词来源上色，各含 `-soft` |
| `--radius-*` | chip / control / tile / card / shell / full 五档 |
| `--space-*` | 4 的倍数刻度 |
| `--shadow-*` | card / raised / focus |
| `--duration-*` `--ease-*` | 动效 |

### 3D 场景也要用 token

原型里 3D 场景全是硬编码 hex，与界面主题脱节。做法：

```ts
// three/useSceneColors.ts
const css = getComputedStyle(document.documentElement);
const hex = (name: string) => new THREE.Color(css.getPropertyValue(name).trim());
```

场景色（地面、背景渐变、指示物、白模底色）全部从 CSS 变量读，主题切换时一并生效。

### Tailwind 映射

`tailwind.config.js` 里把 semantic token 映射成工具类，业务里写 `bg-surface`、`text-secondary`、`rounded-card`，不写 `bg-[#fff]`。

---

## 六、开发顺序

| 阶段 | 内容 | 产出 |
|---|---|---|
| 0 | 脚手架 + 三层 token + Tailwind 映射 | 能跑起来的空壳，颜色尺度统一 |
| 1 | `ui/` 原语全套 + Storybook | 组件目录页，可视验收 |
| 2 | `domain/` 迁移 + 单测 | 几何、提示词、引用、记账全部有测试 |
| 3 | `store/` + `api/` + 路由骨架 | 假数据能跑通导航 |
| 4 | `three/` 布光台 | 3D 场景与取景预览 |
| 5 | features 逐个接 | 资产 → 分镜 → 出图 → 片段 → 剧本 |

**阶段 1 和 2 可以并行**，两者互不依赖。阶段 0 必须先做完。

---

## 七、待确认

- 团队规模与 TypeScript 熟练度
- 后端接口契约（`api/schemas.ts` 现按 Seedance 参数推测）
- 是否需要暗色主题（token 已支持，但需确认是否投入调色）
