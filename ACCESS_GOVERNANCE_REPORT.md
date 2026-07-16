# Access Governance Report

Date: 2026-07-07

Status: `PASS`

CloudMail now has an Access Governance center for account authorization workflow visibility. The center links Approval Center, Invitations, Tester Management, Audit Trail, Diagnostics, Recovery Center, and Provider Health.

Gmail status semantics were corrected:
- `connected` / `Authenticated` means mailbox sync and token reference are usable.
- `Not Registered` means CloudMail governance approval has not been recorded.
- `Rejected` means CloudMail admin blocked authorization.
- `BLOCKED` is no longer shown for Gmail accounts that are connected and merely missing governance registration.

Admin can update Gmail authorization status through Google Testers using `Update Gmail Authorization Status`.

Boundary: this is a CloudMail governance ledger. It does not claim Google Console tester writeback or Google production OAuth verification.
