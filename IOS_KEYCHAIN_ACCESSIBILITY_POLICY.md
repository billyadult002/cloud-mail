# iOS Keychain Accessibility Policy (F6) — single decision per secret

Mission: CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING DESIGN. Date: 2026-07-16. Design-only.
This is the product decision (ADR-3): one accessibility class per secret, not a menu of options.

## Decisions

| Secret | **Accessibility class (decision)** | Device-bound | Background-while-locked | Backup-migrate | Requires unlock to read | New-device action |
|--------|------------------------------------|--------------|-------------------------|----------------|-------------------------|-------------------|
| S1 session token | **`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`** | yes | yes (after first unlock) | no | no (post first-unlock) | **re-login** |
| S2 secure device reference | **`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`** | yes | yes | no | no (post first-unlock) | **re-provision** |
| S3 broker pair ID | **`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`** | yes | no | no | yes | **re-pair** |
| S4 broker secret | **`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`** | yes | no | no | yes | **re-pair** |

All four gain **`ThisDeviceOnly`** ⇒ excluded from encrypted-backup restore to another device (the F6 fix).

## Rationale

- **S1 token — AfterFirstUnlock*ThisDeviceOnly*:** background sync/refresh must read the token while the
  device is locked (after the first post-boot unlock). `WhenUnlocked…` would break background refresh, so
  `AfterFirstUnlock…` is required; `ThisDeviceOnly` blocks backup migration. Re-login on a new device is
  safe and cheap (server re-issues the session; F3 model). (ADR-4)
- **S2 device reference — AfterFirstUnlock*ThisDeviceOnly*:** read at app init (may run in background),
  and it is inherently per-physical-device identity, so it must not migrate. Same class as S1 for
  consistent background availability. (ADR-5)
- **S3 pair ID + S4 secret — WhenUnlocked*ThisDeviceOnly*:** the broker is invoked by **user-initiated**
  AI actions (foreground); there is no locked-background broker path in the inventoried callsites
  (`AppState` broker paths ~`:3420–3590`). The secret is high-value (access to the owner's Mac), so the
  stricter "unlocked only" class is chosen, and S3/S4 share the **same** class to avoid a mixed
  availability state (V17). New device ⇒ re-pair (S4 cannot be restored). (ADR-6)
  - Implementation precondition: confirm no background broker invocation exists; if one is found, this
    is a documented stop/adjust point (raise S3/S4 to `AfterFirstUnlockThisDeviceOnly`, still device-bound).

## Behavioral implications (documented per V11/V12)

- **Locked device (after first unlock):** S1/S2 readable (background sync works); S3/S4 **not** readable
  (broker unavailable until unlock) — broker paths must handle "unavailable, retry after unlock" gracefully.
- **After reboot, before first unlock:** none of S1–S4 readable (all `…ThisDeviceOnly` variants require at
  least first unlock / current unlock). App shows locked/unauthenticated state; on first unlock, S1/S2
  become available and normal session resumes without re-login (item still present, just was inaccessible).
  Access-denied in this window MUST be distinguished from not-found (V10) so the app does not force logout.
