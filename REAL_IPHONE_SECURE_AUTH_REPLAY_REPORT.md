# Real iPhone Secure Auth Replay Report

Status: WAITING FOR USER-LOCAL AUTHENTICATION — secure handoff boundary reached

## Completed evidence

- Physical device service identified the paired iPhone as available: `70CD0BB3-0832-5A94-BA91-82A634A54CF8`.
- Installed final signed application bundle `app.wangbei8554.pingguo736`.
- Launched the installed application successfully through the physical-device service.
- Rebuilt after removing the legacy pre-auth activation route, signed the replacement IPA, and reinstalled it on the same physical device.
- Replayed non-secret discovery for `admin@hengmao.org` through Add mailbox.
- Confirmed the native **Secure sign in** sheet appears with the provisioning target shown and an empty secure Password field. The sheet states that NEXORA will resume provisioning automatically.
- IPA used: [CloudMail-GPT67-Secure-Auth.ipa](/Users/billtin/Documents/cloudmail/artifacts/gpt67-secure-auth/CloudMail-GPT67-Secure-Auth.ipa).

## Current pause boundary

iPhone Mirroring is active and the physical device is paused at the empty native secure-auth sheet. No interaction with the Password field will be performed by Codex.

No password, OTP, verification code, activation secret, provider token, or continuation token has been entered, viewed, recorded, inferred, transmitted, or screenshot by Codex.

## Remaining protocol

1. User enters the required credential only on the physical iPhone and taps **Continue securely**.
2. Codex inspects only the post-submit, non-secret result state.
3. Record `MAILBOX_READY` or a truthful structured `BLOCKED` state.
