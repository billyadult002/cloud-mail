-- P3 delivery analytics foundation draft.
-- Not a production migration. Promote through the approved D1 migration pipeline only.

CREATE TABLE IF NOT EXISTS delivery_event_rollups (
  bucket_start TEXT NOT NULL,
  bucket_minutes INTEGER NOT NULL,
  provider TEXT,
  state TEXT NOT NULL,
  error_class TEXT,
  count INTEGER NOT NULL,
  p50_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  p99_latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bucket_start, bucket_minutes, provider, state, error_class)
);

CREATE INDEX IF NOT EXISTS delivery_event_rollups_state_time_idx
  ON delivery_event_rollups(state, bucket_start);

CREATE INDEX IF NOT EXISTS delivery_event_rollups_provider_time_idx
  ON delivery_event_rollups(provider, bucket_start);
