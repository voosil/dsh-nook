---
name: dsh-upgrade
description: Upgrade Nook's pinned DeepSeek Harness release, migrate verified public contracts, validate linked and packed Profiles, and incorporate newly verified migration lessons into this skill. Use for DSH version or release-tag upgrades in this repository.
---

# Upgrade Nook's DSH runtime

Apply the [DSH development workflow](../dsh-plugin-development/SKILL.md). Read the current [discovery baseline](../../../docs/discovery.md), affected manifests, package READMEs and existing upgrade notes before changing versions. Place current facts under the [documentation standard](../../../docs/AGENTS.md); this skill owns the upgrade procedure and version-scoped troubleshooting.

## Resolve and migrate

1. Resolve the user's requested release tag to an npm version and immutable source commit. Inspect the target release's manifests and published metadata. Do not substitute `latest`, assume all old package names still exist, or carry forward the previous Cordis/Schemastery pins.
2. Inventory root dependencies, workspace catalogs, package peers and Client metadata, the compatibility guard, Profile generation and clean-package verification. Upgrade these together. Preserve unrelated working changes.
3. Install through the package manager, then inspect the target's installed exports, types, manifests and implementation before adapting Nook. Read [migration cases](references/migration-cases.md) when an install, build, boot or browser check fails. Confirm each case still applies to the target version; cases are evidence, not universal fixes.
4. Inspect every resolved `@deepseek-ai/*` version in the lockfile. Use the repository's Profile override generation to keep linked and packed installs on that verified graph. If DSH packages resolve to mixed releases, correct resolution before relaxing the guard. Peer warnings are acceptable only within the reviewed community-provider policy.
5. Refresh the isolated development Profile after dependency changes. Keep the non-watching usage runtime on its own built snapshot; do not replace a running application while performing an upgrade unless the user authorized that restart.

## Verification and reporting

Run the repository's current typecheck/build, contract tests, Provider integrations, full Profile composition, real-browser acceptance, peer and boundary checks, and clean packed-install gate. Consult [package scripts](../../../package.json) for the current commands. Compiler success alone does not prove browser service activation, authentication or module compatibility. Validate both development and non-watching launch modes when their contracts change.

Update the owning Agent Note, shared discovery baseline and affected package contracts with the verified target and remaining `UNKNOWN` items in their respective homes. Report failures as failures; a blocked browser or package gate is not a completed upgrade. Redact tokens, cookies and credentials in diagnostics and notes.

## Self-maintenance is part of each upgrade

Whenever this workflow encounters a new upgrade-specific problem, update this skill in the same authorized change without a separate reminder:

- Put stable decision rules in this entrypoint; put version-specific symptoms in [migration cases](references/migration-cases.md).
- Record the applicable source/target versions, observable symptom, confirmed cause, smallest verified Nook change, exact verification command/result, and a source or test link. A guess stays `UNKNOWN` with the next check needed; never turn it into a required fix.
- Merge into an existing matching case. Narrow or retire advice contradicted by newer evidence, preserving useful version boundaries. Do not append a chronological log or copy whole upstream manuals.
- Fix a meaningful regression test at the real failing boundary when feasible. Never weaken acceptance, disable authentication, widen compatibility ranges or modify installed/upstream source merely to make an upgrade pass.
- Validate skill frontmatter and links, run `pnpm docs:check`, and include skill changes in the final report. If permissions prevent writing the skill, retain the proposed update as a reviewable artifact and report that limitation.

This is an obligation for the agent performing an upgrade, not a background service. It does not authorize a different release, publishing, committing, pushing, or unrelated global configuration changes.
