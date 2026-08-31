# DSH discovery baseline

Verified on 2026-08-28 before implementation.

| Fact                         | Verified value                                                               |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Published DSH runtime        | `@deepseek-ai/dsh@0.1.1-rc.2`                                                |
| Release source               | tag commit `b150a551b8dac790f04a78b39ae600d0601a9af3`                        |
| Required Node                | `^22.19.0` or `>=24.0.0`                                                     |
| Upstream package manager     | pnpm `11.7.0`                                                                |
| Nook package manager         | pnpm `12.1.0`                                                                |
| Official profile layers used | `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`                          |
| Bundle metadata              | `dsh.bundle.patch`                                                           |
| Profile metadata             | `dsh.profile.bundles`                                                        |
| Client metadata              | `dsh.client.inject`, optional `dsh.client.external`, `platform: web`         |
| Additive Slots used          | `sidebar.footer.action`, `conversation.session.header.actions`               |
| Community browser            | `dsh-browser-playwright@0.1.1` public `./service` and `./playwright` exports |

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

The two Client extensions use the verified `ctx.slots.inject(...)` + `ctx.slots.register(...)` lifecycle. The Client closure is registered through the current `window.__ModuleLoader__.load(...)` contract and declares its Host-injected Client packages in `dsh.client.inject`.

## Compatibility decisions

The community browser package declares DSH peer ranges ending before `0.1.0-rc.7`, while Nook pins `0.1.1-rc.2`. Nook therefore never mounts its Tool plugin. The public Cordis service/provider slice has no value imports from DSH Tool or LLM packages and is guarded by a real provider smoke test. This is a narrow, evidence-based compatibility exception, not a claim that the whole community bundle is compatible.

`pnpm peers check` consequently reports the community package's stale `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm` peer ranges. These two known warnings are accepted only for the isolated service/provider slice above; any additional peer warning is a release failure.

## UNKNOWN

- Custom product Typert remotes in an external package remain `UNKNOWN`; Nook does not guess or ship one in this baseline.
- Client HMR reliability for DSH `0.1.1-rc.2` remains `UNKNOWN`; Host development uses build and runtime restart.
- DSH app boot unconditionally watches Profile and Home patches. Native watching failed for the linked development Profile on the verified macOS environment, so Nook's launcher and verification scripts set Chokidar's documented `CHOKIDAR_USEPOLLING=1` compatibility mode. Product Services and their own watch settings remain untouched.
- The next published DSH release and its migration requirements remain `UNKNOWN`; `dsh-compat` fails closed outside the pinned release.

## MVP implementation order

The completed baseline followed: Project/Browser/Artifact contracts → local Project and Artifact Providers → public community Browser Adapter → Project and Preview Features → verified DSH Tool Adapter and Agent Tools → additive Client Slot plugins → Product Bundle and isolated Profile → contract, real-provider, Full Profile, Safe UI, and packed-install verification.
