# Agent Note: Upgrade the pinned DSH runtime and retain migration evidence

Status: implemented

## Problem

A DSH release changes package availability, context ownership, native dependencies and browser startup contracts. A successful workspace compile does not establish compatibility for an installed Nook application.

## Decision

The shared runtime baseline lives in [discovery](../../../../docs/discovery.md); local integration contracts live in the affected package READMEs. Root and package dependency pins, the compatibility guard, Profile generation and packed-install dependencies move together. Client plugins use public Cordis and renderer types. Runtime acceptance follows the official browser login flow.

The [upgrade skill](../../../skills/dsh-upgrade/SKILL.md) makes evidence collection and its own maintenance part of each upgrade. Version-scoped cases record confirmed causes and validation; unresolved facts stay explicit.

## Alternatives considered

Updating only the CLI leaves mixed peers and references to a removed Client package. Exact graph verification and clean installation expose these mismatches.

Disabling browser authentication hides the changed startup contract. Acceptance exchanges the official launch token for a cookie instead.

A general automatic updater cannot establish Nook plugin compatibility. The skill guides authorized upgrades and records demonstrated migration issues; it does not initiate upgrades in the background.

## Validation

Typecheck, Client builds and all 18 contract tests pass. Provider and launcher integrations pass. Full and Safe UI browser boots pass, including notebook operations. Clean-package verification covers 29 tarballs and 23 Nook Profile rows. Peer checks retain only the two reviewed community-browser warnings.

## Consequences

Each upgrade includes maintaining the skill and its evidence. Browser launch links retain their authentication query, and installers build the session-lock native addon. No upstream or installed source is patched.
