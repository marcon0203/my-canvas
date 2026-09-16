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

## Rig 的实际形态（0.42）

调研时踩到的坑，记下来省得再查：

- **`rig-core` 里没有 `Agent`**。0.42 做了运行时拆分：`rig-core` 是契约（provider client、
  completion、tool），`rig-agent` 才是运行时，`rig` 是门面（默认 `agent` feature 合二为一）。
  所以依赖要写 `rig`，不是 `rig-core`。
- `AgentBuilder` 的真实链路是 `client.agent(model).name().preamble().temperature().tool().build()`，
  与 `docs/desktop-architecture.md` 里那张映射表一一对上。
- OpenAI 兼容客户端：`openai::Client::builder().api_key(k).base_url(u).build()`。
  国内六家的文本接口都走这条；图片/视频是各家自有的异步任务接口，不进 Rig，作为 tool 挂上去。

## 还没做

- SQLite（项目、生成记录、成本流水）
- 生成队列（tokio + 持久化，关窗继续跑）
- 图片/视频厂商适配（Seedance / CogVideoX / 万相）
- 工具实现：`tools.ts` 里那 12 件现在只有契约，Rust 侧还没有对应实现
