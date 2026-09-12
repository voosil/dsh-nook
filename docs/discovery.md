# DSH discovery baseline

Shared integration facts verified on 2026-09-08 against `@deepseek-ai/dsh@0.1.3-alpha.2`, source commit `82a5fd61a7cf5c293cec4bdff68f455398d685e9` ([release source](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.3-alpha.2)). Dependency and engine values belong to the [root manifest](../package.json) and lockfile; [dsh-compat](../packages/dsh-compat/src/index.ts) enforces the supported release. Recheck affected contracts against the installed runtime when changing integrations.

Scope and placement follow the [documentation standard](AGENTS.md). Package-specific constraints live beside their adapters or UI packages; this baseline does not inventory features or upstream APIs.

## Composition and discovery

The extension chain is Bundle `dsh.bundle.patch` → Profile `dsh.profile.bundles` ordering → Profile/Home patch files → repeatable CLI `--patch` overlays. Package dependencies do not activate services. Nook's selected composition belongs to [architecture](architecture.md).

Inspect final composition with `dsh --profile nook --dump-config`; inspect active providers through `Service.listService`, `Event.listEvents` and `Tool.listTools`, or the mounted diagnostic plugin's `cordis_inspect_*` Tools. Client contributions and theme tokens are exposed through `Slots.listSubTree` and `Theme.listTokens`.

## Compatibility decisions

The community browser package's DSH peer ranges exclude the pinned release. Nook mounts only its public service/provider slice, which has no value imports from DSH Tool or LLM packages, and verifies it with a real provider smoke test. Its Tool plugin is not mounted. Only the stale `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm` peer warnings are accepted; additional mismatches fail the release gate. The [peer policy](../scripts/shared/peer-policy.mjs) owns the executable check.

Fresh linked and packed Profiles constrain all `@deepseek-ai/*` resolutions to the lockfile through [runtime overrides](../scripts/profile/profile-lib.mjs). The top-level pin alone cannot prevent transitive semver ranges from selecting incompatible Cordis plugins.

## Browser boot and Client composition

The startup URL's process token is exchanged by GET for a cookie and redirect to `/`; unauthenticated index requests return 401. Open the complete launcher URL and redact tokens in diagnostics. Signed cookies survive Host restarts with the same home, host and port; another port requires another token exchange.

Client plugins use public Cordis `Context` and renderer types. The closure loads through `window.__ModuleLoader__.load(...)`; Host-provided Client dependencies are declared in `dsh.client.inject`, with `platform: web`. Packages must export `./package.json` for discovery and an applicable Host plugin entry. Metadata does not prove service availability.

## Product RPC and Client contracts

Client Slots use `ctx.slots.inject(...)` and `ctx.slots.register(...)` with lifecycle cleanup. `shell.overlay` is a root list with a non-interactive container; interactive contributions set their own pointer events. `sidebar.footer.action` is a root list with `wide`; `conversation.session.header.actions` is a session list with `sessionId` and the session kit.

Remote services require `ctx.remote.$mount({ package, descriptors })` followed by injection of the traced `remote.<namespace>` service. Host `ctx.typert.register` runs in a lifecycle effect; Gateway calls require a visible `TypertRemoteService`, matching named parameters, the final cancellation signal and validated request/return schemas. Use the official authenticated connection. [Gateway tests](../tests/integration/notes/rpc.test.ts) and [browser acceptance](../tests/helpers/scenarios/notebook.mjs) cover this boundary.

## Client hot reload

The official HMR Host polls bundles and emits `rebuilt` frames over `/plugins/events`; its Client invalidates the module revision, prefetches, disposes the old fiber and remounts through the Loader. Nook enables this only in development. User-facing behavior and verification belong to the [development guide](development.md).

## Desktop launcher discovery

The manifest-declared `bin.dsh` is `lib/bin.js`; importing it does not run the CLI (`import.meta.main` guards execution). Launch it in a separate Node process. DSH's subprocess runner uses `process.execPath`, so that executable must support Node child execution. Web flags accept `--no-open --host 127.0.0.1 --port 0`, after Profile/patch flags; `dsh web: ...` announces the authenticated URL after Loader settlement.

Profiles resolve beneath `DSH_HOME/profiles` and reject path separators. Boot rewrites generated configuration and heals `profiles/node_modules` and each Profile's `.dsh-module-fallback/node_modules`; Profiles need writable runtime storage. `dsh.profile.patchReload` accepts `live` (custom Profile default) or `startup`; the latter disables Profile/Home patch watching only. CLI termination signals dispose the root; descendant cleanup needs platform acceptance. JSONL persistence has native dependencies, so installs must permit their builds. Launcher behavior belongs to the [runtime guide](runtime.md).

## UNKNOWN

- Native patch watching fails in the verified linked macOS Profile; its root cause is `UNKNOWN`. Launchers and verification use `CHOKIDAR_USEPOLLING=1`, without changing product service watchers.
- Compatibility with another DSH release is `UNKNOWN`; upgrades follow the [upgrade workflow](../.agents/skills/dsh-upgrade/SKILL.md).
