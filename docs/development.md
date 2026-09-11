# Development and usage runtimes

| Command      | Default port | Code updates                                                           | Application data                            |
| ------------ | ------------ | ---------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm dev`   | 3080         | Watches packages; rebuilds Client plugins and restarts Host code       | Persistent isolated development home        |
| `pnpm start` | 3081         | Builds and installs a fixed snapshot; changes apply on the next launch | Shared formal data; see [usage](runtime.md) |

Open the complete URL printed by the command to establish [browser authentication](discovery.md#browser-boot-and-client-composition). Both commands accept `-- --port 4000`; port `0` selects an available port when creating a backend. An already-running shared backend keeps its existing port. Development keeps that selected port across Host restarts. An unavailable explicit port fails startup. When a command's default port is unavailable, the launcher probes the following ports and uses the first free one; if none of the next ten is free, it asks the OS for an available port. Neither launcher terminates another application's listener.

## Development

The [desktop development entry](../apps/desktop/README.md#开发与打包) builds a fixed snapshot and opens Electron with its own persistent development home. Its lifecycle and packaged data are separate from both browser modes described here.

The development launcher builds, refreshes the Profile manifest and installs its dependencies before boot. It polls package sources, assets and manifests plus root TypeScript/workspace configuration. Client-only changes rebuild bundles and activate the [verified official HMR chain](discovery.md#client-hot-reload). Host output or other package changes rebuild and restart the development runtime. Builds run serially; edits made during a build trigger another pass. A failed rebuild leaves the running Host and previous Client bundles available and retries on the next edit.

Client HMR remounts the changed plugin. Local React state in that plugin can reset; it is not React Fast Refresh. Save content before editing its UI code. Other plugins and the browser document remain mounted during a Client-only update.

`pnpm dev:safe-ui` uses the same watcher with Nook UI contributions disabled. After adding workspace dependencies, run `pnpm install` and restart development. Profile membership changes require a restart; the launcher refreshes dependency links automatically while preserving existing user patch files. `pnpm dev:profile` prepares the Profile independently. Changes to launcher/build scripts also require restarting the command.

Browser development keeps data, credentials and model configuration in `.dsh-dev/sandboxes/web`; desktop development uses `.dsh-dev/sandboxes/desktop`. Each home starts with independent configuration and retains it across launches and Host restarts. Neither imports historical `.dsh-dev/nook` data, formal application data, or the real user DSH home. Configure development models once in the development instance. A launcher lock prevents concurrent use of the same home; after a crash, inspect the reported lock owner and ensure its processes have stopped before removing the lock directory.

The first persistent launch creates example projects, Markdown and long-form notes, an empty note, a trash entry, and manual or unassigned tasks in several states. The seed uses Nook business services and the validated task store without starting a scheduler or connecting a model or sync service. `pnpm dev:seed` prepares missing browser examples and exits; stop browser development before running it. Seed receipts and stable record IDs preserve edits, renamed projects and trashed notes. Normal launches do not reapply a completed seed.

`pnpm dev:clean` starts an unseeded temporary browser home and removes only that temporary home on exit. It does not reset persistent development data. Desktop accepts `pnpm desktop:dev -- --clean` for the same disposable behavior.

Development disables the data-sync settings entry and deployment guide in the frontend, including direct guide links. A runtime flag travels through the authenticated Nook notebook RPC, so the same Client bundle can serve formal and development instances. This is a frontend restriction; backend sync contracts remain unchanged. Formal application sync remains available.

Each development Profile owns its module directory and links each declared dependency to its resolved installed package directory. This preserves workspace updates on Windows and keeps runtime-generated dependency fallback links inside its isolated home.

## Usage while editing

`pnpm start` builds the workspace and connects to the [formal shared runtime](runtime.md). If no backend is running, it packs a fixed installation with pinned dependencies and installs it into a versioned directory. Source edits do not change that running snapshot; all formal launchers must exit before a new build becomes active.

Usage data, migration, working directory and shutdown behavior belong to the [formal runtime guide](runtime.md). Both Web and desktop use the same data lock and verified pre-start backup. Backup scope and recovery commands are described in the [backup guide](backup.md).

## Repository scripts

Scripts are grouped by responsibility: `scripts/build/` bundles Client and desktop code; `scripts/profile/` manages Profile setup, launchers, development watching and packed installation; `scripts/desktop/` prepares the desktop runtime and distribution; `scripts/verify/` contains repository checks and runtime acceptance; `scripts/data/` provides backup and recovery commands; `scripts/shared/` holds reusable process, port and peer-policy helpers. The [sync server tools](../scripts/sync-server/README.md) own deployment assets in `scripts/sync-server/`.

The [root package scripts](../package.json) define the public command names. Internal imports and test fixtures follow the same directory layout.

## Verification

`pnpm verify:windows` builds and runs the [Windows startup acceptance](../scripts/verify/verify-windows-start.mjs) using a temporary path with spaces and Chinese characters. Its first launch uses the default port policy without an override. It installs all packed Nook packages, opens Chrome, checks authenticated notebook operations and sync, shares the backend between clients, and restarts on the same port to verify persistent credentials, pre-start backups and shutdown. It does not import the repository's old usage data. The screenshot is saved to `.pack/windows-start.png`.

The [mode acceptance test](../tests/e2e/dev-modes.test.ts) creates a disposable workspace and opens both modes in Chrome. It checks repeated Client updates, CSS/Slot remounting, build-failure recovery, Host restart/reconnection, usage snapshot isolation and process cleanup. The [watcher integration test](../tests/integration/dev-watch.test.ts) covers edits during an in-flight build and shutdown. The [package gate](../scripts/verify/verify-package.mjs) uses the same snapshot installer as usage startup.
