# Nook repository rules

- Never fork, edit, or patch DeepSeek Harness source.
- Never edit `node_modules/@deepseek-ai/*` or any other installed package.
- Never use the real `~/.dsh` for development or verification. Set `DSH_HOME` to this repository's `.dsh-dev` or to a clean temporary directory.
- Never delete user data without first creating and verifying a recoverable backup; abort deletion if backup fails. Only disposable development/test data is exempt; data used by `pnpm start` is user data regardless of its directory name. See [backup and recovery](docs/backup.md).
- Never guess DSH APIs, service names, Slot keys or props, event payloads, Tool schemas, RPC contracts, Bundle metadata, or Client metadata. Verify the pinned runtime/source first and record unresolved facts as `UNKNOWN`.
- Business features depend on Nook Capability contracts, not concrete Providers. Package dependencies do not imply active Cordis services.
- Third-party private or unstable APIs belong behind a dedicated Adapter. Do not import private third-party modules from Feature packages.
- Extend official UI through verified additive Slots before keyed override or replacement. Never monkey-patch the DOM or import private official React components.
- Every listener, timer, subscription, socket, Tool, service contribution, and UI Slot contribution requires a cleanup/disposer. Avoid module-scope runtime effects.
- Every meaningful change must be typechecked, built, tested, integration-verified, and package-verified in proportion to its risk.
- Static checks that apply to a package family must discover matching packages automatically; adding a package must not require updating a separate checker allowlist.
- Preserve the Host/Client boundary. Cross it only with Nook-owned JSON-safe DTOs; never transfer Cordis contexts, services, React elements, Sessions, or arbitrary runtime objects.
- Follow [docs/AGENTS.md](docs/AGENTS.md) for documentation: current state lives in `docs/`, decisions as Agent Notes under `.agents/notes/` per [.agents/notes/AGENTS.md](.agents/notes/AGENTS.md); every non-trivial change adds or updates one note in the same change.
- Follow `.agents/skills/dsh-plugin-development/SKILL.md` for DSH work.
- Organize `packages/ui-*` code using the lightweight [UI package standard](docs/ui-packages.md).
- For DSH release upgrades, follow [dsh-upgrade](.agents/skills/dsh-upgrade/SKILL.md) and update its version-scoped lessons with newly verified migration problems in the same change.
