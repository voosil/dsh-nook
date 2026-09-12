# Agent Note: Preserve notebook state across shell navigation

Status: implemented

## Problem

Switching from a selected note to an AI conversation or the task workspace discards the notebook page. Returning starts with the default list and welcome screen. The Client entry conditionally renders the entire notebook tree, so hiding the overlay destroys navigation state, scroll positions and editor history together.

## Decision

The [Client entry](../../../../packages/ui-notes/src/client/index.tsx) keeps one notebook instance mounted within the existing official Slot lifecycle and passes visibility to the [workspace](../../../../packages/ui-notes/src/client/components/notebook-app.tsx). A hidden workspace uses inline `display: none`, which takes precedence over its flex layout and hides its descendant portals. Reopening focuses the workspace without scrolling and refreshes Host data, retaining the editor instance when its revision is unchanged. Pending edits continue to use the existing save guard.

The [sync control](../../../../packages/ui-notes/src/client/components/sync-control.tsx) closes its controlled modal while the workspace is hidden. This releases focus and modal restrictions for the AI composer while preserving the selected settings section and configuration state. Polling and subscriptions remain bounded by their existing React and Cordis cleanup functions.

The pinned layout runtime renders `shell.overlay` independently of the selected conversation in its installed Client bundle. The repair therefore uses the existing additive contribution and requires no DSH changes or new external contracts. The current UI behavior belongs to the [UI package standard](../../../../docs/ui-packages.md).

## Alternatives considered

Persisting only the selected note ID and filters outside React restores part of the page but still discards scroll positions, editor undo history and nested form state. Serializing all of those states introduces separate restoration paths for each component. Keeping the existing tree matches the navigation lifetime directly.

Hiding the tree without closing the settings modal leaves its global focus and interaction restrictions active when the sync setup flow opens an AI conversation. Visibility therefore also controls the modal's open state.

## Consequences

Navigation retains an in-memory notebook tree until Client disposal; refreshes and application restarts remain outside this scope. No persistent data format or Host contract changes. Hidden sync polling continues, and returning checks current Host revisions before showing stale content indefinitely.

The [browser regression](../../../../tests/e2e/notes/notes-navigation.test.ts) uses a temporary DSH home with 55 notes. It covers return-button, Escape and task-page navigation, selection, project filtering, search, sorting, second-page retention, editor scrolling, undo history, project view and trash view. The [shared smoke acceptance](../../../../tests/helpers/scenarios/notebook.mjs) checks selected-note restoration in linked and packed Profiles and confirms that hidden settings release the AI composer and reopen at the same settings page.

Validation passes: full typecheck and build, five notebook contract tests, the navigation browser regression, Profile composition and Safe UI checks, documentation and boundary checks, and clean installation of all 50 Nook packages with 33 required Profile rows and the shared browser acceptance.
