-- 0017 already creates the operation-center-ready google_oauth_test_user_requests
-- shape. Keep this migration additive and idempotent so staging/prod migration
-- readiness does not depend on table rebuild or rename/drop behavior.

CREATE UNIQUE INDEX IF NOT EXISTS google_oauth_test_user_requests_gmail_idx
  ON google_oauth_test_user_requests(normalized_gmail);

CREATE INDEX IF NOT EXISTS google_oauth_test_user_requests_status_idx
  ON google_oauth_test_user_requests(status);

CREATE INDEX IF NOT EXISTS google_oauth_test_user_requests_requested_at_idx
  ON google_oauth_test_user_requests(requested_at);

CREATE INDEX IF NOT EXISTS google_oauth_test_user_requests_approved_at_idx
  ON google_oauth_test_user_requests(approved_at);
