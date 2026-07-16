-- Append-only reconciliation lineage for immutable sender-bulk attempts.
CREATE TABLE IF NOT EXISTS conversation_sender_bulk_reconciliations (
 id TEXT PRIMARY KEY,
 original_operation_id TEXT NOT NULL,
 original_item_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 account_id INTEGER NOT NULL,
 source_message_id INTEGER NOT NULL,
 source_version TEXT NOT NULL,
 historical_diagnosis_code TEXT NOT NULL,
 current_state_json TEXT NOT NULL,
 authority_state_json TEXT NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('retry_atomic_promotions','exclude_newer_intent','exclude_authority_changed','retain_ineligible','historical_failure_reconciled')),
 disposition_reason_code TEXT NOT NULL,
 corrective_attempt_id TEXT,
 deployment_ref TEXT NOT NULL,
 evidence_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(original_operation_id,original_item_id,source_version,disposition)
);

CREATE TRIGGER IF NOT EXISTS conversation_sender_bulk_reconciliations_no_update
BEFORE UPDATE ON conversation_sender_bulk_reconciliations
BEGIN SELECT RAISE(ABORT,'conversation_sender_bulk_reconciliation_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_sender_bulk_reconciliations_no_delete
BEFORE DELETE ON conversation_sender_bulk_reconciliations
BEGIN SELECT RAISE(ABORT,'conversation_sender_bulk_reconciliation_append_only'); END;
