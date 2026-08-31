# Nook architecture

The runnable Nook application is the `nook` Profile. Its ordered layers are two official Bundles, the pinned community compatibility Bundle, and `@nook-dsh/app-all`, the Product Bundle.

```text
nook profile
├─ @deepseek-ai/dsh-base              official
├─ @deepseek-ai/dsh-web-app           official
├─ adapter-browser-community          community compatibility Bundle
│  ├─ dsh-browser-playwright/service  browser (community public seam)
│  ├─ dsh-browser-playwright/playwright
│  └─ adapter-browser-community       nookBrowser
└─ @nook-dsh/app-all                  product composition root
   ├─ provider-project-local          nookProjects
   ├─ provider-artifact-local         nookArtifacts
   ├─ feature-project                 nookProjectFeature
   ├─ feature-preview                 nookPreview
   ├─ dsh-adapter                     verified DSH Tool boundary
   ├─ feature-agent                   Nook Agent-facing Tools
   ├─ ui-project                      conversation header contribution
   └─ ui-sidebar                      sidebar footer contribution
```

`provider-artifact-local` is intentionally added beyond the minimum requested tree. The Artifact Capability otherwise had no implementation, which would leave preview output coupled to an unrelated package.

## Capability map

| Capability | Contract owner        | Default provider            | Consumers                                       |
| ---------- | --------------------- | --------------------------- | ----------------------------------------------- |
| Project    | `capability-project`  | `provider-project-local`    | project feature, preview feature, Agent adapter |
| Artifact   | `capability-artifact` | `provider-artifact-local`   | preview feature                                 |
| Browser    | `capability-browser`  | `adapter-browser-community` | preview feature                                 |

Capability packages contain DTOs, errors, events, and interfaces only. Provider activation remains a Profile/Bundle concern.

## Host and Client

Host plugins own project state, artifact bytes, browser sessions, Tools, and lifecycle. Client plugins contribute render-only controls to verified official Slots. The first version deliberately exposes no custom RPC: the UI shows a Nook identity/projection entry without smuggling Host objects across the boundary. A future RPC must use Nook-owned JSON-safe DTOs and a verified current DSH Typert route.

## External provider classification

`dsh-browser-playwright@0.1.1` is consumed through its public `./service` contract. Nook mounts only its service and Playwright provider entries; it does not use the package's Agent-facing Tool plugin as a business API. The Adapter is the only Nook package allowed to import this third-party service.
