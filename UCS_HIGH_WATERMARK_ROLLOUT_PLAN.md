# Deployment Rollout Plan — High-Watermark Completion

Mission: UCS HIGH-WATERMARK COMPLETION AND PARITY ENABLEMENT (design only)
Date: 2026-07-16
Note: this plan is for the FUTURE implementation mission. This design mission deploys nothing.

## Preconditions

- No schema migration (the `high_watermark` column exists in migration `0046`). If the optional
  `seq` hardening (design spec §6) is chosen, it ships first as an additive, nullable migration.
- Change confined to `src/service/unified-conversation-backfill-service.js` (+ its reliability tests).
- Provenance discipline (repo tag → deploy → Worker Version) per `docs/ADR-DEPLOYMENT-PROVENANCE-STANDARD.md`.

## Rollout phases

1. **Land + test (staging-equivalent):** implement §7 change surface; run U*/I* acceptance
   tests green under pool-workers; `npm run test:unit` green. Commit; tag `v2026.07-ucs-hwm`.
2. **Shadow observation (no behavior flip):** deploy behind an env flag
   `UCS_HWM_COMPLETION_ENABLED` defaulting **off**, so the runtime computes W and the latched
   readiness **in parallel** but the parity gate still uses the old path — compare, no risk.
3. **Enable for W2 only:** flip the flag for tenant/workspace `1:2` during a UCS-quiet window
   (W2 paused/unowned, per RCA). Observe checkpoint reach `ready` at W and a `passed=1` parity row.
4. **Generalize:** enable for all dual-write scopes once W2 shows a stable completed epoch.

## UCS-coordination (critical)

- The target Worker is the UCS-monitored `cloud-mail`. Deploy only in a W2 paused/unowned window;
  each deploy re-registers cron triggers and can interrupt an in-flight invocation (RCA finding).
- Do **not** run parity, enable projection reads, or declare FULL_PRODUCTION_PASS as part of this
  rollout; those are downstream missions gated on an observed completed epoch.

## Rollback (ADR-5)

- **Flag-off:** setting `UCS_HWM_COMPLETION_ENABLED=false` reverts to the prior gate instantly,
  no redeploy needed (Phase 2/3 safety valve).
- **Code revert:** `wrangler rollback <prior Worker Version>` or redeploy the prior tag
  (`v2026.07-f3-logout`). Code-only; **no data migration to unwind**.
- **Data safety:** the change only narrows per-epoch scope + latches readiness + scopes parity
  counts; it writes no new production data on rollback and leaves `high_watermark` (a pre-existing
  column) populated but harmless if unused. `conversation_projection_parity` rows are per-epoch
  and idempotent.
- If the optional `seq` column was added: it is additive/nullable, so leaving it in place after a
  code rollback is inert.

## Success signal

W2 checkpoint enters `state='ready'` at an immutable `high_watermark` while Gmail ingest
continues, and a `conversation_projection_parity` row records `passed=1` at that watermark —
with `projection_read_enabled=0` and no manual checkpoint/lease intervention. That observed
completed epoch is the entry criterion for COMPLETION_VERIFICATION.
