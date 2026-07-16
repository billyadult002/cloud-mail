# iOS Keychain Hardening Acceptance Matrix (F6)

Mission: CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING DESIGN. Date: 2026-07-16. Design-only.
Tests specified for the future implementation mission. Assert presence/absence + behavior — **never**
read or print real token/secret/pairID values (E12/A15-analog).

## Simulator / unit-testable (necessary, not sufficient)

| # | Scenario | Expected |
|---|----------|----------|
| U1 | migrate present item | `SecItemUpdate` sets target class; value intact on read-back |
| U2 | migrate absent item | `errSecItemNotFound` ⇒ treated as nothing-to-migrate, no error |
| U3 | migrate under access-denied (simulate status) | RETRY_LATER; item untouched; no delete |
| U4 | idempotent re-run | second run is a no-op; marker respected |
| U5 | not-found vs access-denied distinction | different code paths (V10) |
| U6 | writer uses per-key class | new S1/S2 = AfterFirstUnlockTDO; S3/S4 = WhenUnlockedTDO |
| U7 | version marker set only when all done | partial (one RETRY_LATER) ⇒ marker NOT advanced |
| U8 | logout/unpair cleanup | S1 deleted on logout; S3+S4 deleted together on unpair |

**Simulator CANNOT** validate encrypted-backup device-binding (V20) — those are device-only (below).

## Real-iPhone required (authoritative — ADR-10 / V19 / A14–A17)

Requires ≥2 physical devices (source A, restore-target B), or an equivalent source+restore pair.

| # | Scenario | Expected |
|---|----------|----------|
| D1 | fresh login on A (new build) | S1–S4 written device-bound; app works |
| D2 | encrypted backup(A) → restore to B | **S1–S4 absent on B** ⇒ B forces re-login (S1), re-provision (S2), re-pair (S3/S4) |
| D3 | same-device encrypted backup → restore to A | items present; no re-login/re-pair (same device) |
| D4 | device lock, background refresh | S1/S2 readable (sync works); S3/S4 not readable until unlock |
| D5 | reboot, before first unlock | S1–S4 inaccessible; after first unlock, session resumes with **no** re-login (item present) |
| D6 | old build → new build upgrade (same device) | migration runs once; items become ThisDeviceOnly; **no** logout, **no** re-pair |
| D7 | app reinstall | document observed keychain persistence/clear behavior; app handles either (re-login if absent) |
| D8 | access-denied window handling | no spurious logout/re-pair when items are temporarily inaccessible |

## Exit criteria

All U* green in CI; D1–D8 observed on real hardware with the encrypted backup/restore (D2) demonstrating
device-binding. A simulator-only pass **must not** be recorded as a backup/restore PASS (V20/A20-analog).
