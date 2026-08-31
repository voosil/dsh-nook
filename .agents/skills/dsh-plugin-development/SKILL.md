---
name: dsh-plugin-development
description: Build or change Nook DeepSeek Harness plugins, bundles, profiles, capabilities, adapters, or UI extensions against the repository's pinned and verified DSH runtime.
---

# DSH plugin development for Nook

Use this skill for every DSH-specific change in this repository.

## Workflow

1. Read `AGENTS.md`, `docs/discovery.md`, and the affected capability/plugin manifests.
2. Treat the user request as the SPEC. Identify every DSH-specific fact it needs.
3. DISCOVER each fact in the installed pinned runtime/source before writing code. Prefer, in order: current source/runtime, exports/types/manifests, official docs/examples, community examples. Mark anything unresolved `UNKNOWN` and do not invent it.
4. DESIGN dependencies as Feature → Nook Capability ← Provider/Adapter. Keep official/community private APIs inside one Adapter.
5. IMPLEMENT with lifecycle cleanup for every effect and with no module-scope runtime effects.
6. Run typecheck, build, contract tests, provider integration, full Profile verification, and clean-package verification as appropriate.
7. On failure, read the exact diagnostic, identify the invalid assumption, re-check source/runtime, apply the smallest fix, and rerun the failed verification.

## Runtime boundaries

- Never edit DeepSeek Harness or `node_modules`.
- Set `DSH_HOME` only to `.dsh-dev` or a fresh temporary directory.
- A package in `node_modules` is not an active service; verify the Profile row and runtime service separately.
- Cross Host/Client boundaries only with Nook-owned JSON-safe DTOs.
- Prefer verified additive Slots, then keyed override, then feature replacement, then shell replacement.
- Use `dev/patches/safe-ui.cordis.yml` to remove Nook UI contributions while debugging.

## Release gate

Workspace-link success is insufficient. Build and test, pack every Nook package, install the tarballs plus exact external versions into a clean temporary Profile, dump the final composition, boot it, and run smoke acceptance before declaring a release ready.
