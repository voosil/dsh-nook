# Agent Note: Separate live development from fixed-build usage

Status: implemented

## Problem

A launcher that only builds on startup requires manual rebuilds after every source edit. Enabling reload for every runtime interrupts the application when it edits its own code, and sharing live build output can change a supposedly stable instance after a browser refresh.

## Decision

[Development and usage](../../../docs/development.md) have separate launchers, ports and data lifetimes. Development uses the official Client HMR overlay and serial source polling with Host restarts after successful builds. Client bundling publishes only after all bundles compile, replacing individual files atomically.

Usage installs packed packages and their pinned dependencies independently, then boots that snapshot against the persistent application home. Its working directory remains the repository for self-iteration. The [shared snapshot installer](../../../scripts/profile/pack-profile.mjs) also serves the clean-package gate. Automatic port eviction is excluded from both launchers to preserve concurrently running instances.

The [startup build decision](../bug-fix/2026-09-08-dev-build-before-boot.md) remains applicable; the development watcher extends that initial build into an ongoing loop.

## Alternatives considered

Running without a watcher against workspace links leaves Client assets and lazy imports exposed to subsequent builds. A separate installed snapshot supplies the required isolation.

Reloading the whole application after every edit resets more state than the official Client plugin lifecycle requires. Client-only edits remount the affected plugin; Host changes use process restart because they can change the service graph.

Native recursive watching has failed on the verified linked workspace. Polling avoids that dependency and observes file creation, deletion and atomic editor saves. A serial loop captures edits during builds without concurrent rebuilds.

## Validation

Watcher integration covers queued edits, build failure recovery, Client/Host classification and disposal. Real Chrome acceptance runs development and usage simultaneously in a copied temporary workspace, verifies repeated UI changes without document reload, and refreshes usage to confirm its snapshot stays unchanged. Startup and packed-install acceptance share the shipping paths.

## Consequences

Usage startup includes a clean dependency installation. Development data is disposable and Client plugin state can reset on remount. Explicit dependency or launcher changes need preparation and a launcher restart. Application data and the upstream installation are not modified by development verification.
