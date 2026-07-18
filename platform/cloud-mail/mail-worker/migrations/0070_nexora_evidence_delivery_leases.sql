-- Durable ownership/fencing for Evidence-outbox delivery workers.
CREATE TABLE IF NOT EXISTS nexora_onboarding_evidence_delivery_leases (
 outbox_id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 owner TEXT,
 fencing_token INTEGER NOT NULL DEFAULT 0,
 lease_expires_at TEXT,
 attempt INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
