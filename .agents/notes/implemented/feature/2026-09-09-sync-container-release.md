# Agent Note: 同步镜像 GHCR 发布

Status: implemented

## Problem

用户要求同步服务器使用固定版本镜像直接从 GHCR 获取，避免每台服务器重新构建及安装系统依赖。镜像需要覆盖常见服务器架构，并在发布前验证数据持久化与并发写入行为。

## Decision

[发布工作流](../../../../.github/workflows/sync-server.yml)由独立版本标签或专用发布分支触发，使用原生 amd64 和 arm64 runner 分别构建与执行 [Compose 验收](../../../../tests/e2e/sync-server/docker/test_compose.py)，验证成功才推送架构镜像并合成固定版本清单。Actions 使用短期 GITHUB_TOKEN 的 packages:write 权限，源码通过 OCI source 标签关联仓库。版本清单不覆盖已有版本；工作流按仓库串行发布，失败可定位到具体架构。

发布所需源文件可以在隔离检出中形成专门的版本提交；当前工作区的其他未提交产品改动不因镜像发布而自动提交。容器只复制明确列出的服务源文件，不包含本地配置、凭据或数据。部署方式和版本由 [Docker 部署说明](../../../../scripts/sync-server/DOCKER.md)承载。

## Alternatives considered

**本机保存长期 GHCR 令牌。** 现有 GitHub CLI 凭据不含 packages 写权限。Actions 的仓库令牌足够执行发布，避免额外授权并保存长期凭据。

**只发布本机 arm64 镜像。** 常见 VPS 使用 amd64，因此两个架构在各自原生 runner 上验证后再共同发布。

## Validation

[首次发布运行](https://github.com/voosil/dsh-nook/actions/runs/34304459205)在两个原生架构上通过真实 Compose 启停、TLS、认证、条件写入、卷锁、重建和证书备份验收后完成 GHCR 发布。匿名清单检查确认固定版本同时包含 linux/amd64 与 linux/arm64。

## Consequences

服务器可直接获取匹配架构的版本镜像。首次发布的包需要设置公开可见，并验证匿名拉取；GitHub 仓库公开不代表新包自动公开。基础系统软件包来自构建时的 Debian 软件源，版本标签对应一次发布的产物，而不承诺源码重复构建的字节一致性。
