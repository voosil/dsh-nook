# Nook

Nook is a local notebook and knowledge workspace, delivered as a standalone application profile built on DeepSeek Harness (DSH). It composes official bundles, one pinned community browser provider, and product-owned Cordis plugins without modifying DSH or installed packages.

```text
Product features
      ↓
Nook capability contracts
      ↓
Providers and adapters
      ↓
Official, community, or owned plugins
```

## Requirements

- Node.js `^22.19.0 || >=24.0.0`
- pnpm `12.1.0` (managed through Corepack)
- Google Chrome or Microsoft Edge for the real browser integration smoke test

## Quick start

For the macOS desktop application, build with `pnpm desktop:package` and open `.pack/desktop/mac-arm64/Nook.app`. See the [desktop guide](apps/desktop/README.md) for isolated development, data locations and verification.

```bash
corepack enable
pnpm install
pnpm dev
```

Use `pnpm dev` for hot-reloading development on port 3080, or `pnpm start` for a fixed build on port 3081 while editing the code. Open the complete URL printed in the terminal. See [development and usage runtimes](docs/development.md) for data isolation, update behavior and port options.

The notes workspace opens by default. Record ideas, assign an optional project, and return to AI conversations from the sidebar. See the [notebook guide](packages/feature-notes/README.md), [conversation knowledge guide](packages/adapter-knowledge-dsh/README.md), and [video setup and writing guide](packages/feature-video/README.md). Summaries and writing use models configured in DSH.

Common commands:

```bash
pnpm start           # compile and run a fixed build with existing application data
pnpm format          # format the workspace
pnpm test            # fast contract tests
pnpm verify          # full development verification
pnpm verify:package  # clean packed-install release gate
pnpm dev:safe-ui     # boot the official UI without Nook Client plugins
pnpm dev:profile     # force-refresh Profile dependencies after composition changes
```

Runtime data stays in the repository or disposable temporary homes as described in the [runtime guide](docs/development.md). `verify:package` uses packed tarballs in a fresh temporary Profile.

See the [backup and recovery guide](docs/backup.md) for data protection and the `pnpm backup` commands.

The Nook launcher sets `CHOKIDAR_USEPOLLING=1` for DSH's Profile/Home patch watcher. This is a development-runtime compatibility setting for linked pnpm Profiles on the verified macOS environment; it does not disable any official Service watcher.

See [docs/architecture.md](docs/architecture.md) and [docs/discovery.md](docs/discovery.md).
