# ADR: UCS High-Watermark Implementation (flag-gated)

Status: Accepted — implemented, staging-deployed (`500395a9`); production rollout pending a
separate UCS-coordinated authorization.
Date: 2026-07-16
Related: `docs/ADR-UCS-HIGH-WATERMARK-COMPLETION.md` (design), `UCS_HIGH_WATERMARK_IMPLEMENTATION_REPORT.md`,
`UCS_HIGH_WATERMARK_DESIGN_SPEC.md`, `UCS_PARITY_ELIGIBILITY_SPEC.md`.

## Decision

Implement the approved high-watermark completion model in
`unified-conversation-backfill-service.js` behind the env flag
`UCS_HWM_COMPLETION_ENABLED` (default **off**), so the change ships dark and reverts instantly.

## Why flag-gated

The target Worker is the UCS-monitored production `cloud-mail`. A default-off flag lets the code
land and be staging-verified without altering production behavior (design rollout Phase 2), and
provides a no-redeploy rollback (flip the flag). This directly satisfies "no production state
edits" for this mission while keeping the path to enablement open under later coordination.

## What was implemented

1. **Write-once watermark freeze** at backfill epoch open (`shouldFreezeWatermark` +
   `WHERE high_watermark IS NULL OR high_watermark=''`) — immutable per epoch (V1).
2. **≤W forward scope** in `runWorkspace` so `ready` latches under continuous ingest (V2/V3).
3. **Frozen-watermark commit** (no live-max reassignment when enabled).
4. **≤W parity scope** for `failures`+`outbox` so `unexplained` is not inflated by live growth (V4).

No schema migration (the `high_watermark` column pre-exists in migration `0046`).

## Watermark ordering-key decision

Backfill uses `email.email_id` (monotonic INTEGER); `W = MAX(email_id)`. This mission implements
the backfill pipeline only (the two located targets). The V3 rematerialization pipeline (which
requires the temporal composite `(created_at, id)` watermark per the design) is intentionally
**out of scope here** and deferred to a follow-up, because the parity completion gate consumes the
backfill checkpoint's watermark (`parityWorkspace` reads `PIPELINE='ucs-backfill-v1'`).

## Consequences

- Backfill readiness and parity eligibility become reachable under ingest once the flag is enabled.
- With the flag off (current staging + production state), behavior is byte-identical to
  `v2026.07-f3-logout` — verified by flag-off unit + integration tests.
- Enablement (staging→W2→all scopes), production deploy, parity execution, and
  FULL_PRODUCTION_PASS remain **separate, later, coordinated** steps — none performed here.

## Rollback

- **Flag:** unset/false `UCS_HWM_COMPLETION_ENABLED` — instant, no redeploy.
- **Code:** revert the service file / redeploy tag `v2026.07-f3-logout`.
- **Data:** none to unwind (no migration; `high_watermark` writes are idempotent per epoch).

## Provenance

Commit `5a40b0b2…`; tag `v2026.07-ucs-hwm`; staging Worker `500395a9-…`. Production `d05ffd3e-…`
unchanged.
