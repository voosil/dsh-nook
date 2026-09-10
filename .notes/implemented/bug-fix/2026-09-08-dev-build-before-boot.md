# Agent Note: Build development artifacts before Profile boot

Status: implemented

## Problem

The development Profile links Nook packages whose entry points target ignored build output under `lib/`. Installing dependencies does not produce that output. Launching an unbuilt workspace fails with `ERR_MODULE_NOT_FOUND` for Nook plugins, and launching after source edits can serve stale Host code or Client bundles.

An existing Profile directory also does not guarantee current dependency links. Adding update packages exposed this: a refreshed manifest declared `capability-update`, but the cached module directory omitted its link, so temporary Profile creation failed with `ENOENT`.

## Decision

The [shared development launcher](../../../scripts/profile/run-profile.mjs) awaits the repository build before preparing the Profile or starting DSH. The [runtime modes](../feature/2026-09-08-development-modes.md) define subsequent watching and port ownership. Both normal and Safe UI startup use this path. A build failure prevents boot. The [quick start](../../../README.md#quick-start) describes the startup behavior.

Each startup refreshes the generated Profile manifest and awaits dependency installation before creating the temporary Profile. Existing user patches remain intact. Installation failure prevents boot, and the launcher's process scope owns installation cancellation.

## Alternatives considered

Requiring a manual build in the quick start leaves the ordinary development command dependent on an easily missed prerequisite and does not refresh output after source edits.

Building only when an entry point is missing addresses a clean checkout but leaves stale output undetected. Running the existing incremental TypeScript build and Client bundler on each launch keeps one build definition.

Requiring manual `pnpm dev:profile` after membership changes leaves ordinary startup fragile after pulling new code. Checking only for a module directory or a manifest change misses a refreshed manifest with incomplete links. Running the existing incremental installation on each launch handles both without separate cache state.

## Validation

The [launcher integration tests](../../../tests/integration/dev-startup.test.ts) execute the real launcher scripts in disposable workspaces. An artifact consumer verifies missing and stale Host/Client output in both modes, and a failing build prevents consuming existing output. The [Profile acceptance tests](../../../tests/e2e/profile-boot.test.ts) cover actual pinned DSH boot and the rendered application; the [package gate](../../../scripts/verify/verify-package.mjs) checks isolated tarball installation.

Launcher regression tests use real local dependency installation to cover missing links with stale and current manifests, plus installation failure before boot. The actual development command and browser smoke check validate the linked product Profile.

## Consequences

Each dev launch includes build and incremental dependency installation time, and reports preparation errors before runtime startup. The [development mode](../feature/2026-09-08-development-modes.md) owns subsequent source watching and rebuilding. DSH source and the real user DSH home are unaffected.
