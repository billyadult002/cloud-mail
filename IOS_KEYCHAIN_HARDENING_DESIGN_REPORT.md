# iOS Keychain Device-Bound Hardening — Design Report (F6)

Mission: CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING DESIGN. Date: 2026-07-16.
**Design-only.** No iOS code/Build/entitlement change, no deploy, no real secret read, no UCS interference.
**Final status: F6_DESIGN_COMPLETE.**

## Non-interference attestation (E12/E13/E14)

Read-only inspection of `Keychain.swift` + `AppState.swift` + entitlements. No real token/secret/pairID/
password was read, output, or logged. No modification to iOS source, Xcode project, entitlements, Bundle ID,
signing, Worker, backend, DB, or user sessions. `task.md`/`implementation_plan.md`/UCS ADR/acceptance NOT
written. UCS runtime/checkpoint/watermark/cursor/lease/outbox/projection/flag untouched; reads remain 0%.

## Product Decision (single answer per dimension — ADR-3)

| Secret | Accessibility class | Device-bound | Bg-while-locked | Backup-migrate | Unlock to read | New device |
|--------|--------------------|--------------|-----------------|----------------|----------------|-----------|
| S1 session token | `AfterFirstUnlockThisDeviceOnly` | yes | yes | no | no | re-login |
| S2 secure device reference | `AfterFirstUnlockThisDeviceOnly` | yes | yes | no | no | re-provision |
| S3 broker pair ID | `WhenUnlockedThisDeviceOnly` | yes | no | no | yes | re-pair |
| S4 broker secret | `WhenUnlockedThisDeviceOnly` | yes | no | no | yes | re-pair |

Full rationale: `IOS_KEYCHAIN_ACCESSIBILITY_POLICY.md`. Migration: `..._MIGRATION_STATE_MACHINE.md`.
Threat model: `..._THREAT_MODEL.md`. Tests: `..._ACCEPTANCE_MATRIX.md` + `..._REAL_IPHONE_TEST_PLAN.md`.
Rollout/rollback: `..._ROLLOUT_AND_ROLLBACK_PLAN.md`. Decisions: `docs/ADR-IOS-KEYCHAIN-DEVICE-BOUND-HARDENING.md`.
Inventory: `IOS_KEYCHAIN_SECRET_INVENTORY.md`.

## Audit answers

1. Secrets: session token, secure device reference, owner-Mac broker pair ID, broker secret.
2. Paths: see inventory (create/read/delete callsites per item).
3. Current class: `kSecAttrAccessibleAfterFirstUnlock`.
4. Synchronizable enabled? No.
5. Real cross-device risk: **encrypted-backup restore to another device** (not iCloud sync).
6. Token backup-restore allowed? No → device-bound, re-login.
7. Device reference restore allowed? No → device-bound, re-provision.
8. Broker pair ID restore allowed? No → device-bound, re-pair.
9. Broker secret restore allowed? No → device-bound, re-pair.
10. Final classes: S1/S2 `AfterFirstUnlockThisDeviceOnly`; S3/S4 `WhenUnlockedThisDeviceOnly`.
11. Access while locked? S1/S2 yes (after first unlock); S3/S4 no.
12. Reboot before first unlock: all inaccessible; resume on first unlock (no re-login).
13. Re-login on new device? Yes.
14. Re-pair owner Mac on new device? Yes.
15. Migration: atomic `SecItemUpdate(kSecAttrAccessible=target)` per item via a versioned launch hook.
16. Idempotent? Yes (marker + no-op re-runs).
17. Migration failure recovery: leave old item intact, retry next unlocked launch; app still works.
18. Avoid delete-before-write loss: use `SecItemUpdate` (no delete); never remove the only valid item.
19. Rollback limits: code-only; ThisDeviceOnly not reliably reversible via backup; fix lockouts forward.
20. Simulator tests: migration logic, status handling, idempotency, writer class (U1–U8).
21. Real-iPhone required: encrypted backup/restore device-binding, lock/reboot/background, upgrade (D1–D8).
22. Verify backup/restore: encrypted backup(A) → restore(B); confirm S1–S4 absent ⇒ re-login/re-provision/re-pair.
23. Any real secret read/logged? No.
24. Any code/Build/production/UCS change? No.
25. F6 status: **F6_DESIGN_COMPLETE**.
26. When may implementation start? After full UCS acceptance and per the security queue (entry criteria below).

## Next Implementation Mission — entry criteria (Required Output #10)

**CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING IMPLEMENTATION** may begin only when ALL hold:
1. UCS `PARITY_PASS_VERIFIED` → projection-read cutover → target Build → real-iPhone final acceptance complete.
2. F4 password-KDF implementation and F2/F5 production deploy have taken their scheduled slots (F6 is last).
3. A device operator with ≥2 physical iPhones + encrypted-backup capability + a paired owner-Mac is available.
Scope: implement the policy table + status-aware Keychain helpers + atomic migration hook + version marker;
U1–U8 in CI; D1–D8 real-iPhone acceptance (D2 backup/restore is the gate); provenance recorded. Must not touch
UCS state, must not deploy the Worker, must not enable projection reads, must not merge with F4 or F2/F5.

## Verdict

**F6_DESIGN_COMPLETE** — inventory, corrected threat model, per-secret accessibility decisions, idempotent
migration state machine, failure/rollback limits, and a real-iPhone acceptance plan are all defined. No secret
read, no code/Build/deploy/UCS change. F6 remains **NOT fixed / NOT implemented**.
