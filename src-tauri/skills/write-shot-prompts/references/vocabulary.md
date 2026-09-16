# 提示词词表（按需读，不必一上来就全看）

## 景别对照

| 中文 | 英文术语 |
|---|---|
| 大远景 | extreme wide shot |
| 远景 | wide shot |
| 全景 | full shot |
| 中景 | medium shot |
| 中近景 | medium close-up |
| 近景 | close-up |
| 特写 | extreme close-up |

这张表与前端 `domain/agent/drafts.ts` 的 `SIZE_EN` 一致。输入里已经给了每一镜
的 `sizeEn`，直接用那个，这张表只是让你知道它从哪儿来。

## 成段的例子

**输入**

```
s3-1 | 景别 特写（extreme close-up）| 内容：年糕呼吸急促，艾米慌张
     | 引用：年糕：橘白花纹的短毛猫，左耳有缺口；艾米：11 岁小女孩，米色针织衫，齐肩短发
```

**输出**

```
extreme close-up, orange and white short-haired cat with a notched left ear,
labored breathing, 11-year-old girl in beige knit sweater looking anxious,
film grain
```

注意：`呼吸急促` 变成了 `labored breathing`（看得见），`慌张` 变成了
`looking anxious`（脸上的表情，看得见），而不是 `worried about her cat`。

## 常见的写坏

| 写法 | 问题 |
|---|---|
| `a sad scene` | 模型画不出「悲伤的场景」，画得出低垂的头和雨 |
| `cinematic, 8k, masterpiece` | 凑字数的套话，对国内模型基本没用，还挤掉有效描述 |
| `the cat from before` | 模型没有「之前」，每条提示词都是独立的 |
| 中英混写 | 分词会乱，要么全英文要么全中文 |
