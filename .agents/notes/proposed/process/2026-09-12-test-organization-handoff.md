# Agent Note: 测试体系整改的 macOS 接续验收

Status: proposed

## Problem

这是 2026-09-12 Windows 工作区的阶段性交接。用户已批准完整的测试体系与 verify 整改，随后要求先提交当前工作，转到 Mac 继续。目录、用例、调度器与规则已迁移，但整体验收尚未完成；不要把本次提交视为全部平台通过，也不要重新开始目录方案讨论。

## Proposal

继续执行已确认的集中式 tests、分阶段完整整改。目录规范以 [tests/AGENTS.md](../../../../tests/AGENTS.md) 为唯一来源，命令语义见 [开发文档](../../../../docs/development.md)，已落地的取舍见 [测试组织决策](../../implemented/process/2026-09-12-test-organization.md)和[阶段结果证据决策](../../implemented/process/2026-09-12-verification-outcomes.md)。当前任务是修复剩余阻塞并补齐平台证据，不更换测试框架。

### 已完成的工作

- 原 contract 按行为拆入 unit 或 integration；desktop、sync-server 降为子系统；独立挂载的浏览器组件归 component，完整流程归 e2e，安装与平台交付归 distribution。混合范围的笔记、项目、桌面策略和启动命令文件已拆开。
- verify 收紧为工程检查和薄命令入口。启动、安装、认证准备与清理放入 helpers/runtime；产品断言留在测试与场景中。启动运行时不会隐式验收笔记、任务或认证。
- 笔记拆为生命周期、历史、并发、同步、设置，任务拆为日历与完成状态；每项场景准备自己的记录。源码、安装、Windows、桌面显式复用同一组场景，保留实际服务端自动保存、独立读取、同步接收方、备份恢复和端口重绑定证据。
- 安装探针从目标 Profile 解析被测模块，桌面原生探针由随包运行时执行。Safe UI 补齐真实 workspace 前置条件，并检查输入内容和 Nook 入口缺席。
- 新调度器递归发现 Node/tsx 与 Python 用例，排除 helpers/fixtures，支持环境选择和独立匹配。普通测试不启动 Docker 或桌面打包；缺少显式环境的前置条件会失败。重复执行组去重，verify 构建一次且 Profile 不重复执行。
- Python 统一入口供本地与 CI 使用；只转调 Python 的 Node 包装已删除，跨语言集成保留。同步服务 CI 的系统与架构矩阵保留并更新路径。
- 根、verify、tests 规则，DSH 开发和升级技能、迁移案例、开发文档及证据链接已同步。文档标准、笔记格式规范和 commit 技能未修改。

本次提交包含整改开始前已有的工作区修改，不能当作迁移的意外改动回退：尤其是 storage-backup 的系统文件锁、fs-ext 依赖、桌面监督进程继承 POSIX 锁描述符，以及相应备份文档和验收断言。其 macOS 原生依赖与孤儿 Host 持锁行为仍需实际验证。

### 可带到 Mac 的迁移基线

[迁移映射](2026-09-12-test-organization-migration.json)保存实施前工作区的 76 个原文件、95 条迁移关系、原测试标题及执行环境；基线包含当时未提交的修改。它是覆盖审计证据，不是调度器白名单；自动执行仍只依赖目录发现。接续时检查每项原结果及环境组合，不以文件数量或源码通过代替覆盖等价性。

完整原文件快照和原始日志在 Windows 的 `.pack/test-refactor/`，该目录被 Git 忽略，不会随提交同步。无需复制构建产物、node_modules、真实数据或临时认证材料；下文保存了跨机器接续所需的结论。

### 已执行的验证

环境为 Windows、Node 22.20、pnpm 12.1.0，另使用已有 WSL Ubuntu/Python 3.12.3 执行纯 Python POSIX 用例。

