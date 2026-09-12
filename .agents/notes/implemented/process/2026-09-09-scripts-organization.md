# Agent Note: Organize repository scripts by responsibility

Status: implemented

## Problem

A flat scripts directory mixes launchers, build tooling, acceptance checks and shared helpers, making related maintenance work harder to locate.

## Decision

Group scripts by responsibility using the layout documented in the [development guide](../../../../docs/development.md#repository-scripts). Preserve filenames and public package commands. Update imports, repository-root resolution, test fixtures and documentation links together so the organization applies to both real commands and disposable verification workspaces.

## Alternatives considered

Keeping the flat directory and adding a file index preserves paths but leaves unrelated concerns mixed together. Retaining forwarding scripts at the old paths adds duplicate entry points without a repository compatibility requirement.

## Consequences

Direct script callers use the categorized paths; package command names and runtime behavior stay stable. Existing launcher, backup, Profile boot and package acceptance checks cover the moved entry points, alongside typechecking, builds and documentation checks.

## Validation

Formatting, documentation links, boundary checks, typechecking and builds pass. All 48 contract/desktop tests, 18 integration tests and 3 end-to-end tests pass, as do Profile composition and peer-policy checks. Clean-package acceptance verifies 35 installed Nook packages, 25 Profile rows and the browser workflow. Integration and package checks run with local-listener and network access after the sandbox rejects those operations.
