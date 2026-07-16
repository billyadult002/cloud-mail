# Accounts Diagnostics Report

Date: 2026-07-07

Status: `PASS`

Accounts Diagnostics now separates mailbox connectivity from governance authorization.

Corrected Gmail display:
- Connected Gmail with no CloudMail governance registration: `WARN`, not `BLOCKED`.
- Connected Gmail with admin approval: `PASS`.
- Gmail waiting for admin approval: `PENDING`.
- Gmail explicitly rejected by admin: `BLOCKED`.
- Gmail with sync/auth error: `FAIL`.

This resolves the real iPhone screenshot contradiction where Gmail showed `BLOCKED` while Sync Status was `connected` and Authentication was `Authenticated`.