| 检查                          | 本次证据与限制                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查与构建                | 通过；测试调度器完成根构建                                                                                                       |
| unit                          | 15 文件，54/54 通过                                                                                                              |
| component                     | 2 文件，4/4 通过                                                                                                                 |
| integration                   | 首轮 38 文件、150 项：148 通过、2 项平台跳过；后续新增运行时清理测试通过，调度器与运行时辅助的 3 项专项测试全部通过              |
| 源码 e2e                      | 首轮 17 项中 16 通过；修复 Windows dev-modes 的 IPC、路径过滤与清理后，该项独立重跑通过。尚无一次整体全绿的聚合运行              |
| 干净安装                      | 50 个 Nook 包安装及 7 个子场景通过，合计 8 项 Node 测试；同组 update-worktree 失败，因此 verify:package 整体仍失败               |
| verify:windows                | 通过，父用例加 5 个子用例，共 6 项；含启动、笔记、同步、共享后端、重启持久化、备份恢复与释放端口                                 |
| POSIX Python                  | WSL 运行 assistant 14 项、setup 5 项，共 19 项通过；WSL 无 Node，未执行 POSIX 跨语言 installer 用例                              |
| 工程检查                      | docs:check、依赖边界、CSS、UI 色值、peer 检查各自通过；变更文件格式检查和 git diff --check 通过；两个更新的 DSH 技能结构校验通过 |
| pnpm verify                   | 未通过：停在全仓格式门禁，原因见下文；不能根据分别执行的检查宣称该命令成功                                                       |
| macOS、Docker、Linux 系统验收 | 未执行；显式桌面入口在 Windows 正确失败；Docker daemon 不在线，Docker 入口因缺失前置条件失败                                     |

integration 跳过的是 POSIX Host 锁描述符继承与独立 Apache mod_dav 参考实现。源码后续重跑和专项验证不能累计成一次全量运行的结果。

对应本地日志为 `verification-tests.log`、`dev-modes.log`、`tooling-final.log`、`package.log`、`windows.log`、`verify.log`、`changed-format.log`；均位于上述忽略目录。交接文档新增后的文档与格式检查另行执行。

### 未完成一：更新安装的 worktree 清理

入口是 [distribution 更新测试](../../../../tests/e2e/distribution/update/update-worktree.test.ts)，由 verify:package 选择。失败发生在 [removeUpdateWorktree](../../../../scripts/update/update-worktree.mjs)和 [prepare-update](../../../../scripts/update/prepare-update.mjs)的清理协作。

已定位的两层问题：第一次 Git 清理安装了依赖的临时 worktree 报 Filename too long；测试临时 clone 设置 core.longpaths=true 后，清理仍在 30 秒边界失败。prepare-update 只有删除成功才设置 removed 标记，finally 再次删除已部分清理的目录，于是 rev-parse 的 not a git repository 掩盖原始错误。

证据来自临时 clone 的 Git Trace2：第二轮 worktree remove 在 05:00:04.730 开始、没有正常退出记录；05:00:34.778 进入重复 rev-parse，随后退出 128。第一轮则明确记录删除长路径错误及退出 255。测试已增加诊断跟踪、失败保留、临时 clone 的 longpaths 设置及 900 秒用例超时；这些均不修改真实仓库 Git 配置。

**生产 scripts/update 的修复尚未实施。** 下一步应保留 HEAD/干净工作树/所有权检查，区分已经尝试删除与尚未开始删除，避免对部分删除目录盲目重试，保留原始失败和剩余现场；依据大型依赖树的实际耗时选择有界清理超时，必要时只为 Windows 清理命令启用进程级 longpaths。不能以强删任意目录、忽略失败或降低断言解决。

Windows 失败现场分别为临时目录 `nook-update-package-409XIV` 和 `nook-update-package-ALDhW9`，位于当时用户的 Local/Temp，内有 `git-trace.jsonl`；这些目录不会同步到 Mac。本地日志为 `update-debug.log` 和 `update-final.log`。Mac 可先复现公共入口；即使 Mac 通过，也不能关闭已经确认的 Windows 清理问题。

### 未完成二：全仓格式与完整聚合

