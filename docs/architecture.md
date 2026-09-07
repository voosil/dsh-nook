# Nook architecture

The runnable Nook application is the `nook` Profile. Its ordered layers are the official base and Web Bundles, the pinned community browser compatibility Bundle, and the Nook Product Bundle. The [composition root](../packages/app-all/cordis.patch.yml) owns provider activation; package dependencies alone do not activate services.

## Capability map

| Contract                                                     | Responsibility                                | Default implementation                     |
| ------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------ |
| [Project](../packages/capability-project/src/index.ts)       | The single optional classification of notes   | Local project provider                     |
| [Note](../packages/capability-note/src/index.ts)             | Versioned Markdown and provenance             | Local notebook provider                    |
| [Knowledge](../packages/capability-knowledge/src/index.ts)   | Search evidence and session preferences       | Local notebook provider                    |
| [Generation](../packages/capability-generation/src/index.ts) | Model catalog and cancellable text generation | DSH intelligence adapter                   |
| [Video](../packages/capability-video/src/index.ts)           | Separate collection, review and writing seams | Platform adapter and video editor provider |
| [Artifact](../packages/capability-artifact/src/index.ts)     | Stored output bytes                           | Local artifact provider                    |
| [Browser](../packages/capability-browser/src/index.ts)       | Browser sessions for preview                  | Community browser adapter                  |

Capability packages contain DTOs, errors, events and interfaces. Features depend on these contracts. The notebook provider shares one transaction owner between note persistence and retrieval indexing. Reflection and video orchestrate capabilities; the knowledge conversation adapter can operate without either feature.

## Host and Client

Host plugins own persistence, subprocesses, model requests and workflow lifetimes. Client plugins contribute through additive official Slots. The notes workspace uses the shell overlay and sidebar footer; the knowledge toggle uses session header actions. Nook-owned, schema-validated JSON DTOs cross the verified DSH Typert Gateway. No Session, Cordis service or React element crosses the boundary.

The [notes contract](../packages/feature-notes/README.md), [knowledge contract](../packages/adapter-knowledge-dsh/README.md) and [video contract](../packages/feature-video/README.md) own configuration and behavior. The [decision note](../.notes/implemented/feature/2026-09-07-minimal-nook.md) records scope and alternatives. External runtime contracts belong in [discovery](discovery.md).

## External boundaries

The browser adapter consumes `dsh-browser-playwright` through its public service contract. Its Agent-facing Tool plugin is not a business API. The video platform adapter owns third-party collection details and a Python process boundary. Both expose Nook capabilities to features. The generation and knowledge adapters own DSH model and prompt contracts.
