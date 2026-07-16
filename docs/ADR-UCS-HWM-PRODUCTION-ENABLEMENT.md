# ADR: UCS High-Watermark Production Enablement — Decision

Status: **Deferred (NO-GO)** — enablement prepared, not executed.
Date: 2026-07-16
Related: `UCS_HWM_PRODUCTION_ENABLEMENT_REPORT.md`, `docs/ADR-UCS-HIGH-WATERMARK-IMPLEMENTATION.md`,
`UCS_HIGH_WATERMARK_DESIGN_SPEC.md`.

## Context

The HWM implementation (commit `5a40b0b`, tag `v2026.07-ucs-hwm`, staging Worker `500395a9`)
fixes the **backfill** pipeline: readiness latch + parity ≤W scope. Production still runs F3
(`d05ffd3e`) with the flag absent (off). A read-only pre-rollout snapshot was taken.

## Decision

**Do not enable `UCS_HWM_COMPLETION_ENABLED` in production yet.** Defer until the V3
rematerialization pipeline is also high-watermark-latched and converged for ≤W.

## Rationale (evidence-based)

Snapshot (read-only, W2, 13:51 UTC):
- `ucs-backfill-v1`: `high_watermark=3763`, `cursor=3763`, paused/unowned → would latch READY if enabled.
- `ucs-projection-membership-v2`: READY.
- `ucs-projection-rematerialize-v3`: `high_watermark=null`, `processed=480`, paused/unowned.

Enabling would open the parity gate (backfill READY + membership READY) and parity would
**execute**, but parity-pass requires all projections ≤ W(email 3763) at the current materializer
version. The V3 rematerialization pipeline that guarantees that was **intentionally out of scope**
of the HWM implementation and remains non-latched and ~39% converged. Therefore parity would
**FAIL** (`contentMismatch`/`missing` > 0), completion would not occur, and FULL_PRODUCTION_PASS
would not be justified — while a concurrent mission actively monitors this exact pipeline.

## Consequences

- No production behavior change is made; the concurrent UCS monitor's evidence epoch is not disturbed.
- The path to enablement is unchanged and reversible; only the sequencing is corrected.

## Required follow-up (corrected execution order)

1. **UCS_HWM_V3_REMATERIALIZATION_LATCH** — extend HWM to `rematerializeWorkspaceV3` using the
   temporal composite `(created_at,id)` watermark (design spec §1/§6). Flag-gated, staging-verified.
2. Let V3 converge ≤W to the current materializer version.
3. **UCS_HWM_PRODUCTION_ENABLEMENT (re-attempt)** — deploy HWM code + enable the flag for W2 in a
   paused/unowned window; observe backfill READY, parity EXECUTE + **PASS**, completion.
4. **FULL_PRODUCTION_PASS_EVALUATION** — only after an observed passing parity at a completed epoch.

## Rollback

Flag default off = legacy behavior (no redeploy). Code revert = redeploy `v2026.07-f3-logout`.
No migration. Verified available.
