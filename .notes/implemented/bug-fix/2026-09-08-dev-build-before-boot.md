# Agent Note: Build development artifacts before Profile boot

Status: implemented

## Problem

The development Profile links Nook packages whose entry points target ignored build output under `lib/`. Installing dependencies does not produce that output. Launching an unbuilt workspace fails with `ERR_MODULE_NOT_FOUND` for Nook plugins, and launching after source edits can serve stale Host code or Client bundles.

## Decision

The [shared development launcher](../../../scripts/run-profile.mjs) awaits the repository build before preparing the Profile, releasing the target port, or starting DSH. Both normal and Safe UI startup use this path. A build failure prevents boot and preserves an existing listener. The [quick start](../../../README.md#quick-start) describes the startup behavior.

## Alternatives considered

Requiring a manual build in the quick start leaves the ordinary development command dependent on an easily missed prerequisite and does not refresh output after source edits.

Building only when an entry point is missing addresses a clean checkout but leaves stale output undetected. Running the existing incremental TypeScript build and Client bundler on each launch keeps one build definition.

## Validation

The [launcher integration tests](../../../tests/integration/dev-startup.test.ts) execute the real launcher scripts in disposable workspaces. An artifact consumer verifies missing and stale Host/Client output in both modes, and a failing build prevents consuming existing output. The [Profile acceptance tests](../../../tests/e2e/profile-boot.test.ts) cover actual pinned DSH boot and the rendered application; the [package gate](../../../scripts/verify-package.mjs) checks isolated tarball installation.

## Consequences

Each dev launch includes build time and reports compiler or bundler errors before runtime startup. This does not add a watcher; source changes require restarting dev. DSH source, installed packages, and the real user DSH home are unaffected.
