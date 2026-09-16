# 桌面端（Tauri + Rig）

```
src-tauri/
├ core/   纯 Rust，不依赖 tauri —— 无 GUI 环境也能编译和测试
└ app/    Tauri 壳：IPC 绑定 + 窗口，逻辑尽量为零
```

## 为什么拆两个 crate

Linux 上构建 Tauri 需要 `webkit2gtk-4.1` / `gdk-3.0`。拆开之后：

```bash
cd src-tauri/core && cargo test     # 任何环境都能跑，21 个测试
cd src-tauri && cargo check -p studio-app   # 需要 GUI 系统库
```

CI 与容器里核心逻辑照样有覆盖；将来要做 CLI 也能直接复用 `core`。

## 本地跑起来

```bash
# 一次性：系统依赖（Ubuntu/Debian）
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
# macOS / Windows 不需要额外装

npm i -D @tauri-apps/cli
npx tauri dev     # 起 vite + 桌面窗口
npx tauri build   # 出三平台产物
```

## 模块

| 模块 | 职责 |
|---|---|
| `config` | 与前端 `domain/agent/config.ts` 同形的契约。前端 JSON 直接反序列化，字段名用 camelCase 省掉映射层 |
| `error` | 统一错误 → `{ code, message }`。前端按 `code` 分支，`message` 只给人看 |
| `vault` | 系统钥匙串。`load()` 是 `pub(crate)` —— **没有任何 IPC 命令能读出明文** |
| `providers` | 端点解析：用户改过的优先，内置目录只是种子 |
| `agent` | 配置 → `AgentSpec` → Rig agent。解析是纯函数，配置错误在花钱之前就报出来 |
| `run` | 编排：`Run<I>` 带公共入参，每条链路只换输入与产物事件 |
| `skills` | Skill 加载：扫目录只读 frontmatter，正文与附件按需取 |
| `workspace` | 工作空间解析：`~/.hitv` 或用户指定的目录，用户数据的唯一落脚点 |
| `outline` | 起草大纲。`number()` 补场次键 |
| `shotprompt` | 补写提示词。`reconcile()` 核对镜号 |

## Rig 的实际形态（0.42）

调研时踩到的坑，记下来省得再查：

- **`rig-core` 里没有 `Agent`**。0.42 做了运行时拆分：`rig-core` 是契约（provider client、
  completion、tool），`rig-agent` 才是运行时，`rig` 是门面（默认 `agent` feature 合二为一）。
  所以依赖要写 `rig`，不是 `rig-core`。
- `AgentBuilder` 的真实链路是 `client.agent(model).name().preamble().temperature().tool().build()`，
  与 `docs/desktop-architecture.md` 里那张映射表一一对上。
- OpenAI 兼容客户端：`openai::Client::builder().api_key(k).base_url(u).build()`。
  国内六家的文本接口都走这条；图片/视频是各家自有的异步任务接口，不进 Rig，作为 tool 挂上去。

## 第一条链路：起草大纲

```
技能卡「从一句灵感起草大纲」
  └ api/agent.ts  isDesktop() ? IPC : 本地 mock
      └ agent_outline_draft（app/：只转发，不放逻辑）
          └ core::run::outline_draft   ← 编排在这里，能编能测
              ├ agent::resolve         配置 → AgentSpec（错了就在花钱前报）
              ├ vault_key              取密钥，不出这个函数
              ├ outline::draft         Rig Extractor 填 schema，失败自动重试
              └ RunEvent               step / delta / proposal / done / failed
  └ 产物卡 → 采纳 → applyAgentPatch（一条撤销记录）
```

两个刻意的设计：

**编排放 core 不放 tauri 层。** tauri 层在没有 GUI 系统库的机器上编译不了，
把编排写那儿等于这段代码永远没被类型检查过。现在 `app/src/lib.rs` 一百出头、6 个命令，
每个都只做转发；编排在 `core::run`，用假 Sink 和假 Keys 测。

**失败走事件，不走 Result。** 否则前端要同时处理「Promise reject」和「事件里的错误」
两条路径。常见失败在前端翻成人话：没配密钥就说去哪配，模型没按 schema 返回就直说。

