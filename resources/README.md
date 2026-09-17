# resources —— 随程序发布的内置数据

程序自带、用户不用配就有的东西都在这儿。分两类：

```text
resources/
├── skills/     内置 Skill，一个目录一个，里面必须有 SKILL.md
└── models/     系统支持哪几家模型供应商（providers.json）
```

## 怎么被读到

| | 桌面端 | 浏览器 |
|---|---|---|
| skills | 打包进 app 的 resource 目录，Rust 扫它 | 构建期 `import.meta.glob` 把 SKILL.md 原文嵌进包 |
| models | `include_str!` 编译期嵌进 Rust | `import` JSON，打包时嵌进包 |

两边读的是**同一个文件**。以前 `providers.json` 的内容在 `catalog.ts` 和
`conf/src/providers.rs` 里各抄了一份，注释写着「改一边要改另一边」——
那种约定迟早失守，端点对不上时报的错还指不到原因。

## 内置 Skill 与工作空间的关系

内置的**不会**在初始化时复制进工作空间。扫描时是两个根目录：
先内置，再 `<工作空间>/skills/`，同名时用工作空间那份。

不复制的原因：复制过去之后，程序升级带来的新版内置 Skill 会被那份旧副本
盖掉，而界面上看不出来是副本在生效。要改内置的做法，在 Skill 管理里点
「复制一份到工作空间」—— 这时候复制是你自己要的，盖住内置也是你要的。

## 加一个内置 Skill

新建 `resources/skills/<名字>/SKILL.md`，开头用 YAML 写 `name` 和
`description`，下面写做法。附件放 `references/`、`scripts/`、`assets/`。
不用改代码，两边都会自动扫到。
