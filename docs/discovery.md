# DSH discovery baseline

Runtime, external RPC, prompt, model and workspace Slot contracts verified on 2026-09-08 against the pinned installed release and its source tag.

| Fact                         | Verified value                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Published DSH runtime        | `@deepseek-ai/dsh@0.1.3-alpha.2`                                                |
| Release source               | tag commit `82a5fd61a7cf5c293cec4bdff68f455398d685e9`                           |
| Required Node                | `^22.19.0` or `>=24.0.0`                                                        |
| Upstream package manager     | pnpm `11.7.0`                                                                   |
| Nook package manager         | pnpm `12.1.0`                                                                   |
| Official profile layers used | `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`                             |
| Bundle metadata              | `dsh.bundle.patch`                                                              |
| Profile metadata             | `dsh.profile.bundles`                                                           |
| Client metadata              | `dsh.client.inject`, optional `dsh.client.external`, `platform: web`            |
| Additive Slots used          | `sidebar.footer.action`, `conversation.session.header.actions`, `shell.overlay` |
| Community browser            | `dsh-browser-playwright@0.1.1` public `./service` and `./playwright` exports    |

## Published official Bundles

- `@deepseek-ai/dsh-base@0.1.3-alpha.2`: Host services and headless foundations.
- `@deepseek-ai/dsh-headless@0.1.3-alpha.2`: runnable headless composition; available but not selected by Nook.
- `@deepseek-ai/dsh-web-app@0.1.3-alpha.2`: Web Host plus Browser Client shell selected by Nook.

The verified extension chain is Bundle `dsh.bundle.patch` metadata → Profile `dsh.profile.bundles` ordering → Profile/Home patch files → repeatable CLI `--patch` overlays. Nook uses each layer explicitly and never relies on transitive activation.

## Runtime discovery

- Inspect final composition with `dsh --profile nook --dump-config`.
- Inspect Cordis runtime state with the current `cordis_inspect_list`, `cordis_inspect_query`, and `cordis_inspect_self` Tools when the diagnostic plugin is mounted.
- Query current service/event/tool providers through `Service.listService`, `Event.listEvents`, and `Tool.listTools` in the current runtime.
- Query Client contributions through `Slots.listSubTree`; query tokens through `Theme.listTokens`.

Client extensions use the verified `ctx.slots.inject(...)` + `ctx.slots.register(...)` lifecycle. The Client closure is registered through the current `window.__ModuleLoader__.load(...)` contract and declares its Host-injected Client packages in `dsh.client.inject`.

## Compatibility decisions

The community browser package declares DSH peer ranges ending before `0.1.0-rc.7`, while Nook pins `0.1.3-alpha.2`. Nook therefore never mounts its Tool plugin. The public Cordis service/provider slice has no value imports from DSH Tool or LLM packages and is guarded by a real provider smoke test. This is a narrow, evidence-based compatibility exception, not a claim that the whole community bundle is compatible.

`pnpm peers check` consequently reports the community package's stale `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm` peer ranges. These two known warnings are accepted only for the isolated service/provider slice above; any additional peer warning is a release failure.

Fresh development and packed-install Profiles constrain all `@deepseek-ai/*` resolutions to the repository lockfile through [runtime overrides](../scripts/profile-lib.mjs). Pinning only the top-level DSH version is insufficient: its published dependencies contain semver ranges, and newer Cordis utility plugins require a newer Cordis runtime. The clean-install gate rejects extra peer mismatches.

## UNKNOWN

- Native patch watching failed for the linked development Profile on the verified macOS environment, so Nook's launcher and verification scripts set Chokidar's documented `CHOKIDAR_USEPOLLING=1` compatibility mode. The root cause remains `UNKNOWN`. Product Services and their own watch settings remain untouched; Profile patch lifecycle is described below.
- The next published DSH release and its migration requirements remain `UNKNOWN`; `dsh-compat` fails closed outside the pinned release.

## Client hot reload

The pinned `@deepseek-ai/dsh-client-hmr` Host polls Client bundle files and emits `rebuilt` frames over `/plugins/events`. Its Client invalidates the module revision, prefetches the new bundle, disposes the old fiber and refreshes the plugin through the official Loader. This is plugin remounting, not React Fast Refresh. Nook enables it only through the development overlay. Repeated sidebar and notebook CSS updates, Slot cleanup and build-failure recovery are covered by [mode acceptance](../tests/e2e/dev-modes.test.ts).

## Browser boot and Client composition

