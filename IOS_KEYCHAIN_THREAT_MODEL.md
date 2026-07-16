# iOS Keychain Backup/Restore Threat Model (F6)

Mission: CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING DESIGN. Date: 2026-07-16. Design-only.

## Corrected risk model (ADR-2) — the important distinction

- **NOT the risk here:** iCloud Keychain *synchronization*. That requires `kSecAttrSynchronizable=true`,
  which the app **does not set**. Items are not synced across devices via iCloud Keychain.
- **The actual risk:** items using an accessibility class **without `…ThisDeviceOnly`** (currently
  `kSecAttrAccessibleAfterFirstUnlock`) are **eligible for inclusion in an encrypted device backup**
  (encrypted iTunes/Finder backup) and can be **restored onto a different physical device**. After such
  a restore, the session token, secure device reference, and owner-Mac broker secret would be present on
  a device that is not the originally-authorized one — granting access/authority beyond the intended
  device boundary until the server or user intervenes.

## Assets

S1 session token (full user API authority), S2 secure device reference (device identity), S3 broker
pair ID, S4 broker secret (access to the owner's Mac local AI broker). See the inventory.

## Threats & mitigations (target design)

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Cross-device credential resurrection | encrypted backup of device A restored to device B carries S1–S4 | mark all four `…ThisDeviceOnly` so they are excluded from backups that restore to another device |
| Silent authority on restored device | S1/S4 usable on B without user action | device-bound items absent on B ⇒ forced re-login (S1) and re-pair (S3/S4); re-provision (S2) |
| Spurious lockout from access-denied | conflating `errSecItemNotFound` with access-denied ⇒ delete/logout | distinguish statuses; access-denied ⇒ retry later, never delete (V10) |
| Half-migrated auth state | change accessibility by delete-then-add and crash between | use atomic `SecItemUpdate` of `kSecAttrAccessible`; never delete the only valid item (V7/V8) |
| Broker secret exposure while locked | background read of S4 on a locked device | S4 (+S3) `WhenUnlockedThisDeviceOnly` — unavailable while locked; broker is user-initiated |
| Downgrade via rollback | old build rewrites items as non-ThisDeviceOnly | rollback is code-only; hardened items stay device-bound; no reliance on backup to "restore" old attr (ADR-9) |
| Secret disclosure in logs/tests | debugging / acceptance | never read/print real token/secret/pairID; device tests assert presence/absence + behavior, not values (E12) |

## Non-goals

No change to iCloud Keychain sync (already off), no biometric/Secure-Enclave gating in this scope
(may be a future enhancement), no server auth-protocol change. The scope is accessibility-class
device-binding + a safe migration.
