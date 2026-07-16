-- A workspace binding has two identities: the immutable source account owner
-- and the subject currently authorized to act in that workspace. This supports
-- delegated mailboxes without weakening tenant or mailbox authorization.
DROP INDEX IF EXISTS idx_workspace_account_bindings_account;
ALTER TABLE workspace_account_bindings ADD COLUMN subject_user_id INTEGER;
UPDATE workspace_account_bindings SET subject_user_id=owner_user_id WHERE subject_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_account_bindings_subject ON workspace_account_bindings(subject_user_id,workspace_id,account_id);