The [release source](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.3-alpha.2) uses Cordis `4.0.2` and Schemastery `3.18.2`. Client plugins use Cordis `Context`; `@deepseek-ai/dsh-client-ui-renderer/client` owns the `slots` context augmentation. The former `dsh-client-runtime` package is absent from this release. Nook declares the renderer as a Client injection and imports its public types.

The Web startup URL contains a process token. A GET to that URL exchanges the token for a cookie and redirects to `/`; unauthenticated index requests return HTTP 401. Browser and HTTP acceptance use this flow, and diagnostic logs redact token values. Open the complete URL printed by the launcher to establish a browser session. Signed cookies use the persistent credential secret and survive Host restarts in the same home.

Session JSONL persistence depends on `fs-ext@2.1.1` for POSIX file locks. Workspace, development Profile and packed Profile installs permit its native build. Nook's model adapter and knowledge assembly hook do not configure persona; the release's persona prefix/suffix migration does not change those contracts.

## Desktop launcher discovery

The installed DSH manifest declares `bin.dsh = lib/bin.js`. That entry exports `runCli` but invokes it automatically only under `if (import.meta.main)`. Direct Node execution with `--version` prints the pinned version; dynamically importing the entry with the same argument does not run the CLI. A desktop launcher can execute the manifest-declared CLI in a separate Node process without importing internal boot chunks.

The installed Web Bundle's startup parser accepts `--no-open --host 127.0.0.1 --port 0`; the OS chooses the port at bind time. Launcher flags such as `--profile` and `--patch` precede Web flags. After Loader settlement, the Web Bundle announces the authenticated URL through `dsh web: ...`. Its authentication handoff follows the [browser boot contract](#browser-boot-and-client-composition). DSH subprocess-local launches its packaged runner through `process.execPath`, so the executable hosting DSH must also support ordinary Node child execution.

The installed app-boot validates `dsh.profile.patchReload` as `live` or `startup`; omitted values on custom Profiles default to `live`. Profile boot watches Profile/Home patch files only for `live`. `startup` is a verified option for a desktop Profile that applies configuration at the next launch; it does not disable unrelated plugin timers or storage watchers.

Profile names are resolved beneath `DSH_HOME/profiles` and reject path separators. CLI boot rewrites its generated root configuration and heals module fallback links. A whole Profile cannot be assumed to work directly inside read-only application resources. The CLI handles `SIGTERM` and `SIGINT` through root disposal. Forced termination and cleanup of every descendant still require platform acceptance.

## Product RPC and Client contracts

The installed `dsh-client-ui-layout` Slot contract declares `shell.overlay` as a root list. Its owner uses a non-interactive overlay container; contributed interactive content sets its own pointer events. The sidebar footer is a root list with `wide`; session header actions are a session list with `sessionId` and the session kit.

Client module discovery resolves `<package>/package.json`; contributing packages must export that path. Host entry points also need an applicable plugin export. Client mounting uses `ctx.remote.$mount({ package, descriptors })` followed by injection of the traced `remote.<namespace>` service before reading it. Package metadata or `$mount` completion alone is not proof that the namespace service is available.

The installed Typert registry accepts invocation descriptors registered through `ctx.typert.register` under a lifecycle effect. Gateway calls require a visible `TypertRemoteService` binding and validate parameter and return schemas. Named request parameters and the final cancellation signal must match the descriptor. Nook uses the official connection and Gateway route; it adds no unauthenticated HTTP RPC endpoint. [Gateway tests](../tests/contract/notebook.test.ts) and the [browser acceptance script](../scripts/notebook-smoke.mjs) exercise this path.

## Prompt and model contracts

The installed system-prompt package exposes the `system-prompt/assemble` waterfall with `next()`. The agent package augments assembly context with `agent`; `agent.session.deriveMessages()` provides the conversation view. Nook selects the latest message with a user source. Hook removal follows the Cordis listener lifecycle.

Template variable names must match `^[a-z][a-z0-9_]*$`. Variable values are inserted without recursively evaluating template syntax in source material. This behavior is covered using literal template markers in a retrieved note in the [intelligence tests](../tests/contract/intelligence.test.ts).

The LLM service exposes `listProviders()`, `listModels(provider)` and `stream(request)`. `createUserMessage` accepts content blocks and a user source. Nook collects visible `text-delta` blocks and replaces each with its completed `block-end` text; reasoning blocks are excluded. Only a `finish` reason of `stop` establishes a complete result. The request signal cancels generation. Nook does not construct private provider clients.
