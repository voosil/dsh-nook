# Agent Note: Windows Web startup and filesystem lifecycle

Status: implemented

## Problem

The formal Web launcher depends on macOS desktop staging. Windows also rejects Unix socket filesystem operations, negative process-group signals, directory fsync, and read-only file fsync. These assumptions prevent startup, restart backups and sync writes even when the pinned DSH runtime is installed.

## Decision

Windows Web startup installs all packed Nook packages and pinned external dependencies directly into a unique final runtime directory. The Node running the source launcher also runs package installation and DSH, keeping native modules on the same ABI. Absolute Windows junctions remain at their installation location. The shared broker activates the writable Profile only after acquiring its runtime lock, preserving user configuration and data. macOS retains its portable desktop seed. Platform scope and user paths belong to the [runtime guide](../../../../docs/runtime.md).

Named pipes use a case-folded canonical state identity and skip Unix-only socket inspection and chmod. The supervisor uses a dedicated [Windows Job adapter](../../../../apps/desktop/src/windows-job.ts). A Nook preload waits for assignment to the Job before the DSH CLI runs; parent IPC then invokes the CLI's verified SIGTERM handlers. Closing the Job kills remaining descendants, including on supervisor death. Builds and package installation remain owned by the launcher's process scope. All native handles and process listeners have explicit cleanup.

The [filesystem adapter](../../../../packages/storage-backup/src/durability.ts) opens files with write access when flushing on Windows and publishes through `MoveFileExW` with write-through semantics. POSIX retains file and directory fsync. Backup, migration, sync blobs and sync settings share the same primitives; sync's business contracts still use Capability services. Native calls use the declared Koffi dependency, not private upstream modules. Windows ACLs are inherited from the containing user directory; mode-bit assertions apply only on POSIX.

Node's Windows recursive mkdir result can include the extended-path prefix even when the input does not. Directory-fsync traversal therefore only runs on POSIX, avoiding an unmatched stop path on Windows. The documentation checker accepts both LF and CRLF, and subprocess test imports use file URLs.

Windows can return `EACCES` when another process has bound the default port without a listening socket. This occurred with `verge-mihomo` on 3081 and was missed by the initial acceptance's explicit port 0. The [port selector](../../../../scripts/profile/web-port.mjs) serves both Web usage and development before preparing a new runtime on every platform: an unavailable explicit port fails with an actionable error, while an unavailable default probes the following ten ports and uses the first free one, falling back to OS-assigned port 0 when none of them is free. Development's default 3080 also returns `EACCES` in the verified environment. The development launcher selects a concrete available port before boot and retains it across Host restarts. Existing shared backends retain their port. The probe closes its socket; it does not reserve the port across startup or modify the existing owner.

## Alternatives considered

Copying the macOS portable payload workflow to Windows requires relocating absolute pnpm junctions and distributing another Node runtime. The source Web entry already requires Node, so a final-location package snapshot is smaller in scope and preserves fixed-build behavior.

Forcing only the DSH parent process to exit can orphan workers. IPC requests graceful disposal and a kernel Job provides independent descendant cleanup. Runtime assignment happens before executing the CLI, avoiding a child-spawn race.

Ignoring all filesystem flush failures would also hide failed file writes. Only the unsupported Windows directory operation is excluded; regular-file flush and native publication failures still abort mutation. Backup contents remain checksum-verified.

Falling straight back to OS-assigned port 0 was the initial fix for an unavailable default but produced unpredictable URLs and was wired for Windows only. Probing the following ports first keeps near-default ports such as 3081 and 3082 deterministic on every platform, and only the exhausted scan still defers to the OS. Terminating the existing listener through the [port release helper](../../../../scripts/shared/release-port.mjs) was rejected because the selector must never stop an owner it did not create, such as the user's other development session.

## Consequences

Windows source startup needs Node, Corepack/pnpm, access to package dependencies, and native build prerequisites. Runtime snapshots are retained and are not portable distributions. Windows desktop installer production remains outside this change. Explicit temporary test state never imports legacy repository usage data.

The [Windows acceptance](../../../../scripts/verify/verify-windows-start.mjs) passes on Node 22.20.0 / Windows x64: complete launcher, all packed Nook packages, authenticated browser notebook operations and sync, shared leases, repeated startup, preserved cookies on the same authority, verified backups, and released ports/data locks. The relevant regression suite reports 45 passing tests and one optional Apache integration skipped. Build/typecheck, documentation, package boundaries and peer policy pass. Windows process-tree tests run with normal process permissions because the restricted execution sandbox prevents taskkill enumeration.

The acceptance now also passes with no initial port override while 3081 is unavailable. Two [port selection tests](../../../../tests/contract/web-port.test.ts) cover upward scanning of unavailable defaults, explicit-port errors, OS-assigned fallback and probe cleanup against a real occupied socket.

The broader suite also reports unrelated environment failures for Python3 execution, a PowerShell port-inspection timeout and GNU tar handling of a Windows drive path. Those failures are outside the Web startup acceptance; no full-suite success is claimed. Failed probes use disposable temporary homes, and formal user data is not opened during verification.

The native structures and publication flags follow [Microsoft's Job limit contract](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information), [extended limit structure](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information), and [MoveFileExW contract](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw). The pinned DSH CLI and JSONL package are inspected in place; no upstream source or installed package is patched.
