# Agent Note: 运行时测试兼容终端颜色与路径别名

Status: implemented

## Problem

Windows 编写的运行时测试在 macOS 上暴露两种环境假设：子进程的数字和错误诊断被当作无颜色文本解析，临时目录的路径别名被当作不同目录。开启颜色时 PID 与端口解析失败，依赖错误中的换行颜色码破坏正则匹配；macOS 的 `/var` 与 `/private/var` 差异使已成功启动的测试误报失败。

## Decision

[备份测试](../../../../tests/integration/backup/backup.test.ts)与[端口测试](../../../../tests/integration/runtime/release-port.test.ts)的子进程使用 `stdout.write(String(number))` 传递数字，避免 `console.log(number)` 的终端格式化；备份样本在写入旧锁前检查 PID 有效性。[启动测试](../../../../tests/integration/runtime/dev-startup.test.ts)在匹配错误前移除 ANSI 控制码，并用真实路径作为目录断言的期望值。保留旧锁证据与数据、启动中止和端口重新绑定的原有行为断言。

## Alternatives considered

统一关闭测试颜色可以掩盖三处失败，但仍使测试依赖外部环境，且不能解决路径别名，因此直接修正数据传递和比较方式。不放宽为只检查启动命令失败，因为需要保留缺失依赖的诊断证据。

## Consequences

回归需覆盖开启与关闭颜色的环境。macOS 上的运行不能代替 Windows 验收；本次不修改产品实现或 DSH 运行时。

2026-09-12 在 macOS arm64、Node 24.18.0 上，`FORCE_COLOR=1 pnpm test` 完成类型检查、构建和 Profile 准备，Node 用例 210 个通过、3 个平台用例跳过，Python 用例 19 个通过；关闭颜色后，三个受影响测试文件的 21 个用例通过、1 个 Windows 用例跳过。格式与文档检查通过，Windows 本次未执行。
