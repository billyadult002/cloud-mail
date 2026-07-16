# Secure Auth Handoff Report

Status: PASS for implementation, Worker deployment, tests, and signed IPA; BLOCKED for physical-iPhone replay

## Delivered flow

`Add Email -> discovery -> AUTH_REQUIRED -> native secure iPhone sheet -> local password entry -> AUTH_SUCCESS -> automatic continuation -> Mailbox Ready or truthful BLOCKED`.

The app implements all required states: `AUTH_NOT_REQUIRED`, `AUTH_REQUIRED`, `WAITING_FOR_USER_SECURE_INPUT`, `AUTH_IN_PROGRESS`, `AUTH_SUCCESS`, `AUTH_FAILED`, `AUTH_EXPIRED`, and `PROVISIONING_CONTINUED`.

The sheet uses a native `SecureField`, in-app principal email, provider message, Continue, and Cancel. Cancellation presents a Resume action; expiry presents a fresh secure-start action. The sheet does not make a false OTP claim: the deployed CloudMail adapter supports password authentication, while provider-specific code/OTP flows remain provider-native or truthfully blocked.

## Binding and continuation security

- Remote migration `0027_secure_auth_handoff.sql`: PASS.
- Worker version: `1b4096ef-5b1a-499b-9e78-d83db79fbe99`.
- Challenge and continuation state are held in D1, not eventually-consistent KV.
- A continuation is bound to the authenticated user, target email/domain, provider, fixed purpose, expiry, nonce, per-install device reference, and authenticated session reference.
- Atomic conditional updates ensure one mint and one consume per token. A safe challenge reference can rotate a consumed token after a transient provisioning failure without requesting the password again.
- Ready requires observed account ownership, active identity, and enabled routing; otherwise the result is structured `BLOCKED`.

## Evidence

- `npm test`: PASS.
- `npm run test:rc`: PASS, 13 files / 134 tests.
- Focused secure-auth suite: PASS, 14 tests.
- Migration safety gate: PASS.
- iOS simulator build: PASS.
- Acceptance-target build: PASS.
- Production handoff smoke: PASS using a synthetic identity and no credential; it returned only the expected purpose, expiry, and opaque challenge reference.

## Real-iPhone status

`Bill’s iPhone 17` (`00008150-000629623EC0401C`) was offline during validation. The final signed IPA is ready at [CloudMail-GPT67-Secure-Auth.ipa](/Users/billtin/Documents/cloudmail/artifacts/gpt67-secure-auth/CloudMail-GPT67-Secure-Auth.ipa). No screenshot was taken while a secure field was populated, and no credential was supplied to Codex or automation.
