# Sync Diagnostics Report

Status: PASS.

Sync diagnostics now display Last Sync, Next Sync, Messages Synced, Retry Count, Failure Count, and Failure Reason from the existing AppState observability snapshot.

No mailbox content, tokens, OAuth codes, refresh tokens, or secrets are printed.
# Sync Diagnostics Report

Date: 2026-07-07

Status: `PASS`

Sync diagnostics remain separate from governance diagnostics.

The real iPhone issue showed Gmail rows with Sync Status `connected` and Authentication `Authenticated` while Health was `BLOCKED`. The root cause was diagnostic mapping, not mailbox connectivity. That mapping is now corrected:
- sync/auth errors map to FAIL;
- admin rejection maps to BLOCKED;
- pending approval maps to PENDING;
- missing governance registration on a connected Gmail maps to WARN.

---