Windows core.autocrlf=true 导致全仓 Prettier 报 279 个文件，主要是 CRLF 与项目 LF 约定冲突。以 end-of-line auto 作诊断后，仍剩两个既有内容格式问题：`.agents/skills/commit/SKILL.md` 和 `docs/ui-packages.md`。这仅是定位，不是修改门禁参数；既有问题没有借本次任务顺手修改。

在 Mac 的正常 LF checkout 重新执行原始门禁，确认剩余实际差异。用户明确要求不改 commit 技能和文档标准，若仍需修改受约束文件，应先说明具体差异与范围，再决定处理方式。不要排除文件、禁用门禁或把检查成功写入本次记录。`.nook-backups` 含真实用户备份，不得为了格式检查清理或格式化它。

### Mac 接续顺序

1. 拉取本次提交，使用仓库声明的 Node/pnpm 版本安装冻结依赖；设置 DSH_HOME 为仓库 `.dsh-dev` 或全新临时目录。不要复制 Windows 的 node_modules、构建产物或真实用户数据。
2. 阅读本 handoff、已落地决策、tests 规则和迁移映射。先运行原始格式与工程检查，确认 LF checkout 的结果，再执行 `pnpm verify`，补齐一次完整的源码聚合证据。
3. 定位并修复 worktree 清理，补充真实失败/部分清理的回归验证，运行 `node scripts/test/run.mjs integration --match update-worktree` 和 `pnpm verify:package`。该组须同时证明干净安装业务与更新安装通过；继续保留失败现场选项。
4. 在 macOS arm64 运行 `pnpm verify:desktop`，完成打包、随包原生探针、启动、业务、重启与生命周期验收。仅在已有本次匹配产物时使用 `--skip-package`，不能以平台跳过代替通过。核对 POSIX 数据锁继承、fs-ext 原生依赖和 Apache 参考验证。
5. 使用统一 Python 入口执行 POSIX 用例，并在有 Node 的 POSIX 环境运行跨语言 installer。Docker daemon 就绪后运行 `pnpm sync-server:verify`；按现有 CI 保留的系统/架构矩阵补齐 Docker/Compose 和独立 Linux 容器验收。Mac 不能替代原生 Linux 系统安装验证。
6. 如果修改共享启动、清理或更新代码，回到 Windows 重跑对应平台用例；记录平台、命令、通过/失败/未执行及原因。全部验收收口后更新本提案状态，不覆盖此前失败证据。

调度器 `--list` 可先核对执行范围，`--match` 可定位文件；公开命令负责准备，只有本次准备确实完成才使用 `--prepared`。截图环境变量、失败现场保留和桌面跳过打包的既有行为须继续保留。

## Alternatives considered

继续在 Windows 完成全部修复和验收，被用户要求先提交并切换到 Mac 的决定替代。交接因此保留可复现线索和未实施修复，不把诊断当作完成。

删除安装更新用例或只保留源码通过，会掩盖已发现的交付问题；将 Docker、桌面缺失前置条件记为通过，也不能满足原方案的环境覆盖要求。

## Acceptance criteria

- 迁移映射中的结果及环境组合均有对应入口，新增嵌套用例可自动发现，辅助文件不执行；相同执行组只执行一次，故意失败向公共命令传播。
- 用例独立准备，失败后进程、浏览器、监听器、服务与端口清理；worktree 失败保留原始原因且不删除无授权数据。
- 格式、文档、边界、类型、构建、普通测试、源码 Profile/Safe UI、干净安装、同步、重启持久化、备份恢复和平台原生能力分别有真实结果。
- 对应环境补齐 Windows、macOS arm64、Linux/Docker 验收；未执行部分显式记录，不能宣称完整整改通过。

## Risks

已有工作区修改与本次迁移一起提交，回退或重排时要保留备份锁和阶段结果断言。全部开发验证必须隔离数据；不修改产品 API、持久化格式、DSH 版本、已验证协议或已安装上游源码。跨环境复用场景不是删减环境的理由；本机已经通过的结果也不能证明其他平台通过。
