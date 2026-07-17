# UCS Staging Schema Manifest & Fingerprint

Mission: UCS ISOLATED STAGING SCHEMA PROVISIONING. Date: 2026-07-17.
Target: `cloud-mail-staging` D1 `acf160ae-4efd-48d0-9d1b-7500f4cd0f41`.

## Fingerprint (E8/ADR-8)

| Metric | Pre-apply | Post-apply |
|--------|-----------|------------|
| tables | 50 | **180** |
| conversation_* tables | 0 | **28** |
| indexes | (part of 108 objects) | 278 |
| triggers | (part of 108 objects) | 82 |
| total schema objects | 108 (sha256 `18d61e71…`) | (tables+idx+trig = 180+278+82) |
| account/user/email rows | 0/0/0 | 0/0/0 (unchanged) |

Pre-apply object snapshot saved to scratchpad (`staging-preapply-schema.txt`, sha256 `18d61e71…`).

## Runtime-critical tables present (15/15)

conversation_aggregates, conversation_commitment_heads, conversation_cutover_state, conversation_evidence,
conversation_facet_heads, conversation_facet_results, conversation_ingest_outbox,
conversation_materialization_checkpoints, conversation_messages, conversation_pipeline_failures,
conversation_processing_receipts, conversation_projections, mail_canonical_state, workspace_account_bindings,
workspace_members.

## Runtime-contract columns (verified)

- `conversation_ingest_outbox`: id, tenant_id, workspace_id, account_id, source_message_id, source_version,
  event_type CHECK('observed','updated'), state CHECK('pending','processing','processed','failed'),
  attempt_count, lease_owner, lease_until, last_error_code, created_at, processed_at;
  UNIQUE(tenant_id,workspace_id,source_message_id,source_version,event_type); index `idx_ucs_ingest_pending`.
- `conversation_materialization_checkpoints`: id, tenant_id, workspace_id, pipeline_key, cursor_json,
  high_watermark, last_projection_id, processed_count, quarantined_count, state, lease_owner, lease_generation,
  lease_until, updated_at.
