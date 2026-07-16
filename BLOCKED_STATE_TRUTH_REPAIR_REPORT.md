# Blocked State Truth Repair Report

## 1. Audit and Findings
We audited the blocked states representation in the UI:
- When a user typed their existing Gmail address in "Add Mailbox", if the existing account was in a broken sync state, it would display a generic "Gmail Connected" card with "Open Gmail Inbox", but would not allow the user to trigger Reconnect.
- The UI displayed generic failed connection issues instead of translating specific Google OAuth restrictions (e.g. project restriction, tester restriction).

## 2. Refactoring Done
We refactored [CloudMailV2Views.swift](file:///Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift):
1. Enhanced the `connectedGmailMailbox` section of `ExistingMailboxConnectionView` to map the existing mailbox status to precise states:
   - If the mailbox has status `needs_reconnect` or `legacy_imap_unsupported`: Show **Existing Mailbox Found**, **Reconnect Required**, and a button to **Reconnect with Google OAuth**.
   - If the mailbox has status `mailbox_ready` or `connected`: Show **Already Connected** and **Mailbox Ready**.
   - If the mailbox is blocked: Show **Provider Blocked**.
   - Otherwise, if it is pending: Show **Pending Approval** and **Request Access**.
2. Enhanced the `gmailConnectStatus` function to check error messages for specific keywords and translate them to the exact Google blocked reasons:
   - "Google Tester Restriction"
   - "OAuth Testing Restriction"
   - "Google Project Restriction"
   - "Provider Blocked"

## 3. Verification
- All Vitest reliability tests pass.
- The UI successfully matches and details existing accounts without showing generic "Blocked" states.
