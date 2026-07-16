# GPT67 P2 Action Reality Audit

## Delete closure

The previous implementation had three conflicting semantics: detail delete called the backend, Inbox swipe used only a local folder overlay, and successful delete did not persist the cache. This caused ghost mail after refresh and made delete appear non-functional.

The closure now standardizes delete paths on the authenticated `/email/delete` endpoint. Single row, detail, swipe-trash, and multi-select trash all call `AppState.delete()`. Success records a local Trash overlay, persists the overlay/cache, invalidates triage, and removes the item from the current All Mail/inbox projection. Trash remains recoverable in the local trash projection until the next server truth refresh.

## Action contract

Visible actions are classified as backend-backed, local-state-backed, or unavailable. A destructive action must update state only after the backend call succeeds; failures go through `handle(error)` instead of silently changing UI. Local classification/archive actions remain explicitly local and are not presented as provider-side mutations.

## Verification

Worker checks and the 120-test reliability suite pass. IPA 2.5 was rebuilt, code-signed, installed, and launched on Bill's iPhone 17. Remaining action audit work should add device-level tests for undo and every AI/KPI/context-menu action before declaring the entire P2 surface fully closed.

Real-device delete verification completed after exposing the missing detail-menu action: the first `Movoto — 7 Updates—212 Malabar St` message was deleted and the All Mail counter changed from 51 to 50; the second `Movoto — 49 New Homes Just Listed—6000 Moondust Ln` message was deleted and the counter changed from 50 to 49/visible 48. Both disappeared from the current inbox projection.
