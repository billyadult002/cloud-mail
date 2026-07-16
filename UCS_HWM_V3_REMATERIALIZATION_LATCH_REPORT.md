# UCS High-Watermark V3 Rematerialization Latch — Implementation Report

Mission step: implement V3 HWM latch (chosen follow-up after the production-enablement NO-GO).
Date: 2026-07-16
Baseline: tag `v2026.07-ucs-hwm` (backfill HWM). Flag-gated, staging-only, no production change.

## Why this step

The production-enablement NO-GO (`UCS_HWM_PRODUCTION_ENABLEMENT_REPORT.md`) established that
enabling the flag would make parity *execute and fail*, because the **V3 rematerialization**
pipeline — which brings ≤W projections to the current materializer version — was not yet
high-watermark-latched (`high_watermark=null`, ~39% coverage). This step closes that gap.

## Change (`rematerializeWorkspaceV3`, flag-gated by `UCS_HWM_COMPLETION_ENABLED`)

- **Temporal composite watermark** `W=(created_at,id)`: `conversation_aggregates.id` is a
  non-monotonic content digest, so an `id≤MAX` boundary is unsafe (a new random id can fall below
  the old max). W is the `(created_at,id)` of the top row at epoch open, stored in `high_watermark`
  as `"<created_at>|<id>"`, write-once.
- **Cursor reset on epoch open:** the freeze also resets `cursor_json` to `{cts:'',cid:''}`, so
  every aggregate ≤W is re-materialized to the current materializer version. This is safe
  (idempotent via `conversation_processing_receipts` + digest-keyed projections + `supersedes_id`)
  and is exactly what makes parity's `contentMismatch`/`missing` reach zero.
- **Composite ≤W scope:** fetch `WHERE (created_at,id) > cursor AND (created_at,id) <= W
  ORDER BY created_at,id`; cursor advances as `{cts,cid}`.
- **Latched readiness:** `ready = rows.length < limit` now evaluates the immutable ≤W set, so it
  latches; aggregates created after the snapshot (`>W`) are out of scope.
- **Legacy path preserved:** with the flag off, the original id-ordered traversal
  (`SELECT id FROM conversation_aggregates ... id>cursor ORDER BY id`) runs byte-identically.

No schema migration (checkpoint `high_watermark` + `cursor_json` columns pre-exist).

## Tests

`scripts/reliability-tests/ucs-high-watermark-completion.test.mjs` — **12/12** (3 new V3 cases):
freeze composite W + cursor reset write-once; composite ≤W scope on fetch; second-run no-refreeze
with cursor binds preserved; flag-off legacy id path unchanged. Regression: unit gate green;
existing UCS/F1/F3 tests 24/24.

## Provenance / staging

| Field | Value |
|-------|-------|
| Commit | `3ab120b60c39957e8d7051284a99efac2b1c7cd3` |
| Tag | `v2026.07-ucs-hwm-v3` |
| Staging Worker | `b3283329-37f4-45ef-ae75-b89186e72e11` (health 200; staging D1 un-seeded) |
| Production | `d05ffd3e-…` (F3) — **unchanged** |

## State after this step

Both HWM targets are now implemented and staging-verified:
- Backfill (`ucs-backfill-v1`) — email_id watermark, readiness latch, parity ≤W scope (`v2026.07-ucs-hwm`).
- V3 (`ucs-projection-rematerialize-v3`) — composite `(created_at,id)` watermark, cursor-reset re-materialization, latch (`v2026.07-ucs-hwm-v3`).

Both are behind `UCS_HWM_COMPLETION_ENABLED` (default off). Production still runs legacy behavior.

## Remaining path to completion (still gated)

Full behavioral verification (checkpoint READY → parity PASS → completion) requires **real UCS
data**, which staging lacks. It can only be observed in production after: deploy HWM code
(`v2026.07-ucs-hwm-v3`) to the UCS-monitored `cloud-mail` Worker, enable the flag for W2 in a
paused/unowned window, and let V3 re-materialize ≤W over time (throughput-bounded, ~hours). That
production enablement remains a **coordinated, user-authorized** step — not performed here.

## Boundaries honored

Source + tests + staging deploy only. No production deploy, no flag flip, no checkpoint/cursor/
lease/outbox/projection edit. Concurrent UCS-monitor files untouched.
