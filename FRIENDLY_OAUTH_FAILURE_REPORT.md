# Friendly OAuth Failure Report

Date: 2026-07-07

Status: `PASS`

OAuth Diagnostics now avoids misleading blocked language for already-connected Gmail accounts.

Current semantics:
- Approved Tester: OAuth/login allowed for approved account.
- Pending Approval: waiting for CloudMail governance approval.
- Not Registered: mailbox may be connected; OAuth governance not registered.
- Rejected: blocked by CloudMail admin.

This lets users understand why an account can sync mail while still needing governance approval.
