-- Persistent NEXORA folder state for move/archive/junk/restore workflows.
ALTER TABLE email ADD COLUMN folder_key TEXT NOT NULL DEFAULT 'inbox';
CREATE INDEX IF NOT EXISTS idx_email_user_folder ON email(user_id, folder_key, is_del, email_id);
