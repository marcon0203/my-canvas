# 桌面端（Tauri + Rig）

```
src-tauri/
├ error/   统一错误类型
├ doc/     文档与落盘：Markdown / JSON / 项目目录 / 工作空间
├ conf/    配置与权限：Agent 配置、厂商端点、工具风险档
├ net/     出网：异步任务协议、读网页
├ skill/   Skill 加载
├ agent/   跑模型：装配 Rig agent 与各条链路
├ tools/   工具：注册表、闸门、调度、补丁
├ core/    门面：按原来的模块名再导出一遍 + 密钥保管
└ app/     Tauri 壳：IPC 绑定 + 窗口，逻辑尽量为零；只依赖 core
```

## 为什么按功能分包

**依赖是单向的，从上往下看那张图就是层次。** 一条方向错了的依赖在单 crate
里是看不见的（`crate::` 谁都能引），分开之后编译器会直接拒绝。分包过程中
就抓出两条这样的边：

- `md` 依赖 `skills` —— frontmatter 的切分被放进了 skills，而它是 Markdown 的写法
- `prompt` 依赖 `patch` —— 画风词表被放进了 patch，而它是提示词词表

两条都是「随手放在了第一个用到它的地方」，在单 crate 里永远不会报错。

另外两个实在的好处：改 `tools/` 不会让 `doc/` 重编；Linux 上构建 Tauri 需要
`webkit2gtk-4.1` / `gdk-3.0`，而下面这七包在没有 GUI 的环境里照样跑测试：

```bash
cd src-tauri && cargo test --workspace --exclude studio-app   # 任何环境都能跑
cd src-tauri && cargo check -p studio-app                     # 需要 GUI 系统库
```

**密钥那一点是刻意保住的。** 明文只有一个方向能走：用户刚打的那串经
`provfile::Patch` 进去。出来的那份（`provfile::View`）**结构里根本没有 apikey
字段**，有测试钉着 —— 所以「明文不过 IPC」不靠「记得别带出去」，靠的是那个
结构里没有那个字段。取明文的唯一出口是 `core::vault_key`，它只在「马上要发
请求」的地方调，调用点一眼可数；`check-app.sh` 另有一条 grep 守着
「IPC 层不许直接读那个文件」。

密钥存在 `<workspace>/providers/<id>.yaml` 里，**不在系统钥匙串**。
原来用的是钥匙串，代价是每次点进设置页都弹一次系统密码 ——
详细原因与取舍写在 `conf/src/provfile.rs` 开头。

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

## 包与模块

