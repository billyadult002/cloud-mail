-- Append-only successor-attempt lineage. Reconciliation disposition records
-- remain immutable even when a fenced corrective attempt itself fails.
CREATE TABLE IF NOT EXISTS conversation_sender_bulk_reconciliation_attempts (
 id TEXT PRIMARY KEY,
 reconciliation_id TEXT NOT NULL,
 corrective_attempt_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 original_operation_id TEXT NOT NULL,
 original_item_id TEXT NOT NULL,
 evidence_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(reconciliation_id, corrective_attempt_id)
);

CREATE TRIGGER IF NOT EXISTS conversation_sender_bulk_reconciliation_attempts_no_update
BEFORE UPDATE ON conversation_sender_bulk_reconciliation_attempts
BEGIN SELECT RAISE(ABORT,'conversation_sender_bulk_reconciliation_attempt_append_only'); END;

CREATE TRIGGER IF NOT EXISTS conversation_sender_bulk_reconciliation_attempts_no_delete
BEFORE DELETE ON conversation_sender_bulk_reconciliation_attempts
BEGIN SELECT RAISE(ABORT,'conversation_sender_bulk_reconciliation_attempt_append_only'); END;
