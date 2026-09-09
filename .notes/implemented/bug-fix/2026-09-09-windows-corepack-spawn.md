# Agent Note: Windows Corepack process launch

Status: implemented

## Problem

The start and development launchers spawn `corepack` directly. Windows installations expose command shims, so the build fails with `spawn corepack ENOENT` even when Corepack is installed.

## Decision

The shared [command resolver](../../../scripts/shared/corepack-command.mjs) locates Corepack on Windows through package manifests under PATH directories or beside the current Node executable. It runs the declared CLI through Node with an argument array. Unix retains executable lookup. Both scoped launcher processes and Profile package operations use this resolver and retain the pinned pnpm version.

## Alternatives considered

Enabling a shell handles command shims but introduces shell parsing for paths and arguments. Launching the declared JavaScript entry preserves argument boundaries without a shell.

## Consequences

Corepack must be installed in a standard Node/npm layout. Missing installations receive an actionable error. Windows startup uses the separate [fixed Web snapshot workflow](2026-09-09-windows-web-start.md); [desktop Node staging](../../../scripts/desktop/desktop-node.mjs) remains specific to macOS arm64.

Regression tests cover Unix invocation, Windows manifest lookup, paths with spaces, literal shell metacharacters, and missing installations. Both tests pass on Windows, as do real pinned pnpm invocations through both callers, the repository build (including typechecking), package boundary checks, and packing the note capability into a disposable temporary directory.

Windows filesystem, lifecycle and CRLF validation decisions belong to the [Windows startup note](2026-09-09-windows-web-start.md).
