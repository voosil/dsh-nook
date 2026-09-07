# DSH discovery baseline

Runtime baseline verified on 2026-08-28; external RPC, prompt, model and workspace Slot contracts verified on 2026-09-07 against the same pinned installed source.

| Fact                         | Verified value                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Published DSH runtime        | `@deepseek-ai/dsh@0.1.1-rc.2`                                                   |
| Release source               | tag commit `b150a551b8dac790f04a78b39ae600d0601a9af3`                           |
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

- `@deepseek-ai/dsh-base@0.1.1-rc.2`: Host services and headless foundations.
- `@deepseek-ai/dsh-headless@0.1.1-rc.2`: runnable headless composition; available but not selected by Nook.
- `@deepseek-ai/dsh-web-app@0.1.1-rc.2`: Web Host plus Browser Client shell selected by Nook.

The verified extension chain is Bundle `dsh.bundle.patch` metadata → Profile `dsh.profile.bundles` ordering → Profile/Home patch files → repeatable CLI `--patch` overlays. Nook uses each layer explicitly and never relies on transitive activation.

## Runtime discovery

- Inspect final composition with `dsh --profile nook --dump-config`.
- Inspect Cordis runtime state with the current `cordis_inspect_list`, `cordis_inspect_query`, and `cordis_inspect_self` Tools when the diagnostic plugin is mounted.
- Query current service/event/tool providers through `Service.listService`, `Event.listEvents`, and `Tool.listTools` in the current runtime.
- Query Client contributions through `Slots.listSubTree`; query tokens through `Theme.listTokens`.

Client extensions use the verified `ctx.slots.inject(...)` + `ctx.slots.register(...)` lifecycle. The Client closure is registered through the current `window.__ModuleLoader__.load(...)` contract and declares its Host-injected Client packages in `dsh.client.inject`.

## Compatibility decisions

The community browser package declares DSH peer ranges ending before `0.1.0-rc.7`, while Nook pins `0.1.1-rc.2`. Nook therefore never mounts its Tool plugin. The public Cordis service/provider slice has no value imports from DSH Tool or LLM packages and is guarded by a real provider smoke test. This is a narrow, evidence-based compatibility exception, not a claim that the whole community bundle is compatible.

`pnpm peers check` consequently reports the community package's stale `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm` peer ranges. These two known warnings are accepted only for the isolated service/provider slice above; any additional peer warning is a release failure.

Fresh development and packed-install Profiles constrain all `@deepseek-ai/*` resolutions to the repository lockfile through [runtime overrides](../scripts/profile-lib.mjs). Pinning only the top-level DSH version is insufficient: its published dependencies contain semver ranges, and newer Cordis utility plugins require a newer Cordis runtime. The clean-install gate rejects extra peer mismatches.

## UNKNOWN

- Client HMR reliability for DSH `0.1.1-rc.2` remains `UNKNOWN`; Host development uses build and runtime restart.
- DSH app boot unconditionally watches Profile and Home patches. Native watching failed for the linked development Profile on the verified macOS environment, so Nook's launcher and verification scripts set Chokidar's documented `CHOKIDAR_USEPOLLING=1` compatibility mode. Product Services and their own watch settings remain untouched.
- The next published DSH release and its migration requirements remain `UNKNOWN`; `dsh-compat` fails closed outside the pinned release.

## Product RPC and Client contracts

The installed `dsh-client-ui-layout` Slot contract declares `shell.overlay` as a root list. Its owner uses a non-interactive overlay container; contributed interactive content sets its own pointer events. The sidebar footer is a root list with `wide`; session header actions are a session list with `sessionId` and the session kit.

Client module discovery resolves `<package>/package.json`; contributing packages must export that path. Host entry points also need an applicable plugin export. Client mounting uses `ctx.remote.$mount({ package, descriptors })` followed by injection of the traced `remote.<namespace>` service before reading it. Package metadata or `$mount` completion alone is not proof that the namespace service is available.

The installed Typert registry accepts invocation descriptors registered through `ctx.typert.register` under a lifecycle effect. Gateway calls require a visible `TypertRemoteService` binding and validate parameter and return schemas. Named request parameters and the final cancellation signal must match the descriptor. Nook uses the official connection and Gateway route; it adds no unauthenticated HTTP RPC endpoint. [Gateway tests](../tests/contract/notebook.test.ts) and the [browser acceptance script](../scripts/notebook-smoke.mjs) exercise this path.

## Prompt and model contracts

The installed system-prompt package exposes the `system-prompt/assemble` waterfall with `next()`. The agent package augments assembly context with `agent`; `agent.session.deriveMessages()` provides the conversation view. Nook selects the latest message with a user source. Hook removal follows the Cordis listener lifecycle.

Template variable names must match `^[a-z][a-z0-9_]*$`. Variable values are inserted without recursively evaluating template syntax in source material. This behavior is covered using literal template markers in a retrieved note in the [intelligence tests](../tests/contract/intelligence.test.ts).

The LLM service exposes `listProviders()`, `listModels(provider)` and `stream(request)`. `createUserMessage` accepts content blocks and a user source. Nook collects visible `text-delta` blocks and replaces each with its completed `block-end` text; reasoning blocks are excluded. Only a `finish` reason of `stop` establishes a complete result. The request signal cancels generation. Nook does not construct private provider clients.
