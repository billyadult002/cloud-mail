# Client Reconnect Routing Repair Report

## 1. Audit and Findings
We audited [AccountsView.swift](file:///Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail/Views/AccountsView.swift) and found that:
- The property `requiresGoogleOAuthReconnect` checked `provider == .gmail || provider == .googleWorkspace` directly.
- This was bypassing historical/legacy Gmail mailboxes where the provider was stored as `imap` or `cloudflare_native`.
- As a result, the client-side UI routed the reconnect action of these legacy mailboxes to `showingConnector = true` (the general "Add Mailbox" flow) instead of triggering the targeted `reconnectMailbox` flow.

## 2. Refactoring Done
We refactored [AccountsView.swift](file:///Users/billtin/Documents/cloudmail/files/GlassMail-project/GlassMail/Views/AccountsView.swift):
1. Added `isGoogleAccount` helper to `MailboxCardModel` that accurately detects Google mailboxes:
   - Matches if provider is `.gmail` or `.googleWorkspace`
   - Matches if email domain ends in `gmail.com` or `googlemail.com` (regardless of provider)
2. Updated `requiresGoogleOAuthReconnect` to leverage the helper:
   ```swift
   var requiresGoogleOAuthReconnect: Bool {
       isGoogleAccount && needsReauthorization && accountId != nil
   }
   ```
3. Updated the bottom "Actions" section button in `mailboxDetailSheet` to check if `mailbox.isGoogleAccount` and has an `accountId`, routing it via `reconnectMailbox(mailbox)` (which calls `app.startGoogleMailboxOAuth` passing its `accountId`) instead of opening the generic "Add Email" page.

## 3. Verification
- Verified that any Gmail-like account (including IMAP/native providers with Gmail addresses) resolves `isGoogleAccount` to true.
- Verified that "Reconnect" action successfully routes to the targeted reconnect URL with the existing `accountId`.
