# CLOUDMAIL_GMAIL_END_TO_END_REAL_WORLD_CLOSURE

Status: `BLOCKED_GOOGLE_PROVIDER_RESTRICTION`

## What Passed

- Normal Gmail onboarding no longer uses legacy approval gates, request access, invitation code dependency, or pending approval UI.
- Add Gmail on real iPhone opens the Gmail provider path directly.
- Existing connected Gmail accounts show `Connected` / `Mailbox Ready` on real iPhone.
- Existing connected Gmail sync uses Gmail REST API OAuth credentials.
- Worker Gmail fallback cron is deployed every minute.
- OAuth success governance state is decoupled from CloudMail auto approval.
- First successful Gmail REST sync advances governance to `google_synced`.
- ProviderAccepted remains separate from Delivered.
- Attachments, All Mail, AI local-only, Enterprise Governance, and Secret Safety guards pass.

## Fixes Applied In This Loop

- Fixed Gmail evidence-backed recovery freshness:
  - `routeSyncFailure()` now writes `last_synced_at = CURRENT_TIMESTAMP` when real ledger evidence allows recovery to `mailbox_ready`.
  - This prevents UI from showing stale sync times after a successful evidence-backed recovery.
- Fixed guard path/semantic drift:
  - AI cloud processing persistence guard now resolves the repo root correctly and protects local-only cloud AI disabled semantics.
  - Backend send eligibility contract guard now resolves the repo root correctly.
  - Provider truth receive reality guard now checks the current foreground sync function name.

## Production Deployment

- Worker deployed to `https://cloud-mail.fastonegroup.workers.dev`.
- Current Worker version: `cad4b446-b512-41ff-8dae-db9b960f26c9`.
- Cron schedules:
  - `* * * * *`
  - `0 16 * * *`

## Production Gmail State Observed

- All OAuth-backed Gmail rows observed after deploy returned to `mailbox_ready`.
- Governance rows observed:
  - `google_synced`: 7
  - `approved_waiting_google_sync`: 5
- One remaining Gmail row is intentionally blocked:
  - account_id `42`
  - status `needs_reconnect`
  - class `legacy_imap_unsupported`
  - reason: legacy Gmail IMAP credential is not receive-verifiable on Cloudflare Workers; it requires Google OAuth reconnect.

## Real iPhone Validation

- Device: `70CD0BB3-0832-5A94-BA91-82A634A54CF8`
- Bundle: `app.wangbei8554.pingguo736`
- Xcode beta build: passed.
- iPhone Mirroring:
  - Accounts opens without blank screen.
  - Gmail rows show `Connected`.
  - Sync time displays as local device time.
  - Add Gmail opens direct Gmail provider path.
  - Already-connected Gmail shows `Already Connected`, `Mailbox Ready`, and `Open Gmail Inbox`.
  - No Request Access / pending approval / invitation code behavior appeared in the normal Gmail path.

## Verification Commands

- `npm test`
- Gmail onboarding/OAuth/reconnect/sync guards
- Mailbox lifecycle truth guard
- Provider truth receive reality guard
- Backend send eligibility guards
- ProviderAccepted != Delivered guard
- Real receive/send guard set
- Attachment preservation guards
- AI cloud processing persistence guard
- Xcode beta iOS build
- Remote D1 production state checks

## Blocker

Full real-world closure of `Add Gmail -> Google OAuth -> callback -> new account created -> initial import` requires a real Gmail account that Google will allow through this OAuth client.

The attached Google error shows `403 access_denied` because Google says the OAuth app has not completed verification and can only be accessed by developer-approved testers. Cloudflare deployment cannot add Google test users or complete Google verification.

## Required Input To Continue To PASS

```text
REAL_GMAIL_TEST_INPUT
purpose: Complete CloudMail Gmail end-to-end real-world validation
required:
  gmail_address: <a Gmail address added as an approved Google OAuth test user, or usable after Google app verification>
  google_account_state: <signed-in on iPhone Safari / available in Google account chooser>
  allowed_actions:
    - start Google OAuth from CloudMail
    - approve Gmail readonly/send scopes
    - return to CloudMail callback
    - send one test email from CloudMail
    - receive one test email into the same Gmail/CloudMail All Mail
  safe_test_recipient: <recipient address for ProviderAccepted send validation>
  safe_test_sender: <sender address for timely receive validation>
  test_subject_prefix: CLOUDMAIL_E2E_TEST
constraints:
  no password or refresh token should be pasted into Codex
  user completes Google account password/2FA directly on iPhone
```

Stop state: `BLOCKED_GOOGLE_PROVIDER_RESTRICTION`.
