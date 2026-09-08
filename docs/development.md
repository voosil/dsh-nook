# Development and usage runtimes

| Command      | Default port | Code updates                                                           | Application data                            |
| ------------ | ------------ | ---------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm dev`   | 3080         | Watches packages; rebuilds Client plugins and restarts Host code       | A fresh temporary home, removed on exit     |
| `pnpm start` | 3081         | Builds and installs a fixed snapshot; changes apply on the next launch | Shared formal data; see [usage](runtime.md) |

Open the complete URL printed by the command to establish [browser authentication](discovery.md#browser-boot-and-client-composition). Both commands accept `-- --port 4000`; port `0` selects an available port when creating a backend. An already-running shared backend keeps its existing port. Development keeps that selected port across Host restarts. An occupied port fails startup; neither launcher terminates another application's listener.

## Development

The [desktop development entry](../apps/desktop/README.md#开发与打包) builds a fixed snapshot and opens Electron with a disposable home. Its lifecycle and packaged data are separate from both browser modes described here.

The development launcher builds before boot and polls package sources, assets and manifests plus root TypeScript/workspace configuration. Client-only changes rebuild bundles and activate the [verified official HMR chain](discovery.md#client-hot-reload). Host output or other package changes rebuild and restart the development runtime. Builds run serially; edits made during a build trigger another pass. A failed rebuild leaves the running Host and previous Client bundles available and retries on the next edit.

Client HMR remounts the changed plugin. Local React state in that plugin can reset; it is not React Fast Refresh. Save content before editing its UI code. Other plugins and the browser document remain mounted during a Client-only update.

`pnpm dev:safe-ui` uses the same watcher with Nook UI contributions disabled. After adding dependencies or changing Profile membership, run `pnpm install` and `pnpm dev:profile`, then restart development. Profile refresh preserves existing user patch files. Changes to launcher/build scripts also require restarting the command.

Development starts with fresh data and credentials. Configure development models in that temporary instance when needed. The temporary directory is printed at startup and remains available through automatic Host restarts. It is removed when the launcher exits. The real user DSH home is never used.

## Usage while editing

`pnpm start` builds the workspace and connects to the [formal shared runtime](runtime.md). If no backend is running, it packs a fixed installation with pinned dependencies and installs it into a versioned directory. Source edits do not change that running snapshot; all formal launchers must exit before a new build becomes active.

Usage data, migration, working directory and shutdown behavior belong to the [formal runtime guide](runtime.md). Both Web and desktop use the same data lock and verified pre-start backup. Backup scope and recovery commands are described in the [backup guide](backup.md).

## Verification

The [mode acceptance test](../tests/e2e/dev-modes.test.ts) creates a disposable workspace and opens both modes in Chrome. It checks repeated Client updates, CSS/Slot remounting, build-failure recovery, Host restart/reconnection, usage snapshot isolation and process cleanup. The [watcher integration test](../tests/integration/dev-watch.test.ts) covers edits during an in-flight build and shutdown. The [package gate](../scripts/verify-package.mjs) uses the same snapshot installer as usage startup.
