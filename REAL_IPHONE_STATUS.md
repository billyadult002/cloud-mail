# Real iPhone Status - Gmail Reconnect Routing & Duplicate Prevention

Date: 2026-07-09

## Device Information
- Device Name: Bill's iPhone 17
- Connection: USB wired, physical device (currently away with the user)
- iOS Version: 27.0

## Status
- **`REAL_IPHONE_REPLAY_PENDING_USER_RETURN`**

## Installed / Signed IPA Details
- **IPA Path**: `artifacts/gmail-reconnect-routing-real-replay/CloudMail-owner-signed.ipa`
- **IPA Size**: `8,934,689 bytes` (approx. `8.9 MB`)
- **Build Time**: `2026-07-09 12:31:14`
- **Signing Identity**: `Apple Distribution: jian sun (4GGH43VE67)`
- **Provisioning Profile**: `/Users/billtin/Documents/cloudmail/profile 00008150-000629623EC0401C`
- **Bundle Identifier**: `app.wangbei8554.pingguo736`
- **Git Commit**: `N/A`
- **Worker Version**: `48bacbb8-6d2b-456c-ac04-a750d95d27ad`

## Replay Verification Targets
Upon user return, the following physical device checks will be replayed:
1. Reconnect button in Account Center launches Google OAuth with matching account ID.
2. No duplicate row or credentials created on success.
3. Onboarding screen translates Google test user restrictions correctly.
4. Active email send and receive proof verified.

## Log History
2026-07-09:
- Executed legacy system total eradication on real iPhone views.
- Removed legacy Google tester, pending approval, and invitation status sections from diagnostics.
- Refactored UI test `testEnterpriseAccountsDiagnosticsOAuthApprovalRealIPhoneNonDestructive`.
- Compiled, signed, and generated fresh owner-signed IPA.
