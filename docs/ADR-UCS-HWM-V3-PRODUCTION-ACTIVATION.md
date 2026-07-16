# ADR: UCS HWM V3 Controlled Production Activation

Status: Accepted — activated; verdict PRODUCTION_CONVERGENCE_IN_PROGRESS.
Date: 2026-07-16
Related: `UCS_HWM_V3_PRODUCTION_ACTIVATION_REPORT.md`, `UCS_HWM_V3_CONVERGENCE_EVIDENCE.md`,
`UCS_HWM_V3_PARITY_ACCEPTANCE.md`, `UCS_HWM_V3_FINAL_PRODUCTION_ACCEPTANCE.md`.

## ADR-1 — Pre-activation exact state (19:15:32 UTC, read-only)

- Active Worker: `d05ffd3e-…` (F3). HWM flag: absent ⇒ OFF.
- backfill `ucs-backfill-v1`: paused/UNOWNED, gen 1598, proc 2212, hw 3795.
- membership `ucs-projection-membership-v2`: ready/UNOWNED.
- V3 `ucs-projection-rematerialize-v3`: running/EXPIRED lease, gen 108, proc 529, hw null.
- `projection_read_enabled=0`, `cutover_epoch=1`. Rollback ref: `d05ffd3e-…`.

## ADR-2 — Deployment ↔ commit/tag/version binding

- Code: commit `3ab120b`, tag `v2026.07-ucs-hwm-v3` → Worker `dbcf4c70` (flag off) @ 19:15:59.
- Enablement: commit `0b5dd1d3`, tag `v2026.07-ucs-hwm-v3-enabled` → Worker `525681a1` (flag on) @ 19:22:20.
- `UCS_HWM_COMPLETION_ENABLED="true"` set in `wrangler.toml [vars]` (config-as-code). Crons/bindings unchanged.

## ADR-3 — V3 composite watermark production freeze value

W = **`2026-07-16 19:23:13 | conversation:623f0b8a-6320-4236-a38a-f3d0684f24c1`** — a
`(created_at, id)` tuple, captured write-once at epoch open (`WHERE high_watermark IS NULL`).
Immutability evidenced by two read-only observations (19:24:31, 19:26:59) showing the identical
value while the cursor advanced and generation increased. No run rewrites `high_watermark`.

## ADR-4 — Semantics for records > W

Aggregates with `created_at > W_ts` (or `= W_ts AND id > W_id`), and emails with `email_id > 3807`,
are **out of scope for this epoch**: not processed now, not blocking this epoch's parity, and not
lost — they remain eligible for a subsequent epoch/watermark. Continuous Gmail ingest therefore
cannot change the completion conclusion of the frozen snapshot (V17).

## ADR-5 — Rollback conditions and boundaries

- Deploy/boot failure ⇒ `wrangler rollback` to `dbcf4c70` (flag-off code) or `d05ffd3e` (F3).
- HWM behavior anomaly ⇒ prefer flag off (`UCS_HWM_COMPLETION_ENABLED="false"` + redeploy) — instant,
  no data touch.
- Rollback MUST NOT edit checkpoint/high_watermark/cursor/lease/outbox; already-materialized
  idempotent projections are retained, not deleted.

## ADR-6 — FULL_PRODUCTION_PASS eligibility boundary

Declared only after: production convergence complete, native parity PASS with all integrity
metrics 0 under continuous ingest, all backend gates green, and — for a projection-read cutover —
gray-scale %, target Build, and real-iPhone acceptance verified. None of these are satisfied yet;
the current verdict is PRODUCTION_CONVERGENCE_IN_PROGRESS.

## ADR-5 addendum — backfill historical quarantine=24

`quarantined_count` is a monotonic lifetime counter (runtime only increments it, never decrements).
backfill=24 is 24 historical quarantine events across the pipeline's life, not 24 currently
unresolved rows. Current acceptance is governed by `unresolved_failures=0`
(`conversation_pipeline_failures.resolved_at IS NULL`) and parity `missing`/`contentMismatch`.
It does not block the frozen-snapshot acceptance and is disclosed, not hidden.

## Decision

Keep the flag enabled and let the native scheduler converge V3 ≤W and drain the ≤W ingest outbox
(the dominant long-pole); collect parity evidence in bounded follow-ups. Do not enable projection
reads. Do not declare FULL_PRODUCTION_PASS. Verdict as of 19:43 UTC: PRODUCTION_CONVERGENCE_IN_PROGRESS
(contentMismatch 1350→1336, outbox_le_w 1655→1650, integrity 0, watermark immutable, all native).
