# Development and usage runtimes

| Command      | Default port | Code updates                                                           | Application data                           |
| ------------ | ------------ | ---------------------------------------------------------------------- | ------------------------------------------ |
| `pnpm dev`   | 3080         | Watches packages; rebuilds Client plugins and restarts Host code       | A fresh temporary home, removed on exit    |
| `pnpm start` | 3081         | Builds and installs a fixed snapshot; changes apply on the next launch | Existing `.dsh-dev` data and configuration |

Open the complete URL printed by the command to establish [browser authentication](discovery.md#browser-boot-and-client-composition). Both commands accept `-- --port 4000`; port `0` selects an available port. Development keeps that selected port across Host restarts. An occupied port fails startup; neither launcher terminates another application's listener.

## Development

The development launcher builds before boot and polls package sources, assets and manifests plus root TypeScript/workspace configuration. Client-only changes rebuild bundles and activate the [verified official HMR chain](discovery.md#client-hot-reload). Host output or other package changes rebuild and restart the development runtime. Builds run serially; edits made during a build trigger another pass. A failed rebuild leaves the running Host and previous Client bundles available and retries on the next edit.

Client HMR remounts the changed plugin. Local React state in that plugin can reset; it is not React Fast Refresh. Save content before editing its UI code. Other plugins and the browser document remain mounted during a Client-only update.

`pnpm dev:safe-ui` uses the same watcher with Nook UI contributions disabled. After adding dependencies or changing Profile membership, run `pnpm install` and `pnpm dev:profile`, then restart development. Profile refresh preserves existing user patch files. Changes to launcher/build scripts also require restarting the command.

Development starts with fresh data and credentials. Configure development models in that temporary instance when needed. The temporary directory is printed at startup and remains available through automatic Host restarts. It is removed when the launcher exits. The real user DSH home is never used.

## Usage while editing

`pnpm start` builds the workspace, packs Nook packages and installs them with pinned external dependencies in a separate temporary installation. Its Profile links to that installation, not workspace packages. The runtime runs with the repository as its working directory so it can edit the project while serving its fixed build. Rebuilding or changing source in another terminal does not change this instance, even when its browser is refreshed.

Application data and credentials stay under `.dsh-dev`; the existing Nook Profile patch is copied into the snapshot. Dependency installation makes startup slower than development. Stopping the command removes the temporary installation and Profile link, preserving application data. Relaunch `pnpm start` when the new build is ready to use. Runtime configuration still follows DSH's own lifecycle; this mode disables source watching and Client HMR.

Usage startup holds the data lock and creates a verified backup before boot. Backup scope, failure behavior and recovery commands are described in the [backup guide](backup.md).

## Verification

The [mode acceptance test](../tests/e2e/dev-modes.test.ts) creates a disposable workspace and opens both modes in Chrome. It checks repeated Client updates, CSS/Slot remounting, build-failure recovery, Host restart/reconnection, usage snapshot isolation and process cleanup. The [watcher integration test](../tests/integration/dev-watch.test.ts) covers edits during an in-flight build and shutdown. The [package gate](../scripts/verify-package.mjs) uses the same snapshot installer as usage startup.
