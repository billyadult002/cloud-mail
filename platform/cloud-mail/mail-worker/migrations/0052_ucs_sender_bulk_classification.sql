-- Sender-scoped UCS bulk classification. Additive: provider mail state and
-- Commitment state remain independent authorities.

CREATE TABLE IF NOT EXISTS conversation_sender_bulk_operations (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 actor_user_id INTEGER NOT NULL,
 normalized_sender TEXT NOT NULL,
 sender_identity_hash TEXT NOT NULL,
 account_scope_json TEXT NOT NULL,
 destination_type TEXT NOT NULL CHECK(destination_type IN ('classification','mailbox','workflow')),
 destination_key TEXT NOT NULL,
 future_message_policy TEXT NOT NULL CHECK(future_message_policy IN ('one_time_scope')),
 request_hash TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 expected_boundary TEXT,
 state TEXT NOT NULL CHECK(state IN ('previewed','running','completed','partial','cancelled','failed')),
 lease_generation INTEGER NOT NULL DEFAULT 1,
 lease_until TEXT,
 total_conversations INTEGER NOT NULL DEFAULT 0,
 completed_conversations INTEGER NOT NULL DEFAULT 0,
 failed_conversations INTEGER NOT NULL DEFAULT 0,
 provider_sync_state TEXT NOT NULL DEFAULT 'not_requested',
 reversible INTEGER NOT NULL DEFAULT 1,
 mission_id TEXT NOT NULL,
 action_id TEXT NOT NULL,
 outcome_id TEXT,
 result_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT,
 UNIQUE(tenant_id,workspace_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS conversation_sender_bulk_items (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 account_id INTEGER NOT NULL,
 source_message_id INTEGER NOT NULL,
 prior_category_keys_json TEXT NOT NULL,
 resulting_projection_id TEXT,
 provider_result TEXT NOT NULL DEFAULT 'not_requested',
 state TEXT NOT NULL CHECK(state IN ('pending','completed','failed','cancelled')),
 error_code TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(operation_id,conversation_id)
);

CREATE TABLE IF NOT EXISTS conversation_sender_bulk_evidence (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 source_message_id INTEGER NOT NULL,
 evidence_hash TEXT NOT NULL,
 before_state_json TEXT NOT NULL,
 after_state_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(operation_id,conversation_id)
);

CREATE TABLE IF NOT EXISTS conversation_sender_bulk_audit (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 event_type TEXT NOT NULL,
 detail_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sender_bulk_operation_scope ON conversation_sender_bulk_operations(tenant_id,workspace_id,state,updated_at);
CREATE INDEX IF NOT EXISTS idx_sender_bulk_item_operation ON conversation_sender_bulk_items(operation_id,state);

