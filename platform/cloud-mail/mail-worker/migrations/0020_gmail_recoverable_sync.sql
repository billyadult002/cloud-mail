-- RC-1/RC-2/RC-3: recoverable Gmail sync state machine. Additive only.
-- NOTE: SQLite/D1 ADD COLUMN has NO "IF NOT EXISTS" — this migration must run exactly
-- once via the migration ledger. Do not hand-apply twice.
-- Consumed by the RC-1 edits in gmail-imap-service.js (staged separately; see
-- RC1_IMPLEMENTATION_SPEC.md). Applying this migration alone is safe and inert: the
-- columns default such that existing behavior is unchanged until RC-1 lands.
ALTER TABLE account ADD COLUMN sync_attempts    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account ADD COLUMN next_attempt_at  TEXT;
ALTER TABLE account ADD COLUMN sync_error_class TEXT;
ALTER TABLE account ADD COLUMN last_progress_at TEXT;

-- Accelerates the RC-1 recovery selection (sync_status='sync_required' AND next_attempt_at <= now).
CREATE INDEX IF NOT EXISTS account_sync_recovery_idx
  ON account(provider, sync_status, next_attempt_at);
