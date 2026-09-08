# Verified migration cases

## 0.1.1-rc.2 → 0.1.3-alpha.2: removed Client runtime

Symptom: installation fails with `ERR_PNPM_NO_MATCHING_VERSION` for `@deepseek-ai/dsh-client-runtime@0.1.3-alpha.2`.

Cause: the target removes that package. Official Client plugins use Cordis `Context`; the renderer owns the Slot service augmentation. Nook's UI plugins need that augmentation and the renderer's activation dependency.

Resolution: replace the old type import with `Context as ClientContext` from Cordis plus a type-only import of `@deepseek-ai/dsh-client-ui-renderer/client`. Replace the old package references in Nook peers, Client injection metadata, workspace catalog, bundler externals and packed-install dependencies with the renderer where applicable. Inspect each consumer rather than treating renderer as a general substitute for the removed runtime's other services.

Evidence: [official Client example](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.3-alpha.2/packages/client/ui-brand-official/src/client/index.ts), [renderer contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.3-alpha.2/packages/client/ui-renderer/src/client/index.ts). `pnpm typecheck`, `pnpm build`, contract tests and full browser acceptance pass after the migration.

## 0.1.1-rc.2 → 0.1.3-alpha.2: native session locking

Symptom: pnpm finishes resolution but exits with `ERR_PNPM_IGNORED_BUILDS` for `fs-ext@2.1.1`.

Cause: the new JSONL session persistence uses POSIX file locks through a native addon. The repository permits dependency builds individually.

Resolution: verify the dependency and its install script, then permit `fs-ext` in the workspace, generated development Profile and clean-package Profile build policies. Install again and verify actual Profile boot. pnpm can insert a placeholder build-policy row after failure; replace that row instead of adding a duplicate YAML key.

Evidence: [session lease implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.3-alpha.2/packages/session/session-persistence-jsonl/src/lease.ts). Standard installation builds the addon successfully on the verified macOS/Node environment; `pnpm test:e2e` and `pnpm verify:package` pass. Other platforms require their own verification.

## 0.1.1-rc.2 → 0.1.3-alpha.2: authenticated browser startup

Symptom: Profile boot prints its URL, but the HTTP shell acceptance receives 401.

Cause: readiness URLs include a process token. Stripping the query loses the token-to-cookie exchange; Node fetch also does not maintain a browser cookie jar across redirects.

Resolution: parse the complete readiness URL, exchange it with redirects disabled, verify HTTP 303 and the cookie, and request the clean origin with that cookie. Browser acceptance navigates to the complete launch URL. Return only the clean origin in reports and redact tokens from failure logs. Keep authentication enabled.

Evidence: [official frontend acceptance](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.3-alpha.2/packages/host/frontend-static/tests/frontend-static.spec.ts), [Nook runtime acceptance](../../../../scripts/runtime-verify.mjs). `node --import tsx --test tests/e2e/profile-boot.test.ts` passes both full and Safe UI boots; `pnpm verify:package` passes all 29 packed packages and the notebook workflow.

## pnpm 12.1.0: explicitly selected fresh prereleases

An explicitly requested release can be younger than pnpm's minimum release age. pnpm records exact package/version exceptions in the workspace. Keep exceptions scoped to the requested release; do not globally disable the age policy. This pnpm version rejects a name glob combined with a version in `minimumReleaseAgeExclude`; retain explicit entries instead of inventing a compact unsupported pattern.

A sandboxed `pnpm run` may attempt dependency verification and network access before executing the script. Finish the authorized install with the required network permissions; distinguish resolver failures from TypeScript or product failures. Direct installed compiler commands can diagnose code while dependency setup is being completed.
