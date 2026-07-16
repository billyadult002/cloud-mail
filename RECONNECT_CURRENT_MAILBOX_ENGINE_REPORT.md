# Reconnect Current Mailbox Engine Report

## 1. Flow Design
The reconnect engine uses a decoupled OAuth flow to update existing mailboxes securely:

```mermaid
graph TD
    A[Legacy Gmail / needs_reconnect] -->|Tap Reconnect| B[reconnectMailbox]
    B -->|app.startGoogleMailboxOAuth email, accountId| C[Google OAuth URL generated with state containing accountId]
    C -->|User Consent| D[Redirects to CloudMail Worker Callback]
    D -->|stored.requestedAccountId extracted from KV| E[upsertGoogleMailbox]
    E -->|Updates target account in D1| F[Set provider to gmail, status to first_import_pending]
    F -->|Replace legacy credentials| G[Delete old mail_provider_credentials, insert new OAuth credentials]
    G -->|Clean up duplicates| H[Archive other duplicate identities]
```

## 2. Implementation Summary
- **Client implementation**: Correctly routes any Gmail-like account to `reconnectMailbox(mailbox)` passing the account's ID.
- **Backend implementation**: Matches the target account in `upsertGoogleMailbox` by the requested ID, updates it to the V2 provider (`gmail`/`google_workspace`), deletes the old provider credentials, inserts the new OAuth credentials, archives other duplicate email accounts, and advances the lifecycle status.

## 3. Verification
- Proven through Vitest reliability tests.
- Reconnect successfully updates the original database row, preserves account ID/history, and upgrades the provider in-place.
