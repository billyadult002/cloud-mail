-- P0 authority inheritance: a mailbox onboarding request has a user-visible
-- status distinct from an autonomy-job terminal state. This prevents an
-- existing verified domain from being mislabeled BLOCKED while consent is due.
CREATE TABLE IF NOT EXISTS nexora_add_mailbox_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 email TEXT NOT NULL COLLATE NOCASE,
 domain TEXT NOT NULL COLLATE NOCASE,
 mailbox_provider TEXT NOT NULL,
 infrastructure_provider TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('READY','AWAITING_CONSENT','BLOCKED')),
 effective_authority_json TEXT NOT NULL DEFAULT '{}',
 idempotency_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_add_mailbox_requests_user_domain ON nexora_add_mailbox_requests(user_id,domain,status);
