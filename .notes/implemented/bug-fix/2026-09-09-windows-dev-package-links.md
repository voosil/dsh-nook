# Agent Note: Windows development Profile package links

Status: implemented

## Problem

Development builds successfully on Windows but the temporary Profile fails to load community and Nook plugins with `ERR_MODULE_NOT_FOUND`. A junction of the installed Profile's entire module directory exposes relative pnpm links through a different parent path. Reading those packages through the temporary path fails even though they resolve in the installed Profile.

## Decision

The [development sandbox](../../../scripts/profile/dev-sandbox.mjs) creates its own module directory and resolves each declared dependency to its real installed directory before creating an absolute package junction. Package contents remain linked for development rebuilds. DSH's generated fallback entries belong to the temporary Profile rather than the shared installation. Preparation failure and launcher disposal remove only the disposable home.

The pinned app-boot source verifies that DSH supplements Profile module directories with owned fallback links. Keeping the container local respects that behavior without changing the runtime or installed packages. Runtime behavior belongs to the [development guide](../../../docs/development.md#development); the broader mode decision remains in the [development modes note](../feature/2026-09-08-development-modes.md).

## Alternatives considered

Linking the whole module directory is shorter but fails the Windows reproduction and lets temporary fallback writes reach the shared Profile. Copying or reinstalling every package adds startup work and separates development from live workspace artifacts. Individual resolved package links retain those artifacts and isolate the writable container.

## Validation

The [startup integration tests](../../../tests/integration/dev-startup.test.ts) reproduce the missing-package failure through a relative scoped package link before the fix. Normal and Safe UI launches then pass with missing and stale build output, resolve the linked plugin, and keep a simulated fallback write out of the installed Profile. Build failure still prevents boot.

Windows acceptance passes on Node 22.20.0: the default `pnpm dev` starts after applying the [shared port policy](2026-09-09-windows-web-start.md), and its temporary home is removed after the test runtime exits. Twelve launcher, port and watcher tests and both real Profile boot tests pass, including browser notebook operations. Build/typecheck, formatting, documentation and package boundaries pass. Clean-package acceptance passes for all 35 Nook packages and 25 Profile rows with authenticated HTTP 200 and browser acceptance; dependency installation requires normal network permissions after sandbox DNS requests fail.

## Consequences

The installed development Profile must contain its declared dependencies. Dependency changes retain the documented Profile preparation workflow. The temporary home owns only links and development data; package contents remain at their original installation paths.
