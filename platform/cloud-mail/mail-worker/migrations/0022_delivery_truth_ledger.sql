-- 0022_delivery_truth_ledger.sql
-- P0 delivery truth ledger foundation. Additive only.
-- Provider acceptance is intentionally distinct from delivery confirmation.

CREATE TABLE IF NOT EXISTS delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbound_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'created',
    'queued',
    'provider_accepted',
    'provider_queued',
    'delivered',
    'retry',
    'bounce',
    'failed'
  )),
  provider TEXT,
  provider_message_id TEXT,
  provider_event_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  error_class TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS delivery_events_outbound_idx
  ON delivery_events(outbound_id, occurred_at);

CREATE INDEX IF NOT EXISTS delivery_events_provider_idx
  ON delivery_events(provider, provider_message_id);

-- SQLite/D1 ADD COLUMN has no IF NOT EXISTS. This migration must run once
-- through the Wrangler D1 migration ledger.
ALTER TABLE outbound_messages ADD COLUMN current_delivery_state TEXT;
ALTER TABLE outbound_messages ADD COLUMN provider_accepted_at TEXT;
ALTER TABLE outbound_messages ADD COLUMN provider_queued_at TEXT;
ALTER TABLE outbound_messages ADD COLUMN delivered_at TEXT;
ALTER TABLE outbound_messages ADD COLUMN bounced_at TEXT;
ALTER TABLE outbound_messages ADD COLUMN failed_at TEXT;
