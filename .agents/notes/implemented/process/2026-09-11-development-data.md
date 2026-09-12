# Agent Note: Persistent development data and repeatable examples

Status: implemented

## Problem

An empty application on every launch forces developers to recreate projects, notes, task states and model configuration before investigating a UI or business-flow issue. Sharing formal data with actively changing code would make normal usage depend on development experiments.

## Decision

The [development guide](../../../../docs/development.md) defines persistent isolated homes, repeatable example creation and an explicit disposable empty mode. The launchers retain business data and configuration while refreshing generated Profile metadata and dependency links. A per-home launcher lock covers preparation, seeding and runtime lifetime; preparation failure preserves persistent data. The [native file lock adapter](../../../../scripts/shared/native-file-lock.mjs) uses the pinned `fs-ext` dependency already used by the desktop broker, verified in the installed DSH base/persistence manifests and addon source. Windows uses `LockFileEx`; POSIX uses `flock`. The OS releases the lock when its owning process exits, including forced termination, so leftover files cannot permanently block development startup. Legacy owner metadata is retained but no longer consulted; old launchers must be stopped once when changing protocols.

The seed composes local Nook providers, uses the notebook business service and writes task fixtures through the validated Capability store. It does not mount remote sync, a scheduler or an execution provider. Stable note and task IDs plus per-project receipts preserve manual edits on repeated seeding. The examples include safe manual and unassigned task states; they create no automatic agent jobs.

A small authenticated notebook RPC reports whether the runtime is development. The frontend disables sync navigation and guide deep links and avoids sync polling while disabled. This implements the requested UI-only restriction without changing backend sync behavior or compiling separate Client bundles. Existing [live development and fixed usage](../feature/2026-09-08-development-modes.md) remain separate.

## Alternatives considered

Seeding a fresh temporary home on every launch improves initial content but still loses model configuration and the current debugging state. Persistent homes address both problems; disposable empty mode remains explicit.

Reusing or copying formal data would carry historical configuration and sync bindings into development. Independent homes and synthetic examples require no user-data migration or cleanup.

A backend sync prohibition adds policy and failure paths beyond the requested frontend restriction. A build-time flag also risks changing a concurrently served Client bundle, so the flag belongs to each runtime.

Reclaiming directory locks by PID or elapsed time retains stale-lock failure modes: incomplete metadata, reused PIDs and concurrent reclaimers require further recovery rules. Kernel-owned file locks avoid those decisions and require no heartbeat, timeout or manual deletion. Removing exclusion altogether would allow simultaneous launchers to rewrite the same development Profile and seed data.

## Validation

Launcher integration checks restart persistence, configuration retention, disposable cleanup, seed-only startup, locking and preparation failure. Real SQLite fixture tests check search, task states, repeat seeding and preservation of edits and trash. Browser acceptance checks populated development UI, disabled sync navigation, guide deep links and working appearance settings. Formal Profile and clean-package acceptance cover the same RPC and Client bundle with sync enabled.

The [native lock tests](../../../../tests/integration/runtime/dev-lock.test.ts) cover path aliases, idempotent release, actual cross-process contention and repeated forced-exit recovery. [Launcher integration](../../../../tests/integration/runtime/dev-startup.test.ts) boots through empty/malformed/obsolete legacy metadata and verifies that a force-killed sandbox owner permits subsequent launches without losing saved data. Native semantics are also documented by [fs-ext](https://github.com/baudehlo/node-fs-ext), [Windows LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex) and [flock](https://man7.org/linux/man-pages/man2/flock.2.html).

## Consequences

Development homes occupy disk across launches. Resetting a disposable session does not delete retained development data. The native lock file remains on disk but is not itself an ownership marker; never unlink it during normal cleanup. This coordinates development launcher lifetime, not arbitrary external writers or independently orphaned runtime descendants. Frontend disabling is not a backend security boundary; development starts with independent, unbound sync configuration.
