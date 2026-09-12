# Development and usage runtimes

| Command      | Default port | Code updates                                                     | Application data                            |
| ------------ | ------------ | ---------------------------------------------------------------- | ------------------------------------------- |
| `pnpm dev`   | 3080         | Watches packages; rebuilds Client plugins and restarts Host code | Persistent isolated development home        |
| `pnpm start` | 3081         | Prepares current source, then replaces the formal backend        | Shared formal data; see [usage](runtime.md) |

Open the complete URL printed by the command to establish [browser authentication](discovery.md#browser-boot-and-client-composition). Both commands accept `-- --port 4000`; port `0` selects an available port when creating a backend. Development keeps its selected port across Host restarts and scans subsequent ports when its default is unavailable. Formal startup uses 3081 unless explicitly overridden; it never falls back to another port. It replaces only the Nook backend for its formal state, and an unrelated listener causes an error.

## Development

The [desktop development entry](../apps/desktop/README.md#开发与打包) builds a fixed snapshot and opens Electron with its own persistent development home. Its lifecycle and packaged data are separate from both browser modes described here.

The development launcher builds, refreshes the Profile manifest and installs its dependencies before boot. It polls package sources, assets and manifests plus root TypeScript/workspace configuration. Client-only changes rebuild bundles and activate the [verified official HMR chain](discovery.md#client-hot-reload). Host output or other package changes rebuild and restart the development runtime. Builds run serially; edits made during a build trigger another pass. A failed rebuild leaves the running Host and previous Client bundles available and retries on the next edit.

Client HMR remounts the changed plugin. Local React state in that plugin can reset; it is not React Fast Refresh. Save content before editing its UI code. Other plugins and the browser document remain mounted during a Client-only update.

`pnpm dev:safe-ui` uses the same watcher with Nook UI contributions disabled. After adding workspace dependencies, run `pnpm install` and restart development. Profile membership changes require a restart; the launcher refreshes dependency links automatically while preserving existing user patch files. `pnpm dev:profile` prepares the Profile independently. Changes to launcher/build scripts also require restarting the command.

Browser development keeps data, credentials and model configuration in `.dsh-dev/sandboxes/web`; desktop development uses `.dsh-dev/sandboxes/desktop`. Each home starts with independent configuration and retains it across launches and Host restarts. Neither imports historical `.dsh-dev/nook` data, formal application data, or the real user DSH home. Configure development models once in the development instance. A native file lock prevents concurrent launchers for the same home and is released by the OS on process exit, including forced termination. Lock directories and legacy `owner.json` files are not evidence of a live lock and never need manual cleanup. Keep the generated `lease` file in place even when idle so all contenders lock the same file; deleting it could bypass exclusion. Stop launchers from before this lock-protocol change once before using the updated scripts.

The first persistent launch creates example projects, Markdown and long-form notes, an empty note, a trash entry, and manual or unassigned tasks in several states. The seed uses Nook business services and the validated task store without starting a scheduler or connecting a model or sync service. `pnpm dev:seed` prepares missing browser examples and exits; stop browser development before running it. Seed receipts and stable record IDs preserve edits, renamed projects and trashed notes. Normal launches do not reapply a completed seed.

`pnpm dev:clean` starts an unseeded temporary browser home and removes only that temporary home on exit. It does not reset persistent development data. Desktop accepts `pnpm desktop:dev -- --clean` for the same disposable behavior.

Development disables the data-sync settings entry and deployment guide in the frontend, including direct guide links. A runtime flag travels through the authenticated Nook notebook RPC, so the same Client bundle can serve formal and development instances. This is a frontend restriction; backend sync contracts remain unchanged. Formal application sync remains available.

Each development Profile owns its module directory and links each declared dependency to its resolved installed package directory. This preserves workspace updates on Windows and keeps runtime-generated dependency fallback links inside its isolated home.

## Usage while editing

`pnpm start` builds, packs and installs the current workspace before stopping the [formal backend](runtime.md). Preparation failures leave the old backend serving. After preparation, it stops the old backend, waits for shutdown, checks the requested port and activates the prepared snapshot. Running jobs stop and existing clients disconnect at cutover. Source changes require another start. Desktop clients may still attach to the current backend.

Usage data, migration, working directory and shutdown behavior belong to the [formal runtime guide](runtime.md). Both Web and desktop use the same data lock and verified pre-start backup. Backup scope and recovery commands are described in the [backup guide](backup.md).

## Repository scripts

Scripts are grouped by responsibility: `scripts/build/` bundles Client and desktop code; `scripts/profile/` manages Profile setup, launchers, development watching and packed installation; `scripts/desktop/` prepares the desktop runtime and distribution; `scripts/verify/` owns [engineering checks and preparation entrypoints](../scripts/verify/AGENTS.md); `scripts/test/` discovers and dispatches existing Node/tsx and Python runners; `scripts/data/` provides backup and recovery commands; `scripts/shared/` holds reusable process, port and peer-policy helpers. Product assertions and test environments belong to centralized [tests](../tests/AGENTS.md). The [sync server tools](../scripts/sync-server/README.md) own deployment assets in `scripts/sync-server/`.

The [root package scripts](../package.json) define the public command names. Internal imports and test fixtures follow the same directory layout.

## Verification

Public commands prepare their required build/Profile or package once per invocation. The aggregate reuses that preparation; `--prepared` is for a caller that already completed it in the current run. No test file allowlist is maintained.

| Command                   | Scope                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm test:unit`          | Single-module behavior                                                                          |
| `pnpm test:component`     | Independently mounted components                                                                |
| `pnpm test:integration`   | Local module, storage, protocol and process collaboration                                       |
| `pnpm test`               | The preceding three groups, in order                                                            |
| `pnpm test:e2e`           | Source workflows, including Profile and Safe UI                                                 |
| `pnpm verify:profile`     | Compatibility entry for the same Profile cases included in source e2e                           |
| `pnpm verify:package`     | Clean packed installation and its workflows                                                     |
| `pnpm verify:desktop`     | macOS arm64 packaged delivery and native lifecycle; `--skip-package` reuses an existing package |
| `pnpm verify:windows`     | Windows startup and installed-runtime lifecycle                                                 |
| `pnpm sync-server:verify` | Existing Docker/Compose acceptance                                                              |
| `pnpm verify`             | Engineering checks, one build, local tests and source e2e; Profile runs once                    |

Ordinary groups do not start Docker, install system packages or package the desktop. CI keeps its system/architecture matrix and uses the [Python dispatcher](../scripts/test/python.py) in Python-only containers. The Node dispatcher also provides `sync-assistant` and `sync-linux` groups for these explicit environments. Missing prerequisites fail an explicitly selected gate; unsupported platforms and unexecuted gates must be reported separately. Browser cases need Chrome; TLS integration needs OpenSSL on PATH. Python can be selected with `NOOK_TEST_PYTHON`.

For focused execution, use `node scripts/test/run.mjs integration --match sync --prepared`; `--list` reports recursive discovery without execution. Native Node test-name filtering can select a single named case after preparation. Test artifacts stay outside source directories; existing screenshot variables and `NOOK_KEEP_VERIFY_TEMP` remain supported.

`pnpm verify:windows` builds and runs the [Windows startup acceptance](../tests/e2e/distribution/windows/start.test.mjs) using a temporary path with spaces and Chinese characters. It explicitly selects a free test port so acceptance cannot replace a real user backend. It installs all packed Nook packages, opens Chrome, checks authenticated notebook operations and sync, shares the backend between clients, and restarts on the same port to verify persistent credentials, pre-start backups and shutdown. It does not import the repository's old usage data. The screenshot is saved to `.pack/windows-start.png`.

The [mode acceptance test](../tests/e2e/runtime/dev-modes.test.ts) creates a disposable workspace and opens both modes in Chrome. It checks repeated Client updates, CSS/Slot remounting, build-failure recovery, Host restart/reconnection, usage snapshot isolation and process cleanup. The [watcher integration test](../tests/integration/runtime/dev-watch.test.ts) covers edits during an in-flight build and shutdown. The [package gate](../tests/e2e/distribution/package/installation.test.mjs) uses the same snapshot installer as usage startup.
