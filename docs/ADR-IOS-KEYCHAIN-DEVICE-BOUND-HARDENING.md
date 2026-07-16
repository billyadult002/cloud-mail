# ADR: iOS Keychain Device-Bound Hardening (F6)

Status: Proposed (design complete; implementation gated behind full UCS acceptance and the security queue).
Date: 2026-07-16. Design-only — no iOS code/Build/entitlement change, no deploy, no UCS interference.
Related: `IOS_KEYCHAIN_HARDENING_DESIGN_REPORT.md`, `IOS_KEYCHAIN_SECRET_INVENTORY.md`,
`IOS_KEYCHAIN_THREAT_MODEL.md`, `IOS_KEYCHAIN_ACCESSIBILITY_POLICY.md`,
`IOS_KEYCHAIN_MIGRATION_STATE_MACHINE.md`, `IOS_KEYCHAIN_ACCEPTANCE_MATRIX.md`,
`IOS_KEYCHAIN_ROLLOUT_AND_ROLLBACK_PLAN.md`, `IOS_KEYCHAIN_REAL_IPHONE_TEST_PLAN.md`,
`SECURITY_FINDINGS_TRIAGE_REPORT.md` (F6).

## ADR-1 — Current state

`Keychain.swift:28` writes all four items with `kSecAttrAccessibleAfterFirstUnlock`. `kSecAttrSynchronizable`
is **not** set (no iCloud Keychain sync). No access group, access control, Secure Enclave, or biometrics.

## ADR-2 — Corrected risk model

The exposure is **not** iCloud Keychain sync (disabled). It is that non-`ThisDeviceOnly` items are eligible
for **encrypted-backup restore onto a different device**, resurrecting the session token, device reference,
and broker secret beyond the authorized device.

## ADR-3 — Unique accessibility policy per secret

Single decisions (no option lists): S1 token = `AfterFirstUnlockThisDeviceOnly`; S2 device reference =
`AfterFirstUnlockThisDeviceOnly`; S3 broker pair ID = `WhenUnlockedThisDeviceOnly`; S4 broker secret =
`WhenUnlockedThisDeviceOnly`. See the accessibility policy for full rationale.

## ADR-4 — Session token decision

`AfterFirstUnlockThisDeviceOnly`. Rationale: background sync/refresh needs post-first-unlock access while
locked (so not `WhenUnlocked…`), and device-binding blocks backup migration. Effect: unaffected background/
push/refresh after first unlock; inaccessible before first unlock after reboot; new device ⇒ re-login (safe).

## ADR-5 — Secure device reference decision

`AfterFirstUnlockThisDeviceOnly`. It is per-device identity, read at init (possibly background). A restored
device is a different device and must re-provision.

## ADR-6 — Broker pair ID + secret decision

Both `WhenUnlockedThisDeviceOnly` (kept identical to avoid mixed state). Broker use is user-initiated
(foreground); no locked-background path found. New device ⇒ **forced re-pair** (S4 cannot restore). If an
unforeseen background broker path exists, the documented adjustment is `AfterFirstUnlockThisDeviceOnly`
(still device-bound) — a stop/adjust point at implementation.

## ADR-7 — Migration atomicity/idempotency/failure

Per item: `SecItemUpdate(kSecAttrAccessible=target)` (atomic, no delete). Idempotent; guarded by a
`keychainAccessibilityMigrationVersion` marker set only when every item is absent-or-verified. Access-denied
⇒ retry later, never delete. No half-migrated auth state (V8).

## ADR-8 — Backup/boot/upgrade/reinstall behavior

Cross-device encrypted restore ⇒ items absent ⇒ re-login/re-provision/re-pair. Same-device restore ⇒ intact.
Reboot before first unlock ⇒ inaccessible then resumes on unlock (no re-login). Upgrade ⇒ one-time migration,
no logout/re-pair. Reinstall ⇒ document observed keychain persistence; app recovers by re-login if cleared.

## ADR-9 — Rollback limits

Code rollback is possible but does **not** reliably restore the old accessibility; do not rely on old backups
to undo device-binding. Lockouts (if any) are fixed forward, never by deleting a user's only credential.

## ADR-10 — Real iPhone is the acceptance authority

Encrypted backup/restore device-binding is validated only on ≥2 physical devices. Simulator/unit results are
prerequisites, never the backup/restore PASS.

## Decision

Adopt the per-secret device-bound accessibility policy with an atomic, idempotent, status-aware migration.
Implementation is a separate later mission (entry criteria in the design report). This ADR changes no code,
Build, production, or UCS state. **F6 status: F6_DESIGN_COMPLETE** (not CODE_FIXED / FIXED_DEPLOYED / FIXED_VERIFIED).