**场次编号由 Rust 补，不让模型编。** 模型编 id 会重复、会跳号、会和已有的撞 ——
`outline::number` 是纯函数，三条测试盯着它（跨幕连续、接着已有编号、覆盖模型瞎写的）。

## 第二条链路：补写提示词

```
技能卡「为缺提示词的镜头补写」
  └ api/agent.ts  isDesktop() && 确实有镜头缺提示词 ? IPC : 本地 mock
      └ agent_shots_prompt
          └ core::run::shots_prompt    ← 与起草大纲共用 prepare / stream_reply
              ├ shotprompt::draft      Rig Extractor
              └ shotprompt::reconcile  核对镜号，纯函数
  └ RunEvent::Prompts → 产物卡 → 采纳 → shotPrompts 补丁
```

与第一条链路共用 `prepare`（解析 Agent + 取密钥）与 `stream_reply`，
`Run<'a, I>` 把输入参数化 —— 新链路只要给自己的输入类型和产物事件。

**Rust 不认识项目库。** 资产引用在前端展开成「名字：描述」再送过去，
Rust 侧只负责「把几段文字合成一条提示词，并且别把镜号写错」。

**镜号由 Rust 核对，不信模型。** `reconcile` 丢掉编出来的 id、去重、丢掉空提示词、
补上忘了带的画风，并把漏写的镜号报回来 —— 产物卡标题如实写 `2/5 镜`，
不假装全补上了。提示词写错了人一眼能看出来，**写到别的镜头上却是静默的错**，
所以这层兜底比大纲那层更要紧，七条测试盯着它。

## 工作空间

用户数据的**唯一**落脚点，默认 `~/.hitv`，可在设置里改到任意绝对路径：

```
~/.hitv/
├── skills/      用户自己放的 skill，与内置同名时盖过内置
└── projects/    项目数据（还没用上，所以 ensure 先不建）
```

**路径本身不存在工作空间里** —— 那是先有鸡还是先有蛋。它由前端持久化，
每次调用桌面端命令时传下来；`workspace::resolve` 只负责解析与校验，不碰存储。
这与 providers / globals 的处理方式一致：Rust 侧无状态。

换工作空间**只建不搬**：新目录建出来，旧目录里的东西既不移动也不删除。
替用户搬数据是在拿他的东西冒险，那件事该他自己决定。密钥不受影响 ——
它在系统钥匙串里，不在工作空间下。

## Skill 加载

一个 Skill 是磁盘上的一个目录，不是代码里的枚举：

```
skills/write-shot-prompts/
├── SKILL.md              frontmatter(name/description) + Markdown 指令
└── references/
    └── vocabulary.md     正文指到才读
```

**三级渐进披露**是这套东西的全部要点：

| 级别 | 内容 | 什么时候进上下文 |
|---|---|---|
| 1 | name + description | 始终常驻，装一百个也只多一小段 |
| 2 | SKILL.md 正文 | 这一轮真要用它时才读 |
| 3 | references / scripts / assets | 正文指到哪个读哪个；scripts 是拿来执行的，根本不进上下文 |

所以 `SkillStore::scan` **只解析 frontmatter**，正文留在磁盘上由 `body()` 按需取。
把它写成「一次性全读进来」就等于没做这件事。

扫描两处根目录，后面的盖前面的同名 skill：内置（打包进 resources）→
工作空间（`<workspace>/skills`）。用户放一个同名目录就能改掉内置行为。

`resource()` 按 canonicalize 之后的真实路径核前缀 —— skill 是用户往目录里放的东西，
一个 `../../../.ssh/id_rsa` 就能把无关文件读进上下文再发给模型。

现在只有起草大纲与补写提示词两条链路有 SKILL.md；其余十件内置能力还是写死在
前端 `plans.ts` 里的逻辑，界面上如实标着「还没有」。

## 还没做

- SQLite（项目、生成记录、成本流水）
- 生成队列（tokio + 持久化，关窗继续跑）
- 图片/视频厂商适配（Seedance / CogVideoX / 万相）
- 工具实现：`tools.ts` 里那 12 件现在只有契约，Rust 侧还没有对应实现
