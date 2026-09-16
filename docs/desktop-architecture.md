# 桌面客户端架构（Tauri + Rust）

> 调研结论与迁移路径。决策已定：**Tauri 2 单机档**。
> 本文只记「为什么这么选」和「怎么迁」，不重复官方文档。

## 一、选型

| 方案 | 结论 |
|---|---|
| **Tauri 2** ✅ | Rust 核心 + 系统 WebView。产物 3–5MB，冷启动快，内存占用远低于 Electron。现有 React 几乎不动 —— 换的是 `api/` 那层 transport。 |
| Electron | 每个产物捆一份 Chromium（100MB+）。唯一优势是浏览器行为完全一致；我们没有这个需求。 |
| 独立 axum 服务端 + 客户端 | 要用户体系、鉴权、部署、数据库运维。只有「多人协作 + 密钥统一管控 + 服务器跑 GPU」都是硬需求时才值得。当前不是。 |

**「C/S」在这里的含义**：前端（WebView）是 C，Rust core 是 S，中间走 Tauri IPC。
不是网络意义上的客户端/服务器 —— 没有服务器要运维，没有账号体系。

## 二、分层

```
┌──────────────────────────────────────────────┐
│  WebView：现有 React 工程，一行业务代码不改      │
│  routes / features / ui / three / domain      │
├──────────────────────────────────────────────┤
│  src/api/*  ← 唯一的改动面：mock → Tauri IPC    │
├═══════════════ Tauri IPC ════════════════════┤
│  Rust core (src-tauri/)                       │
│   ├ providers/  厂商适配：文本/图片/视频         │
│   ├ jobs/       生成队列：提交/轮询/取消/成本     │
│   ├ vault/      密钥：系统钥匙串，永不落盘明文    │
│   ├ store/      SQLite：项目、资产、生成记录      │
│   └ media/      产物文件：图片/视频/参考图         │
└──────────────────────────────────────────────┘
```

**依赖方向不变。** `domain/` 仍是纯逻辑、零 IO；它不知道自己跑在浏览器还是 WebView 里。
这也是为什么这次迁移代价可控 —— 几何换算、提示词合成、记账口径、Agent 计划，
全都不碰 transport。

## 三、关键决策

### 密钥不进前端
API Key 只存系统钥匙串（macOS Keychain / Windows Credential Manager / Linux Secret Service），
Rust 侧 `keyring` crate 读写。**前端永远拿不到明文**，只拿到「这家配没配」的布尔值
和脱敏尾号。请求由 Rust 发出，密钥不过 IPC。

这条决定了配置体系的形状：设置界面里填 key 是「写入钥匙串」，不是「存进 store」。

### 生成队列在 Rust
`api/generation.ts` 现在是 setTimeout 模拟。搬到 Rust 后：tokio 任务 + SQLite 持久化，
关掉窗口任务继续跑，重开能接上。生命周期语义（queued/running/done/cancelled）不变 ——
前端那套轮询代码原样能用。

### Agent 框架：文本循环用 Rig，视觉任务自己写

**这条结论改过一次，说明白为什么。**
最初判断是「不套框架」—— 前提是流程确定：拆镜就是「找没镜头的场次 → 每场三镜 → 挂引用」，
路径固定，套调度引擎是负担。
产品路线定为**自主规划**之后这个前提不成立了，结论跟着变：Agent 要自己决定先干什么、
调哪个工具、什么时候算做完，这正是框架存在的理由。