| 包 | 模块 | 职责 |
|---|---|---|
| `error` | `error` | 统一错误 → `{ code, message }`。前端按 `code` 分支，`message` 只给人看 |
| `doc` | `md` | 大纲与剧本的 Markdown 编解码，往返无损 |
| `doc` | `project` | 项目目录布局：project.json + outline.md + script/*.md + assets/shots.json |
| `doc` | `store` | 落盘：原子写、缺文件给默认值、配置分三个文件 |
| `doc` | `timeline` | 成片顺序与字幕 |
| `doc` | `workspace` | 工作空间解析：`~/.hitv` 或用户指定的目录，用户数据的唯一落脚点 |
| `conf` | `config` | 与前端 `domain/agent/config.ts` 同形的契约。前端 JSON 直接反序列化，字段名用 camelCase 省掉映射层 |
| `conf` | `policy` | 自主执行的权限边界（风险档 + 单个工具的审批覆盖），与前端 policy.ts 同一套规则；判定表由 `tools::gate_table` 落成 fixture 给前端逐行对 |
| `conf` | `providers` | 端点解析：用户改过的优先，内置目录只是种子 |
| `net` | `generate` | 异步任务协议：出图/出视频/配音都走这套 |
| `net` | `web` | 读网页：剥掉脚本样式、限长、如实标截断 |
| `skill` | `skills` | Skill 加载：扫目录只读 frontmatter，正文与附件按需取 |
| `agent` | `agent` | 配置 → `AgentSpec` → Rig agent。解析是纯函数，配置错误在花钱之前就报出来 |
| `agent` | `expand` | 延展一场的走向。`tidy()` 去重截断，一条不剩就报错 |
| `agent` | `structured` | 让模型填 schema：先工具调用，供应商不收就换提示词 + 自己解析。两条路都流式 |
| `agent` | `stream` | 从还没写完的 JSON 里把 `reply` 已经到手的那截刨出来 |
| `agent` | `outline` | 起草大纲。`number()` 补场次键 |
| `agent` | `prompt` | 提示词三段式合成与中译英 |
| `agent` | `run` | 编排：`Run<I>` 带公共入参，每条链路只换输入与产物事件 |
| `agent` | `shotprompt` | 补写提示词。`reconcile()` 核对镜号 |
| `tools` | `patch` | 写类工具的产物：一份补丁，不是一次写盘 |
| `tools` | `tools` | 工具注册表 + 调度 + 闸门 |
| `core` | （门面） | 取明文的唯一出口 `vault_key` —— **没有任何 IPC 命令能读出明文** |

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
          └ core::run::shots_prompt    ← 与起草大纲共用 prepare / deltas
              ├ shotprompt::draft      Rig Extractor
              └ shotprompt::reconcile  核对镜号，纯函数
  └ RunEvent::Prompts → 产物卡 → 采纳 → shotPrompts 补丁
```

与第一条链路共用 `prepare`（解析 Agent + 取密钥）与正文出口 `deltas`，
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
替用户搬数据是在拿他的东西冒险，那件事该他自己决定。密钥跟着工作空间 ——
它在 `<workspace>/providers/<id>.yaml` 里，跟着工作空间走 —— 拷过去就能用。

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
- **供应商配置一家一个 YAML**，在 `<workspace>/providers/<id>.yaml`：端点、
  api key、模型清单都在那一个文件里，权限 0600。人要拿编辑器直接改，
  所以是 YAML 不是 JSON（跟大纲剧本走 Markdown 同一个理由）。
  代价是明确的：工作空间放进网盘目录的话，key 跟着进网盘。

## Skill 加载

一个 Skill 是磁盘上的一个目录，不是代码里的枚举：

```
resources/skills/write-shot-prompts/
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

内置的那批在仓库根的 `resources/skills/`，跟着 `tauri.conf.json` 的 `resources`
打包进程序；旁边 `resources/models/providers.json` 是「支持哪几家供应商」，
`conf/providers.rs` 编译期 `include_str!` 读它，前端打包时读同一个文件。

扫描两处根目录，后面的盖前面的同名 skill：内置 → 工作空间（`<workspace>/skills`）。
用户放一个同名目录就能改掉内置行为。

**内置的不会在初始化时复制进工作空间。** 复制过去之后，升级带来的新版内置
Skill 会被那份旧副本盖掉，而界面上看不出是副本在生效；`Workspace::ensure`
也一直是「只建不搬」。要改内置的做法，用 `skill_fork` 命令复制一份出来 ——
那时候盖住内置是用户自己要的结果。

`resource()` 按 canonicalize 之后的真实路径核前缀 —— skill 是用户往目录里放的东西，
一个 `../../../.ssh/id_rsa` 就能把无关文件读进上下文再发给模型。

现在有三条链路接了真模型，各带一份 SKILL.md：

| 功能 | Rust 模块 | Skill |
|---|---|---|
| 起草大纲 | `agent/src/outline.rs` | `draft-outline` |
| 延展这一场的走向 | `agent/src/expand.rs` | `expand-scene` |
| 补写提示词 | `agent/src/shotprompt.rs` | `write-shot-prompts` |

其余九件内置能力还是前端 `plans.ts` 里的本地逻辑，界面上如实标着实现方式。
「哪几件接了模型」不是手写的清单 —— `skills.test.ts` 对着真实接线核：
`impl.module` 指的文件在不在、对应的 SKILL.md 在不在、`SKILL_FOR_INTENT`
与 `impl.by === 'model'` 两张表对不对得上。

**送什么进去比接上模型更要紧。** 延展走向这条尤其明显：它的上一版是三个固定
句式套上这一场的标题，如果接模型时只把标题送过去，模型给的三条和那份模板差别
不大 —— 所以前后各两场、所在幕、已定稿的角色都要送（见 `expand::prompt_of`
与前端 `expandInput`，两边都有测试盯着）。

## 结构化输出：为什么不能只用 Rig 的 Extractor

三条链路都要模型填一个有 schema 的结构。Rig 的 `Extractor` 是靠
「注册一个 submit 工具 + 强制 `tool_choice: required`」实现的（`extractor.rs` 里
那句 `ToolChoice::Required` 写死在构造函数里）。**好几家的思考模型不接受强制
tool_choice**，供应商直接回 400：

```text
Thinking mode does not support this tool_choice
```

国内几家的旗舰现在默认就是思考模型，所以这不是边角情况。两层应对：

**一、能用 rig 内置的那家就用它。** rig 已经替我们处理了一部分脾气：

| 供应商 | rig 模块 | 它做了什么 |
|---|---|---|
| DeepSeek | `providers::deepseek` | 思考模式下把强制 tool_choice 抹成 null |
| 月之暗面 | `providers::moonshot` | 降级成 `auto` 并补一句引导 |
| 火山方舟 / 阿里百炼 / 腾讯混元 / 自定义 | 无专属模块 | 走通用 chat/completions |

智谱那个 `providers::zai` 是 z.ai 国际站、也没做这类修正，用它没好处，走通用。

**二、通用那几家靠 `structured::extract` 兜底**：先试工具调用，拿到
「不支持这个 tool_choice」这类 400 就换成 `OutputMode::Prompted`
（schema 由 rig 注进提示词）+ 自己解析返回的 JSON。某个模型判定过一次之后
进程内记下来，后面同一个模型不再白挨那个 400。

解析必须自己做 —— rig 的文档明写这条路的文本「不保证是干净 JSON，可能带解释
或 markdown 围栏」。`json_of` 负责剥 ``` 围栏、剥 `<think>` 块、按括号配对取出
第一段完整对象（不是贪婪匹配到最后一个 `}`，那样 JSON 后面跟一句解释就会被吞进来）。

**三、两条路都是真流式。** 产物里那段给人看的话（`reply`）必须边生成边出来。
原来是等模型答完再把整段按两字一块发出去 —— 观感像流式，实际上用户先对着空
面板干等一整轮（思考模型能等半分钟），反馈原话是「没有流式输出吗？」。

现在两条路都走 `stream_prompt`，`stream::ReplyScan` 边收边从没写完的 JSON 里
把 `reply` 刨出来：工具那条它在输出工具的参数片段里，提示词那条就在模型正文里。
解不完的转义（`\` 后面还没来、`\uXXXX` 只来了两位、代理对只来了高位）就停下
等下一块 —— 宁可这一帧少吐几个字，也不能把半个码点拼成乱码。
这也给换路加了个前提：**已经吐过字就不能换路**，换一条路是从头再说一遍。

**推理过程单独一路（`RunEvent::Think`）。** 思考模型在开口之前会先想很久，
只流正文的话那半分钟界面上还是一个字都没有 —— 只解了一半。所以
`structured::Out` 有两个出口：`reply` 是产物里给人看的那段话，`think` 是
推理过程。**不能拌在一起**：推理是模型的草稿，不是它的回答，混进正文就等于
把草稿当答案。界面上摆成一块比正文轻一档的折叠区，还没出正文时展开、
正文一开口就收起来。

**输出工具的名字不是我们说了算。** `Extractor` 把它改成 `submit`，靠的是
`pub(crate)` 的 `AgentRunner::output_tool()`，外面用不了。所以照抄它那段「调
`submit`」的提示词就会出事：请求里登记的是 `final_result`，模型照提示词调
`submit`，rig 判成「调了一个不存在的工具」。现在让模型调哪个工具交给 rig 自己
那句（`OutputMode::Tool` 默认会补，名字由它填），我们只补一句「每个字段都要填」。
「提示词说的和登记的是同一个」留成了测试。

**接口家族也踩过**：`openai::Client` 在 rig 0.42 里是 Responses API
（`/responses`）的客户端，目录里这几家只提供 `/chat/completions`，
通用那条必须用 `CompletionsClient`。用错了的症状是响应解析报
「unknown variant `chat.completion`, expected `response`」—— 看着像供应商返回
格式不对，其实是我们问错了接口。`structured` 里有测试对着假供应商核这两件事。

## 还没做

- SQLite（项目、生成记录、成本流水）
- 生成队列（tokio + 持久化，关窗继续跑）
- 图片/视频/音乐厂商字段映射：协议测过了，那张表要拿真 key 对一次
- `audio.tts`：TTS 多数厂商同步返回音频字节，不是异步任务协议 —— 要先做
  「同步取字节 + 落进项目目录 + 时间线上的配音轨」那三件
- `web.search`：缺的不是代码，是「接哪家搜索服务」这个决定（设置里还没有这一项）
