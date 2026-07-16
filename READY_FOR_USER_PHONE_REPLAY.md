# Ready for User Phone Replay Package

This document outlines the validation steps to perform once the user returns with the physical iPhone 17.

## 1. Replay Prerequisites
- Ensure the iPhone 17 is unlocked.
- Keep the screen active and do not lock the screen during UI test runs.
- Run the latest signed IPA on the device.

## 2. Signed Build Details
- **IPA Path**: `artifacts/gmail-reconnect-routing-real-replay/CloudMail-owner-signed.ipa`
- **IPA Size**: `8,934,689 bytes` (approx. `8.9 MB`)
- **Build Time**: `2026-07-09 12:31:14`
- **Signing Identity**: `Apple Distribution: jian sun (4GGH43VE67)`
- **Provisioning Profile**: `/Users/billtin/Documents/cloudmail/profile 00008150-000629623EC0401C`
- **Keychain/Cert Password**: `1`
- **Bundle ID**: `app.wangbei8554.pingguo736`
- **Signing Team ID**: `4GGH43VE67`
- **Git Commit**: `N/A`
- **Worker Version**: `48bacbb8-6d2b-456c-ac04-a750d95d27ad`

## 3. Step-by-Step Replay Instructions
1. Open **CloudMail** on the iPhone.
2. Navigate to **Account Center** -> **Accounts**.
3. Locate the first legacy Gmail mailbox showing **Reconnect Required**.
4. Tap **Reconnect**.
5. Confirm that the app launches the **Google OAuth Reconnect** flow (not the "Add Mailbox" or generic "Add Email" page).
6. Complete the OAuth verification process.
7. Confirm that the original `accountId` is preserved and updated on the backend D1 database.
8. Check that no duplicate Gmail accounts are created.
9. Verify that **Reconnect Required** has vanished.
10. Navigate to **Diagnostics** and check that all statuses for the account are green and aligned.
11. Perform a Send test from the reconnected mailbox.
12. Perform a Receive test to the reconnected mailbox.

## 4. Account Checklist
Use this checklist to record the verification results of each account:

- [ ] **`billyadult01@gmail.com`**
  - [ ] Reconnect opens Google OAuth
  - [ ] Account ID preserved
  - [ ] No duplicate row
  - [ ] Diagnostics show green
  - [ ] Send proof pass
  - [ ] Receive proof pass

- [ ] **`billyadult008@gmail.com`**
  - [ ] Reconnect opens Google OAuth
  - [ ] Account ID preserved
  - [ ] No duplicate row
  - [ ] Diagnostics show green
  - [ ] Send proof pass
  - [ ] Receive proof pass

- [ ] **`saercpku@gmail.com`**
  - [ ] Reconnect opens Google OAuth
  - [ ] Account ID preserved
  - [ ] No duplicate row
  - [ ] Diagnostics show green
  - [ ] Send proof pass
  - [ ] Receive proof pass

- [ ] **`zhaotianwy@gmail.com`**
  - [ ] Reconnect opens Google OAuth
  - [ ] Account ID preserved
  - [ ] No duplicate row
  - [ ] Diagnostics show green
  - [ ] Send proof pass
  - [ ] Receive proof pass

## 5. Fresh Gmail Validation
To test clean onboarding on a new account, use:
- **`USER_PROVIDED_FRESH_GMAIL`**
  - [ ] New Google account OAuth flow opens
  - [ ] Account created
  - [ ] Onboarding succeeds
  - [ ] Diagnostics show green
