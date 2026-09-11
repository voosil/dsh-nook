# Nook architecture

Nook runs as a DSH Profile. The [composition root](../packages/app-all/cordis.patch.yml) owns Bundle ordering and Provider activation; package dependencies alone do not activate services. The pinned runtime and shared integration contracts belong to [discovery](discovery.md).

## Dependency boundaries

Features depend on Nook Capability contracts; Providers and Adapters implement those contracts. Capability packages own JSON-safe DTOs, errors and interfaces. Third-party private or unstable APIs stay inside dedicated Adapters. Locate concrete activation in the Profile and implementation in the affected package rather than maintaining a parallel feature map here.

Host plugins own persistence, subprocesses, model requests and workflow lifetimes. Client plugins contribute through verified additive Slots. Nook-owned, schema-validated DTOs cross the authenticated DSH Gateway; Sessions, Cordis services and React elements do not cross this boundary.

## Storage and process ownership

The notebook Provider owns the shared SQLite transaction for business projections, retrieval indexes and versioned replica records. Synchronization orchestration consumes the Sync Capability; HTTP storage and merge algorithms are isolated in Adapters. Business data and its pending versions commit together. Module-specific protocol constraints belong to the [sync contract](../packages/feature-sync/README.md).

Local Providers and maintenance commands share the backup library. Recovery and deletion boundaries belong to [data protection](backup.md); new storage mutations must preserve those guarantees.

Web and desktop launchers share a backend through a local broker outside the Host. Runtime snapshots, process-tree ownership and data locations belong to [runtime](runtime.md). Development and acceptance use [isolated homes](development.md). The desktop loads the authenticated Web Client in a sandboxed Electron window; it does not move business services into the renderer.
