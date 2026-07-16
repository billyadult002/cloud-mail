# P30 Final Real iPhone Acceptance Report

Date: 2026-07-06

## Status

`CLOUDMAIL_P30_FINAL_REAL_IPHONE_ACCEPTANCE_AND_HOLD_ELIGIBILITY_COMPLETED`

## Real Device Build Identity

- Device: real iPhone, UDID `70CD0BB3-0832-5A94-BA91-82A634A54CF8`.
- Installed app: CloudMail.
- Bundle id: `app.wangbei8554.pingguo736`.
- Version: `1.0`.
- Build: `1`.
- Xcode: `27A5194q`.
- Latest repaired app bundle timestamp: `2026-07-06 16:25:49`.
- Latest key iOS source timestamp before bundle: `2026-07-06 16:25:30`.
- Acceptance: `latest_fix_build_running = TRUE`.

## Mail Core Acceptance

- Inbox loaded: PASS.
- Search loaded: PASS.
- All Mail search for `121605`: PASS.
- Email detail opened: PASS.
- Reply/Forward/Translate/AI action surfaces visible: PASS.
- AI Briefing surface visible on email detail: PASS.
- Evidence:
  - `evidence/p30-inbox-20260706-165042.png`
  - `evidence/p30-all-mail-search-121605-20260706-165042.png`
  - `evidence/p30-email-detail-actions-121605-20260706-165042-v2.png`

Result: `mail_core_acceptance = PASS`.

## Send / Outbox Acceptance

- Compose invalid recipient validation: PASS.
- Send button disabled for invalid recipient: PASS.
- ProviderAccepted row in All Mail remains `Provider accepted; delivery not confirmed`: PASS.
- Outbox failed state visible: PASS.
- Outbox cancelled state visible: PASS.
- Stored local state summary confirmed `failed_permanent` and `cancelled`: PASS.
- Evidence:
  - `evidence/p30-compose-invalid-recipient-20260706-165042.png`
  - `evidence/p30-outbox-state-machine-20260706-165042.png`
  - `evidence/p30-outbox-state-summary-20260706-165042.json`

Result: `outbox_state_machine = PASS`.

## Attachment Acceptance

- Attachment preview opened: PASS.
- Attachment text content visible: PASS.
- Attachment share/export sheet opened: PASS.
- Save to Files visible: PASS.
- Evidence:
  - `evidence/p30-attachment-preview-20260706-165042.png`
  - `evidence/p30-attachment-share-export-20260706-165042.png`

Result: `attachment_acceptance = PASS`.

## Account Acceptance

- Accounts page loaded: PASS.
- Sync state visible: PASS.
- Routing active visible: PASS.
- Capability display `Can send` visible: PASS.
- Timestamps visible for Gmail accounts: PASS.
- Account Center loaded: PASS.
- Gmail connected / mailbox access entry visible: PASS.
- OAuth live smoke: NOT CLAIMED.
- Evidence:
  - `evidence/p30-accounts-20260706-165042.png`
  - `evidence/p30-account-center-oauth-messaging-20260706-165042.png`

Result: `account_acceptance = PASS`.

## AI Acceptance

- AI Center loaded: PASS.
- AI Workspace ready surface visible: PASS.
- Mailbox health / local workflow surface visible: PASS.
- Email Detail AI Briefing surface visible: PASS.
- Email Detail AI action surface visible: PASS.
- Apple Intelligence live success: NOT CLAIMED. The detail screenshot reports Apple Intelligence unavailable or disabled for that action at capture time.
- Gemini usable: NOT CLAIMED.
- ChatGPT cloud usable: NOT CLAIMED.
- Evidence:
  - `evidence/p30-ai-center-20260706-165042.png`
  - `evidence/p30-email-detail-actions-121605-20260706-165042-v2.png`

Result: `ai_surface_acceptance = PASS`.

## Boundaries

- Production deploy: NOT RUN.
- Production migration: NOT RUN.
- `verify.sh`: NOT RUN.
- Production Closure: NOT REOPENED.
- `IPA_READY`: NOT MODIFIED.
- `PASS_PRODUCTION_READY`: NOT MODIFIED.
- `STATUS=CLOSED`: NOT MODIFIED.
- Delivered: NOT CLAIMED.
- OAuth live smoke: NOT CLAIMED.
- Endurance/battery/thermal/memory: NOT OBSERVED.
