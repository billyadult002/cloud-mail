-- WF-8 / Phase E quick win: covering index for the hot inbox list query.
-- emailService.list() filters (user_id, account_id, type, is_del) and orders by
-- email_id; the only prior base index was (user_id, account_id), leaving type/
-- is_del as a residual scan and email_id unsorted. This composite index lets the
-- range + filter + ORDER BY be served by one index.
-- Idempotent (IF NOT EXISTS); no rename/drop.
CREATE INDEX IF NOT EXISTS email_inbox_idx
  ON email(user_id, account_id, type, is_del, email_id);
