# NEXORA Correlation P0 Closure Report

Mission: Universal Domain Onboarding and Correlation P0 Closure

Scope: local isolated merge candidate only
Production changes: none

## Closed findings

| Finding | Closure evidence |
| --- | --- |
| Cross-session classification consumption | Run must contain the exact acceptance session ID, actor credential reference, account, workspace, and deployment. Negative test rejects same-account classification from another session. |
| Credential takeover | Classification persist/read and acceptance consume/readback recompute the current Authorization HMAC and compare it in constant time before any write or evidence return. |
| Deployment rollover | All stages compare stored runtime ID with current `CF_VERSION_METADATA.id`; no environment-string fallback. |
| Evidence/head bypass | Projection, current event, current Evidence row, entry digest, generation, run, and ledger head are joined and cryptographically reverified before consume/readback. |
| Challenge/reference hashing | DNS token, Domain evidence/correlation, Workspace selection, auth-session, and acceptance challenge references use purpose-separated HMAC-SHA-256. |
| JWT key reuse | Removed. Dedicated correlation secret and key version are mandatory. |
| Weak secret | Secrets shorter than 32 bytes fail closed. |
| Unversioned references | HMAC key version is persisted on DNS challenges, domain verification events, acceptance sessions, classification runs, and correlation events. Classification Evidence integrity binds the version; key rotation fails closed before ownership/classification writes. |
| Client build authority | Artifact digest, source commit, signing identity/key and policy metadata come only from the reviewed server allowlist. Client authority fields are rejected. |
| Replay/idempotency | Scoped create replay/conflict semantics, consume CAS, append-only event, and receipt digest recomputation are enforced. |

## Verification

- Focused Workspace/Domain/Runtime tests: 21/21 PASS.
- Worker unit/contracts/SQLite/syntax: PASS.
- Worker reliability: 16 files, 170 tests PASS.
- Classification cross-credential/deployment negative writes: PASS, zero run rows created.
- Evidence tamper/head/generation/payload checks: PASS.
- Dependency audit: zero known production vulnerabilities.
- Diff whitespace check: PASS.
- Independent Checker: PASS, P0 count 0, no actionable findings.

## Remaining acceptance boundary

The build manifest is a strong server-side policy gate, not physical binary attestation. The schema reserves attestation references/digests, but a server-verified App Attest or equivalent verifier is not implemented in this candidate. Therefore this report closes server correlation/session/ledger P0s but does not claim physical-iPhone COMPLETE.
