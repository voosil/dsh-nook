---
name: dsh-plugin-development
description: Build or change Nook DeepSeek Harness plugins, bundles, profiles, capabilities, adapters, or UI extensions against the repository's pinned and verified DSH runtime.
---

# DSH plugin development for Nook

Use this skill for every DSH-specific change in this repository.

## Workflow

1. Read `AGENTS.md`, `docs/discovery.md`, and the affected capability/plugin manifests and package READMEs. Keep integration findings in their home under the [documentation standard](../../../docs/AGENTS.md); feature-local facts do not expand the shared baseline.
2. Treat the user request as the SPEC. Identify every DSH-specific fact it needs.
3. DISCOVER each fact in the installed pinned runtime/source before writing code. Prefer, in order: current source/runtime, exports/types/manifests, official docs/examples, community examples. Mark anything unresolved `UNKNOWN` and do not invent it.
4. DESIGN dependencies as Feature → Nook Capability ← Provider/Adapter. Keep official/community private APIs inside one Adapter.
5. IMPLEMENT with lifecycle cleanup for every effect and with no module-scope runtime effects.
6. Follow the [test rules](../../../tests/AGENTS.md) and [command semantics](../../../docs/development.md#verification). Run `pnpm verify` for engineering checks, one build, local tests and source e2e; run `pnpm verify:package` independently for clean-install behavior. Select the affected local test group for iteration and the appropriate platform gate for delivery changes.
7. On failure, read the exact diagnostic, identify the invalid assumption, re-check source/runtime, apply the smallest fix, and rerun the failed verification.

## Runtime boundaries

- Never edit DeepSeek Harness or `node_modules`.
- Set `DSH_HOME` only to `.dsh-dev` or a fresh temporary directory.
- A package in `node_modules` is not an active service; verify the Profile row and runtime service separately.
- Cross Host/Client boundaries only with Nook-owned JSON-safe DTOs.
- Prefer verified additive Slots, then keyed override, then feature replacement, then shell replacement.
- Use `dev/patches/safe-ui.cordis.yml` to remove Nook UI contributions while debugging.

## Release gate

Verify both the source Profile and the clean packed installation through their public test commands. Installed modules must resolve from the target Profile; native probes use its delivered runtime. Composition dumps help diagnose activation, but actual services and business results establish acceptance. Report unexecuted platforms separately from passing gates.
