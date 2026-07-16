# Real Use Testing Checklist

Date: 2026-07-07

## Enterprise Directory Profile Sync And Device Restore Update

- Enterprise Directory real iPhone validation: PASS.
- Contact Profile real iPhone validation: PASS.
- Star/VIP Contact Profile state: PASS.
- Domain Directory real iPhone validation: PASS.
- Profile Sync V2 real iPhone validation: PASS.
- Device Restore real iPhone validation: PASS.
- Multi-device view real iPhone validation: PASS.
- Compose Autocomplete V2 To/Cc/Bcc real iPhone validation: PASS.
- Installed IPA: `artifacts/enterprise-directory-profile-sync/CloudMail-EnterpriseDirectoryProfileSync-final-owner-signed.ipa`.
- Evidence: `artifacts/enterprise-directory-profile-sync/enterprise-directory-profile-sync-real-iphone-xctest-final.log`.

---

Date: 2026-07-05

## 1. AI Checks

- Confirm Gemini usable status remains visible and honest.
- Confirm ChatGPT Local Broker is available only as local broker, not Cloud OAuth.
- Open an email and run AI Summary.
- Confirm AI Briefing/Summary auto-expands.
- Run Translate and confirm a result card or visible fallback appears.
- Run Draft Reply with AI.
- Run AI Center chat.
- Run AI Center Safe Mail Actions.

## 2. Email Detail Checks

- Open a message.
- Tap star button.
- Tap Reply.
- Tap Forward.
- Open AI Actions.
- Use Translate language selection.
- Confirm result card supports original/translation view, copy, and language change.

## 3. Accounts Checks

- Confirm known production blocker for Alistair/Bill remains visible.
- Confirm domain identity status is honest.
- Confirm CloudMail routing active status is scoped to current evidence.
- Confirm Compose From list after production Worker deploy.
- Accounts Diagnostics restored: PASS on real iPhone.
- OAuth Diagnostics V2 Google tester status: PASS on real iPhone.
- Request Access -> Pending Approval ledger flow: PASS on real iPhone.
- OAuth Approval Center sections: PASS on real iPhone.
- Google Tester Management ledger workflow: PASS on real iPhone.
- Account Recovery Center: PASS on real iPhone.
- Unified Provider Health Center: PASS on real iPhone.

## 4. Compose Checks

- Confirm From selector.
- Confirm send eligibility.
- Confirm ProviderAccepted is not reported as Delivered without delivered evidence.
- Confirm AI Assist buttons complete or show fallback without indefinite spinner.
- Plain text real send: Provider accepted for `CloudMail real-use send test 20260706-121605`.
- Receive validation: confirmed externally for `bill@fastonegroup.com` and subject `CloudMail real-use send test 20260706-121605`.
- All Mail aggregation: production Worker deployed and real iPhone showed the bill inbound row in search.
- Unified local ledger: confirmed on real iPhone for the sent/provider-accepted test subject.
- Attachment test: PASS on real iPhone using safe synthetic text attachment `cloudmail-safe-attachment-test-20260706-151301.txt`; send provider accepted, recipient row received, preview opened, local Save to Files sheet visible.
- Outbox invalid recipient: PASS on real iPhone for `invalid-recipient`; Send disabled and local validation visible.
- Outbox retry/failure/cancel: PASS on real iPhone for safe synthetic subjects with timestamp `20260706-162235`; failed/cancelled rows visible and not Delivered.
- Outbox All Mail local ledger: PASS on real iPhone; All Mail search found unified local Outbox rows.

## 5. Sync / Freshness Checks

- Confirm routing active display.
- Confirm sync pending/required display.
- Confirm health pending display.
- Confirm last sync display.

## 6. Safety Checks

- No token exposure.
- No mailbox content in generated reports.
- No Delivered claim unless delivered evidence exists.
- No browser session, cookie, OAuth code, token-file, or refresh-token access.

## 7. Device Boundary

- Install/launch/process presence can be claimed only when performed.
- Manual UI inspection can be claimed only when performed.
- Endurance, thermal, battery, and memory claims require measurement.
# Real Use Testing Checklist Update

Date: 2026-07-07

- Enterprise Productivity Platform V1 real iPhone validation: PASS.
- Settings compact menu unification real iPhone validation: PASS.
- Growth-list folding: PASS for Enterprise Hub and governance/tester/audit/request lists.
- Installed IPA: `artifacts/enterprise-productivity-platform-v1/CloudMail-EnterpriseProductivityPlatformV1-owner-signed.ipa`.
- Evidence: `artifacts/enterprise-productivity-platform-v1/enterprise-productivity-platform-v1-real-iphone-xctest-settings-compact-1.log`.

---

Date: 2026-07-07

- Enterprise Access Governance real iPhone validation: PASS.
- Gmail connected-vs-blocked diagnostic contradiction: FIXED.
- Admin Gmail authorization status edit action: PASS in real iPhone acceptance.
- IPA installed on real iPhone: `artifacts/enterprise-access-governance/CloudMail-EnterpriseAccessGovernance-owner-signed.ipa`.
- Evidence: `artifacts/enterprise-access-governance/enterprise-access-governance-real-iphone-xctest-8.log`.

---
