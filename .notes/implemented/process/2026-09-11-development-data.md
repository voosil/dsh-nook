# Agent Note: Persistent development data and repeatable examples

Status: implemented

## Problem

An empty application on every launch forces developers to recreate projects, notes, task states and model configuration before investigating a UI or business-flow issue. Sharing formal data with actively changing code would make normal usage depend on development experiments.

## Decision

The [development guide](../../../docs/development.md) defines persistent isolated homes, repeatable example creation and an explicit disposable empty mode. The launchers retain business data and configuration while refreshing generated Profile metadata and dependency links. A per-home launcher lock covers preparation, seeding and runtime lifetime; preparation failure preserves persistent data.

The seed composes local Nook providers, uses the notebook business service and writes task fixtures through the validated Capability store. It does not mount remote sync, a scheduler or an execution provider. Stable note and task IDs plus per-project receipts preserve manual edits on repeated seeding. The examples include safe manual and unassigned task states; they create no automatic agent jobs.

A small authenticated notebook RPC reports whether the runtime is development. The frontend disables sync navigation and guide deep links and avoids sync polling while disabled. This implements the requested UI-only restriction without changing backend sync behavior or compiling separate Client bundles. Existing [live development and fixed usage](../feature/2026-09-08-development-modes.md) remain separate.

## Alternatives considered

Seeding a fresh temporary home on every launch improves initial content but still loses model configuration and the current debugging state. Persistent homes address both problems; disposable empty mode remains explicit.

Reusing or copying formal data would carry historical configuration and sync bindings into development. Independent homes and synthetic examples require no user-data migration or cleanup.

A backend sync prohibition adds policy and failure paths beyond the requested frontend restriction. A build-time flag also risks changing a concurrently served Client bundle, so the flag belongs to each runtime.

## Validation

Launcher integration checks restart persistence, configuration retention, disposable cleanup, seed-only startup, locking and preparation failure. Real SQLite fixture tests check search, task states, repeat seeding and preservation of edits and trash. Browser acceptance checks populated development UI, disabled sync navigation, guide deep links and working appearance settings. Formal Profile and clean-package acceptance cover the same RPC and Client bundle with sync enabled.

## Consequences

Development homes occupy disk across launches. Resetting a disposable session does not delete retained development data. A crash leaves an explicit lock for inspection. Frontend disabling is not a backend security boundary; development starts with independent, unbound sync configuration.
