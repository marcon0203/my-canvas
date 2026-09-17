#!/usr/bin/env bash
# app crate 的语法 / 属性检查。
#
# 为什么要这个：app crate 依赖 GUI 系统库（webkit2gtk、gdk），
# 在 CI 容器和没装桌面依赖的机器上 `cargo check` 跑不起来。
# 于是那一层的代码只能靠人眼看 —— 结果就漏过「文档注释写在函数参数上」
# 这类 rustc 一眼能抓、人眼容易滑过去的错。
#
# rustc 单文件跑会因为缺依赖报一堆「unresolved import」，那些是预期的噪声；
# 但语法错、属性用错这类在名字解析之前就报了，照样捞得出来。
# 所以这里只挑那几类错误看，其余忽略。
#
# 注意 rustfmt 抓不到这个 —— 它能解析带参数文档注释的代码，
# 拒绝发生在 rustc 后面一个阶段。别拿 rustfmt 当这个用。
set -uo pipefail
cd "$(dirname "$0")"

# 只看这些：在名字解析之前就报的错，与缺依赖无关。
#
# 刻意**不**包含 `cannot find attribute` —— 单文件模式下 derive 宏（serde 之类）
# 本来就找不到，那是预期噪声，不是代码错误。守卫报假阳性一两次就没人看了。
PATTERNS='documentation comments cannot|only allowed built-in attributes|expected .*, found|unclosed delimiter|mismatched closing delimiter|reserved keyword|malformed .* attribute|expected identifier'

fail=0
for f in $(find app/src -name '*.rs'); do
  out=$(rustc --edition 2024 --crate-type lib --emit=metadata -o /dev/null "$f" 2>&1 \
        | grep -E "^error" | grep -E "$PATTERNS" || true)
  if [ -n "$out" ]; then
    echo "❌ $f"
    echo "$out" | sed 's/^/   /'
    fail=1
  fi
done

if [ $fail -eq 0 ]; then
  echo "✅ app crate 语法与属性检查通过（真正的类型检查要在装了 GUI 依赖的机器上 cargo check）"
fi
exit $fail
