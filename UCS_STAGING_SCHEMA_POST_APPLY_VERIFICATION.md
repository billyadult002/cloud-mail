# UCS Staging Schema Post-Apply Verification

Mission: UCS ISOLATED STAGING SCHEMA PROVISIONING. Date: 2026-07-17.
Target: `cloud-mail-staging` (`acf160ae…`). All checks read-only except the isolated synthetic smoke.

## Migration execution (E15/E16)

`wrangler d1 migrations apply db --env staging --remote` — 0023–0056, **all 34 ✅**, ~10 s
(12:43:51→12:44:01 UTC). Zero failures.

## Object counts (E17/E18/E19)

tables 50→180 (+130); conversation_* 0→28; indexes 278; triggers 82. Existing data unchanged
(account/user/email = 0). Fingerprint in the manifest.

## Runtime dependency verification (E20 / V9–V17)

- conversation_ingest_outbox present; columns state/attempt_count/lease_owner/lease_until/source_message_id/
  source_version/event_type/last_error_code/created_at/processed_at; CHECK(event_type∈observed,updated),
  CHECK(state∈pending,processing,processed,failed); UNIQUE(tenant,workspace,source_message_id,source_version,
  event_type); index `idx_ucs_ingest_pending`. (V11/V12/V13)
- conversation_materialization_checkpoints present; columns cursor_json/high_watermark/lease_owner/
  lease_generation/lease_until/processed_count/quarantined_count/state. (V16/V17)
- conversation_processing_receipts present (idempotency). (V14)
- conversation_pipeline_failures present (failure/quarantine via quarantined_count on checkpoints). (V15)
- conversation_aggregates/messages/projections/mail_canonical_state/evidence/facet/commitment present. (V9/V10)

## Synthetic schema smoke (E21/E22 / V18–V21)

Namespace tenant=990001/workspace=990002/account=990003, event_type='observed':
insert pending → eligibility read **1** → lease claim (state=processing, lease_until=+5m) via fenced predicate
**success** → post-claim eligibility **0** (fenced) → delete → residual **0**. `processed` never faked.

## Runtime-off / non-interference (E23–E26 / V22–V28)

Staging: crons=[], no UCS_ACTIVATION_ENABLED/UCS_HWM_COMPLETION_ENABLED in staging vars, projection reads off,
Worker not redeployed. Production: Worker `525681a1` (100%), HWM `true`, W2 `projection_read_enabled=0`
(`rows_written=0`). No production D1/KV/R2/Worker change.
