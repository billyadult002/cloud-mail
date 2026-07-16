# Reconnect Engine Report

## Result
PASS for reconnect architecture.

Google mailbox OAuth start now accepts an optional `accountId` and iOS Recovery UI passes the current mailbox account id for reauthentication.

## Behavior
- Reconnect targets the current mailbox.
- OAuth callback rejects mismatched Google email for the requested mailbox.
- New Google sign-in without account id remains available for add/connect flows.

## Evidence
- `Backend.startGoogleMailboxOAuth(email:device:accountId:)`
- `AppState.startGoogleMailboxOAuth(email:accountId:)`
- Recovery UI calls `startGoogleMailboxOAuth(email: account.email, accountId: account.accountId)`.

