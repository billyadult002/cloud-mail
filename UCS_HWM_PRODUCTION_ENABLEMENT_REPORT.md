# UCS High-Watermark Production Enablement & Completion Verification — Report

Mission: UCS HIGH-WATERMARK PRODUCTION ENABLEMENT AND COMPLETION VERIFICATION
Date: 2026-07-16
Verdict: **NO-GO — enablement PREPARED but NOT EXECUTED.** Evidence shows enabling now would
make parity *execute and fail*, so completion and FULL_PRODUCTION_PASS are not achievable yet.
No production state was modified.

## Non-interference attestation

Only read-only `SELECT`s on production D1 (`changes:0, rows_written:0, changed_db:false`) — CP1/CP2
audit inspection. No flag flip, no deploy, no checkpoint/cursor/lease/outbox/projection change.
Projection reads remain 0%. Concurrent UCS-monitor files untouched.

## Pre-rollout snapshot (CP1) — read-only production evidence

| Item | Value |
|------|-------|
| E1 production Worker (before) | `d05ffd3e-724f-4c43-ba7a-3229d6cda9f1` (F3, tag `v2026.07-f3-logout`) |
| E3 flag state (before) | `UCS_HWM_COMPLETION_ENABLED` absent from `[vars]` ⇒ runtime **OFF** |
| E9 projection reads | `projection_read_enabled=0`, `cutover_epoch=1`, `dual_write_enabled=1` (governed/off) |

W2 checkpoints (`tenant_id=1, workspace_id=2`) at 13:51 UTC, all **paused/ready, unowned (lease null)** — a valid paused/unowned window (CP2 / A1):

| pipeline_key | state | high_watermark | cursor | generation | processed | quarantined |
|--------------|-------|----------------|--------|-----------|-----------|-------------|
| `ucs-backfill-v1` | paused | **3763** | email_id 3763 | 1582 | 2180 | 24 |
| `ucs-projection-membership-v2` | **ready** | null | — | 230 | 1850 | 0 |
| `ucs-projection-rematerialize-v3` | paused | **null** | conversation:38cdcb2f… | 97 | **480** | 0 |

## Go/No-Go analysis

**Production currently runs F3 code (`d05ffd3e`), which does NOT contain the HWM implementation**
(that is commit `5a40b0b` / tag `v2026.07-ucs-hwm`, deployed only to staging `500395a9`).
Enablement therefore requires **(1)** deploying HWM code to the UCS-monitored production Worker
**and (2)** setting `UCS_HWM_COMPLETION_ENABLED=true`.

If enabled:
- **Backfill → READY (reachable).** `ucs-backfill-v1` has `high_watermark=3763` and `cursor=3763`
  (already at its watermark). `shouldFreezeWatermark` is false (W preset), the ≤W forward fetch
  returns 0 rows, so `ready=true` latches. Membership is already READY ⇒ the parity gate
  `run.ready && membership.ready` opens.
- **Parity → EXECUTES but FAILS.** Parity-pass requires every conversation ≤ W(email 3763) to have
  a *current* projection at the current `MATERIALIZER_VERSION` with matching `message_count`
  (`parityWorkspace` `missing`/`contentMismatch`). The **V3 rematerialization** pipeline that brings
  projections to the current materializer version has `high_watermark=null`, `processed=480`, and
  ~39% coverage — and was **intentionally excluded** from the HWM implementation
  (`docs/ADR-UCS-HIGH-WATERMARK-IMPLEMENTATION.md`, "V3 … out of scope here"). So a large fraction of
  ≤W projections remain stale/missing ⇒ `contentMismatch`/`missing` > 0 ⇒ **parity does not pass**.

**Conclusion:** the structural blocker fixed in this branch (backfill readiness latch + parity ≤W
scope) makes parity *eligible and executable*, but **parity cannot PASS until the V3 rematerialization
pipeline is also high-watermark-latched and converged for ≤W**. Enabling now would change production
behavior on a concurrently-monitored pipeline to produce a *failing* parity, with no completion this
session — a net negative.

## Verification results (V1–V10)

| ID | Requirement | Result |
|----|-------------|--------|
| V1 | W2 enters READY | Backfill READY is *reachable* if enabled (cursor=hw=3763); **not executed** |
| V2 | READY latched | Design/tests prove latch; not exercised in prod |
| V3 | Parity executes | Would execute if enabled; **not executed** |
| V4 | Parity passes | **Would FAIL** — V3 rematerialization incomplete (out of scope) |
| V5 | No duplicate projections | Snapshot: duplicates 0 (unchanged; no action taken) |
| V6 | No orphan projections | Snapshot: orphans 0 |
| V7 | No unresolved failures | Backfill quarantined 24 (historical); V3/membership 0 |
| V8 | No quarantine growth | Not changed (no action) |
| V9 | Projection reads governed | `projection_read_enabled=0` (verified) |
| V10 | Completion evidence collected | Collected (this report) — completion **not reached** |

## Rollback path (CP9 / A11) — verified available

- **Flag:** `UCS_HWM_COMPLETION_ENABLED` unset/false ⇒ byte-identical legacy behavior (unit +
  integration flag-off tests). Instant, no redeploy.
- **Code:** production is still on `v2026.07-f3-logout`; if HWM code were deployed, revert =
  redeploy that tag / `wrangler rollback d05ffd3e`. No migration; data-safe.

## Audit answers

- **Did READY become reachable?** Backfill READY is reachable (cursor=hw=3763) but was **not executed** (no enablement).
- **Did READY stay latched?** Not exercised in production (design/tests confirm latch).
- **Did parity run?** No — not enabled. It *would* run if enabled.
- **Did parity pass?** No — it would **fail**: V3 rematerialization (out of scope, `hw=null`, 480 processed) leaves ≤W projections incomplete/stale.
- **Did completion occur?** No.
- **Were >W records excluded correctly?** Verified in the implementation's integration tests; not exercised in production.
- **Was any data lost?** No — no production change was made.
- **Is FULL_PRODUCTION_PASS now justified?** **No** — parity is not passable until V3 HWM is implemented + converged; `projection_read_enabled=0`, epoch 1.

## Recommended next step (corrected sequencing)

Implement high-watermark latching for the **V3 rematerialization pipeline**
(`rematerializeWorkspaceV3`) using the temporal composite `(created_at,id)` watermark from the
design spec, let V3 converge ≤W to the current materializer version, **then** enable
`UCS_HWM_COMPLETION_ENABLED` in production during a W2 paused/unowned window and verify parity PASS.
See `docs/ADR-UCS-HWM-PRODUCTION-ENABLEMENT.md`.

## Boundaries honored

No checkpoint/cursor/lease/outbox manipulation, no rematerialization, no manual parity injection,
no deploy, no flag flip. Read-only observation only.
