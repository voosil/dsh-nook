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

```bash
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` builds the Host packages and Client bundles, prepares the isolated Profile when needed, terminates any process already listening on port 3080, and then serves `http://127.0.0.1:3080`. `pnpm dev:safe-ui` uses the same build step. A failed build stops startup before port cleanup. Override the target port with `pnpm dev -- --port 4000`; port `0` asks the OS for a free port and skips cleanup.

The notes workspace opens by default. Record ideas, assign an optional project, and return to AI conversations from the sidebar. See the [notebook guide](packages/feature-notes/README.md), [conversation knowledge guide](packages/adapter-knowledge-dsh/README.md), and [video setup and writing guide](packages/feature-video/README.md). Summaries and writing use models configured in DSH.

Common commands:

```bash
pnpm format          # format the workspace
pnpm test            # fast contract tests
pnpm verify          # full development verification
pnpm verify:package  # clean packed-install release gate
pnpm dev:safe-ui     # boot the official UI without Nook Client plugins
pnpm dev:profile     # force-refresh Profile dependencies after composition changes
```

All DSH runtime data is isolated under `.dsh-dev/`. `verify:package` uses a fresh temporary `DSH_HOME` and packed tarballs rather than workspace links.

The Nook launcher sets `CHOKIDAR_USEPOLLING=1` for DSH's Profile/Home patch watcher. This is a development-runtime compatibility setting for linked pnpm Profiles on the verified macOS environment; it does not disable any official Service watcher.

See [docs/architecture.md](docs/architecture.md) and [docs/discovery.md](docs/discovery.md).
