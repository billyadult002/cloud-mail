# iOS Keychain Hardening Rollout & Rollback Plan (F6)

Mission: CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING DESIGN. Date: 2026-07-16. Design-only.
Nothing here is executed by this mission; implementation is a separate, later mission.

## Rollout (implementation mission)

1. Implement per-key policy table + status-aware `Keychain` helpers (distinguish not-found vs
   access-denied) + the atomic `SecItemUpdate`-based migration hook + version marker. No entitlement,
   Bundle ID, or signing change.
2. CI: run U1–U8 (simulator/unit).
3. Real-iPhone acceptance D1–D8 (device operator), with the encrypted backup/restore D2 as the gate.
4. Ship via the normal app-distribution channel with provenance (build id / commit / tag) recorded.
   Because migration is per-device on launch, there is no fleet-wide flag; the "canary" is a limited set
   of test devices before broad distribution.

## Rollback constraints (ADR-9 / V18 / A18)

- **Code rollback is possible** (revert to the prior build). But **the hardening is not reliably
  reversible via backup:** once an item is rewritten `…ThisDeviceOnly`, that attribute persists on the
  device; you cannot depend on an old encrypted backup to restore the pre-migration accessibility.
- After a code rollback, the old build still *reads* the items (reads are class-agnostic); on its next
  *write* (e.g. token didSet at re-login) it would recreate that item under the old, weaker class — a
  security downgrade, not a lockout.
- **Therefore rollback is a mitigation for functional breakage, not a way to "undo" the device-binding.**
  If a device is somehow locked out by migration, the correct response is a **forward fix** (patch the
  status handling), never manual keychain deletion of a user's only valid credential.

## Stop conditions (A18)

Halt broad rollout and investigate if device acceptance shows any of: re-login/re-pair NOT triggered after
cross-device restore (D2 fails); spurious logout/re-pair on the same device (access-denied mis-handled);
background sync broken by the token class; a half-migrated state; or reproducible lockout. Do not proceed to
wide distribution until D2 passes and D4/D5/D6 show no regression.

## Provenance (governance)

The implementation build records its commit/tag and (for backend correlation) the active Worker Version in
`DEPLOYMENT_PROVENANCE_REPORT.md` per the deployment-provenance standard. This design mission creates no
build and no Worker Version.

## UCS / cross-work isolation

F6 implementation must not touch UCS runtime/state/epoch, must not deploy the Worker, must not enable
projection reads, and must not be merged with F4 (password KDF) or the F2/F5 production deploy. Ordering per
the program plan: F6 implementation is the last of the queued security items, after full UCS acceptance.
