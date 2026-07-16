-- Bind every provider account to its owner's app-native workspace without
-- assigning public provider domains to a customer-owned domain workspace.
CREATE TABLE IF NOT EXISTS workspace_account_bindings (
 workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL,
 owner_user_id INTEGER NOT NULL,
 lifecycle_state TEXT NOT NULL DEFAULT 'READY' CHECK(lifecycle_state IN ('DISCOVERED','READY','BLOCKED','REVOKED')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,account_id),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_account_bindings_account ON workspace_account_bindings(account_id);
CREATE INDEX IF NOT EXISTS idx_workspace_account_bindings_owner ON workspace_account_bindings(owner_user_id,workspace_id);

-- One-way compatibility projection. No account, provider credential, or tenant
-- record is moved; it simply becomes addressable from its owner's workspace.
INSERT OR IGNORE INTO workspace_account_bindings(workspace_id,account_id,owner_user_id,lifecycle_state)
SELECT w.id,a.account_id,a.user_id,CASE WHEN a.is_del=0 THEN 'READY' ELSE 'REVOKED' END
  FROM account a
  JOIN workspaces w ON w.tenant_key='user:' || a.user_id
 WHERE a.account_id IS NOT NULL;
