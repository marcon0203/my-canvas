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

## app crate 编不了时怎么办

app crate 依赖 GUI 系统库（webkit2gtk、gdk），在 CI 容器和没装桌面依赖的机器上
`cargo check` 跑不起来 —— 于是那一层的代码只能靠人眼看。这已经漏过一次
「文档注释写在函数参数上」，rustc 一眼能抓，人眼容易滑过去。

`check-app.sh` 用 rustc 单文件跑，只挑名字解析**之前**就报的错（语法、属性、
保留字、括号不配）。缺依赖导致的 `unresolved import` 是预期噪声，忽略。
已验证它能抓到那三类；也刻意**不**看 `cannot find attribute` —— 单文件下
serde 的 derive 本来就找不到，报假阳性一两次就没人看了。

**别拿 rustfmt 当这个用**：它能解析带参数文档注释的代码（exit 0），
拒绝发生在 rustc 后面一个阶段。

`npm run verify` 会连它一起跑。真正的类型检查仍然要在装了 GUI 依赖的机器上
`cargo check`。

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
| `store` | 落盘：原子写、缺文件给默认值、配置分三个文件 |
| `md` | 大纲与剧本的 Markdown 编解码，往返无损 |
| `generate` | 异步任务协议：出图/出视频/配音都走这套 |
| `tools` | 工具注册表 + 调度 + 闸门 |
| `policy` | 自主执行的权限边界，与前端 policy.ts 同一套规则 |
| `project` | 项目目录布局：project.json + outline.md + script/*.md + assets/shots.json |
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

## 出图出视频：异步任务协议

文本走 OpenAI 兼容的 `/chat/completions`，Rig 管；**图片视频音频不是** ——
各家都是「提交拿 task_id → 轮询 → 拿结果 URL」，Rig 不碰这层。

`generate.rs` 刻意分成两半：

| | 状态 |
|---|---|
| **协议机制**：提交、轮询、指数退避、超时、取消、错误分类 | 与厂商无关，纯函数 + 本地 mock server 真测过 |
| **厂商字段映射**：task_id 在响应哪个字段、status 有哪些取值 | 一张数据表，**没对过真实文档** |

这么分是因为：机制写错了很难发现（超时、重试风暴、取消泄漏），
字段写错了第一次调用就报错，一看就知道，改一行就好。

写这部分时这台机器出网被策略挡住（CONNECT 403），核不了各家文档。
所以 `image.generate` / `video.generate` 的状态是 **`Unverified`** 而不是
`Ready` 或 `Declared` —— 算 Ready 是撒谎，算 Declared 又低估了，
它离能用只差一次真实调用。接第一家时拿真 key 调一次，照报错改
`generate::adapters` 里那一两行。

几处刻意的设计：

- **轮询指数退避封顶 8 秒**。固定 1 秒的话，一个三分钟的视频任务要打接口
  一百八十次 —— 对方会限流，也是白烧配额。测试里断言 180 秒内少于 40 次。
- **不认识的状态当成还在跑**，不当失败。厂商加一个中间状态（`throttled`
  之类）不该让已提交的任务被判死，超时由总时限兜底。
- **说成功却没给 URL 算失败**，不返回空结果。
- **任务失败不重试**，网络抖动才重试 —— 重试一次还是失败，白花钱。
- **拿不到 task_id 立刻失败**，不带着空 id 去轮询：那会变成一个永远
  Running 的任务，把配额和时间都耗掉。
- **空提示词不拿去花钱**，batch 封顶 4 —— 别让一个笔误变成四十张图。

## 写类工具：单一写入者

Rust 不写项目文件，**写类工具返回一份补丁**。

为什么：前端 store 是界面的活数据，autosave 会把它写回盘。Rust 也写的话
就有两个写入者 —— Rust 刚写完，autosave 拿着 store 里的旧数据一覆盖，
改动就没了。这种丢更新很难查，因为两边看各自都「成功」了。

所以写入者只有前端那一个，Rust 做它真正擅长的**校验与编号**：

- `outline.write` 统一重编场次键，跨幕连续 —— 模型自己编会重复会跳号
- `shot.write` 分配不与已有撞车的镜号 —— 撞了会覆盖别人的镜头
- `asset.lock` 资产不存在直接报错 —— 否则分镜引上了，出图时才发现是空的

补丁走原来那条「产物 → 人采纳 → applyAgentPatch → 一条撤销记录」，
权限闸门、撤销、diff 全都不用另做一套。有测试断言写类工具调用后**盘上一个
字没动**。

## 浏览器侧工具

布光台是 WebGL，Rust 跑不了。这类工具 `dispatch` 返回 `elsewhere`，
由前端 `api/toolhost.ts` 接着执行。

**闸门仍然在 Rust 那侧先过** —— `elsewhere` 是过完闸门之后才可能出现的结果，
所以前端不再判一次权限。两处判同一件事，迟早有一处忘了改。

没注册时如实说干不了（布光台没打开过就渲不了图），不返回一个假结果。

## 自主执行的权限边界

「自主执行」= 不用人点采纳。省事，但也意味着没人看一眼。边界按
**「这一步的后果撤不撤得回」**划，不按「它改了多少东西」：

| 档 | 是什么 | 自主模式下 |
|---|---|---|
| read | 只读项目/记账 | 放行 |
| write | 改项目内容，进撤销历史 | 放行（出厂上限） |
| spend | 出图、出视频。撤销退不回积分 | 停下等人点头 |
| egress | 东西离开这台机器 | **永远**要人点头，上限调到最高也不行 |

判定按**产物的实际后果**，不按发起它的活儿：「补写提示词」归摄影指导管，
但产物只是改几行字；「批量转视频」采纳下去就开始烧积分。

**不按「有没有标消耗」判。** 这个应用几乎每轮都要花一两个积分（文字生成也算），
照那个判第一步就被挡住，边界成了摆设。想连一两个积分都先问一句的，
把上限调到「只读」—— 那是一个明确的选择，不是默认值把人拦死。

这一层**不是沙箱**，也不假装是。它挡的是自主模式下的越界动作；
真要跑陌生代码（skill 的 `scripts/`，现在还没实现）需要进程级隔离，是另一件事。
Rust 侧先把同一套规则建好并做了 parity 测试 —— 等工具真能动手时闸门已经在位，
而不是那时候再补。

## 为什么没有 SQLite

配置与项目都是工作空间里的文件：

```
<workspace>/
├── config/{providers,agents,app}.json     配置分三份，改一块不动另一块
└── projects/<id>/
    ├── project.json    元信息
    ├── outline.md      大纲 —— 人能直接改，存盘后应用照单全收
    ├── script/01-*.md  剧本，一场一个文件，diff 看得清
    ├── assets.json
    └── shots.json
```

数据规模是「一个人手上的几十个项目」，文件读起来够快，出问题时**能用编辑器
打开看**。数据库换来的并发与事务，单机单人用不上。

几处刻意的设计：

- **写文件先写临时文件再 rename**。直接覆盖写到一半断电会留下半截 JSON，
  下次启动就是「项目打不开」。
- **缺文件给默认值，坏文件报错**。第一次跑没有文件不是错误；但文件存在却坏了，
  拿默认值顶上会把用户数据悄悄覆盖掉。
- **大纲与剧本走 Markdown 而不是 JSON**，因为这两样人要直接读改。
  `parse(emit(x)) == x` 有测试盯着，手改过的 outline.md 也能解析回来。
- **id 不写进 Markdown**，按位置重新生成。写进去等于让人手改文件时还要维护
  一串没意义的编号；跨表引用靠的是场次键 `k`（`Shot.sceneKey` 对的就是它）。
- **剧本目录整块重建**。块被删掉时留着旧文件会让它下次又冒出来。
- **密钥不在工作空间**。它在系统钥匙串，整个目录复制走也带不走 ——
  用户会把这个目录放进网盘同步。

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
