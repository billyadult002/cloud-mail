# iOS Keychain Real-iPhone Test Plan (F6)

Mission: CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING DESIGN. Date: 2026-07-16. Design-only.
Executed by a device operator in the future implementation mission. This design mission runs no device tests.

## Devices & prerequisites (V19)

- **Device A** (source) and **Device B** (restore target) — two physical iPhones, or one device + a
  clean-restore cycle that lands on different hardware. Simulators are insufficient for backup/restore (V20).
- A Mac with Finder/iTunes encrypted backup enabled (encryption ON — required for keychain items to be
  backed up at all). A paired owner-Mac for the AI broker.
- Target Build = the new hardened build against the **production** backend (Worker `525681a1`) with active
  UCS config (reads still 0%); a synthetic/non-sensitive test account preferred.

## Procedure

1. **Baseline (A):** install target Build on A, log in, provision device reference, pair owner-Mac broker.
   Confirm normal use. (No secret values are read/recorded — only success/failure and item presence.)
2. **Encrypted backup of A → restore to B (D2, the key test):**
   - Encrypted backup A; restore to B.
   - On B: confirm the app **requires re-login**, **re-provision** of the device reference, and **re-pair**
     of the owner-Mac broker — i.e. S1–S4 did not carry over. This is the F6 pass condition.
3. **Same-device restore (D3):** encrypted backup A → restore to A ⇒ session/pairing intact.
4. **Lock/background (D4):** lock A during a background refresh window; verify sync continues (S1/S2 usable)
   and broker actions are deferred until unlock (S3/S4 gated).
5. **Reboot/first-unlock (D5):** reboot A; before first unlock the app is locked/unauthenticated; after first
   unlock the session resumes with no re-login (item present, was merely inaccessible).
6. **Upgrade (D6):** install old build, log in + pair; upgrade to target Build; confirm one-time migration,
   no logout, no re-pair, items now device-bound.
7. **Reinstall (D7):** delete + reinstall; document observed keychain persistence and that the app recovers
   (re-login if items cleared).

## Evidence to capture (no secret values)

Per step: device model/iOS, build id/commit/tag, UTC timestamp, and observed behavior (logged-in? re-login
prompted? broker paired? sync succeeded?). Screenshots of app state (not of secret values). Correlate the
target Build's commit/tag/Worker to the acceptance record.

## Non-goals / limits (V20)

Backup/restore device-binding is validated **only** on hardware. A green simulator/unit run is a
prerequisite, not the acceptance. Projection-read cutover and UCS acceptance are separate and unaffected.