选 [Rig](https://rig.rs/)：
- 20+ 厂商统一接口 + 类型安全的工具定义 + 流式，Rust 原生
- 2026 年的基准里 CPU 占用最低（24.3%，LangChain 64%）
- 单二进制部署，与 Tauri 单机档一致

**loop 形态选 plan-and-execute，不选 ReAct。** 两者失败方式相反：ReAct 边想边做、
出错时已经改了东西；plan-and-execute 先出完整计划，可以在执行前拦住。
我们界面上那套「步骤卡 → 流式正文 → 产物卡（采纳/丢弃）」本来就是 plan-and-execute
加一道人工闸口 —— 这道闸口是产品承诺（Agent 不背着人改东西），不能为了框架让路。
每位 Agent 的**自主度**可配：`propose` 执行前交回人，`auto` 跑完整循环但在花钱或动定稿资产时停。

**每位 Agent 映射成一个 Rig agent**，四样东西来自已有的配置结构：

| 配置字段 | Rig 对应 | 决定什么 |
|---|---|---|
| `persona.preamble` / `cfg.preamble` | `.preamble()` | **怎么想** —— 先看什么、什么算做完、拿不准偏哪边 |
| `cfg.tools` | `.tool()` | 能动什么 |
| `cfg.models[modality]` | `.model()` | 用谁的脑子 |
| `cfg.skills` | 路由与转交 | 接不接这个活 |

侧重方向主要靠 `preamble` 拉开，不是靠多勾几个技能 —— 设置里这段可以整段改写。

**但视觉任务不进 Rig。**
火山 Seedance、智谱 CogVideoX、百炼万相都是各自的异步任务接口（提交拿 task_id 再轮询），
Rig 的抽象覆盖不到。这部分保持自己写的窄接口，由工具层调用：

```rust
#[async_trait]
trait Provider {
    async fn chat(&self, req: ChatRequest) -> Result<BoxStream<ChatDelta>>;
    async fn image(&self, req: ImageRequest) -> Result<JobHandle>;
    async fn video(&self, req: VideoRequest) -> Result<JobHandle>;
    fn caps(&self) -> ProviderCaps;
}
```

国内六家的文本接口都是 OpenAI 兼容，走 Rig 的 OpenAI 客户端改 baseURL 即可；
图片/视频按家写适配，包装成 Rig 的 tool 交给 agent 调用。
自定义端点同样复用 OpenAI 兼容路径。

### 本地存储
SQLite（`sqlx`）存项目树、资产、生成记录、成本流水。
媒体产物落文件，库里只存路径 —— 别把几百 MB 的图塞进数据库。
现有 `dexie` 依赖在迁移后移除。

## 四、迁移路径

| 阶段 | 内容 | 前端改动 |
|---|---|---|
| ~~0~~ | **配置体系**：厂商/模型注册表、每个 Agent 单独配 skill/模型/工具、设置界面 | 已完成（本轮） |
| 1 | Tauri 骨架：cargo 工程、IPC 命令、钥匙串、SQLite | `api/client.ts` 换 `invoke` |
| 2 | 厂商适配：文本先通，图片/视频按家接 | `api/generation.ts` 换 transport |
| 3 | Agent 接 Rig：每位一个 agent（preamble/tools/model 来自配置），`api/agent.ts` 的流式换成真 SSE | `domain/agent/` 的 Plan/Proposal 契约不动 |
| 4 | 打包与自更新：三平台产物、签名、增量更新 | 无 |

**阶段 0 的东西不会白做**：厂商注册表、Agent 配置、设置界面都在 `domain/` 和
`features/` 里，与 transport 无关。Rust 侧读的是同一份配置结构。

## 五、已知约束

- Linux 构建需要 `webkit2gtk-4.1`；本容器没装，Rust 侧代码可写不可跑。
- **模型 ID 和端点变得很快**。内置目录只是**种子**，baseURL 与模型清单在设置里都可改；
  不要把它当成权威清单（见 `domain/providers/catalog.ts` 的说明）。
- 百炼有 workspace 维度的端点（`{WorkspaceId}.cn-beijing.maas.aliyuncs.com`），
  内置的是公共兼容端点，企业版需自行改 baseURL。
- three.js 那块在 WebView 里跑 WebGL，与浏览器一致；Tauri 不提供额外加速。

## 六、参考

- [Tauri v2 文档](https://v2.tauri.app/)
- [火山方舟 快速开始](https://docs.volcengine.com/docs/82379/1928261)
- [阿里百炼 OpenAI 兼容](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)
- [腾讯混元 OpenAI 兼容](https://cloud.tencent.com/document/product/1729/111007)
