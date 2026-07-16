# Real iPhone Secure Auth Audit

Status: BLOCKED — device offline

- Device: Bill’s iPhone 17 (`00008150-000629623EC0401C`)
- Bundle: `app.wangbei8554.pingguo736`
- Deployment: Worker `1b4096ef-5b1a-499b-9e78-d83db79fbe99`; migration `0027_secure_auth_handoff.sql` applied.
- IPA: [CloudMail-GPT67-Secure-Auth.ipa](/Users/billtin/Documents/cloudmail/artifacts/gpt67-secure-auth/CloudMail-GPT67-Secure-Auth.ipa)
- Signing: Apple Distribution team `4GGH43VE67`; bundle/signature verification passed.

The device listing reported the target iPhone as offline. Therefore installation, launch, empty-sheet observation, and the `admin@hengmao.org` replay were not attempted.

When the phone reconnects, the validation protocol is:

1. Install and launch the signed IPA.
2. Navigate to Add mailbox and enter `admin@hengmao.org`.
3. Verify the empty native Secure sign in sheet.
4. Codex stops automation. The user enters authentication locally on the iPhone only.
5. Observe automatic provisioning resume and record only ready/blocked state and safe audit evidence.

No password, OTP, or token was requested, entered, read, logged, transported, or screenshot by Codex.
