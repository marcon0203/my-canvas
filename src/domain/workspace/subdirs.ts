/**
 * 工作空间下的子目录清单。
 *
 * # 为什么这份要和 Rust 对上
 *
 * Rust 侧 `doc/src/workspace.rs::SUBDIRS` 是**权威的那份** —— 它既给界面
 * 用，也决定 `ensure` 要建哪些目录。这里这一份只在浏览器里用（浏览器没有
 * 文件系统，桌面端拿到的是 Rust 回的真实结果）。
 *
 * 走查里发现的问题：加 `providers/` 时只改了 Rust 那份，`api/desktop.ts`
 * 里的兜底清单还是硬编码的 skills + projects。结果是用户在设置里
 * **看不到自己的 api key 存在哪个文件**。仓库 README 自己批评过这种
 * 「两个事实来源」，这儿就犯了一次。
 *
 * 现在：清单只写在这一个文件里，`subdirs.parity.test.ts` 对着 Rust 源码
 * 逐条核 —— 哪边改了另一边没跟上，测试就点名。
 */
export interface SubdirSpec {
  readonly name: string;
  readonly desc: string;
  /** 现在是否真的在用。不在用的也列出来，界面据此说明白「这里将来会有什么」 */
  readonly used: boolean;
}

export const SUBDIRS: readonly SubdirSpec[] = [
  { name: 'skills', desc: '用户自己放的 skill，与内置同名时盖过内置', used: true },
  { name: 'providers', desc: '供应商配置，一家一个 YAML —— api key 也在里面', used: true },
  { name: 'projects', desc: '项目数据', used: false },
];
