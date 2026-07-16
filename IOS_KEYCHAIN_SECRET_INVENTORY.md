# iOS Keychain Secret Inventory (F6, read-only)

Mission: CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING DESIGN. Date: 2026-07-16.
Read-only source inspection of `files/GlassMail-project`. No real token/secret/pairID/password value
was read, output, or logged (E12).

## Keychain wrapper (`GlassMail/Services/Keychain.swift`)

- Class `kSecClassGenericPassword`, `kSecAttrService = "com.fastonegroup.glassmail"`, `kSecAttrAccount = key`.
- `set(value,key)`: `SecItemDelete` then `SecItemAdd` with `kSecValueData` + **`kSecAttrAccessible =
  kSecAttrAccessibleAfterFirstUnlock`** (line 28). `set(nil,…)` ⇒ delete.
- `get(key)`: `SecItemCopyMatching` (returnData, matchLimitOne) → `String?`; **any** non-`errSecSuccess`
  status returns `nil` (item-not-found and access-denied are conflated — E10/V10).
- `delete(key)`: `SecItemDelete`.
- **Not used (E6):** `kSecAttrSynchronizable`, `kSecAttrAccessGroup`, `kSecAccessControl`/`SecAccessControl`,
  Secure Enclave, `LAContext`/biometrics, application password, device-passcode requirement.

## Current attributes (E4/E5)

All four items use `kSecAttrAccessibleAfterFirstUnlock`; **`kSecAttrSynchronizable` is NOT set**
(grep: the only `kSecAttr*` hit is the accessible attribute). Entitlements
(`GlassMail/GlassMail.entitlements`): `app-sandbox`, `network.client`, `ubiquity-kvstore-identifier`
(iCloud key-value store for UserDefaults — **not** Keychain sync); no `keychain-access-groups`.

## Items (E1/E2/E3)

| # | Key (account) | Type | Create | Read | Delete | Lifecycle | Authority boundary | Bg-while-locked need | Should backup-migrate? | New-device expected |
|---|---------------|------|--------|------|--------|-----------|--------------------|----------------------|------------------------|---------------------|
| S1 | `cloudmail_token` | session auth token | `AppState.swift:284` (`token` didSet) | `:1093` (init) + refresh paths | `token=nil` ⇒ `set(nil)` on logout | whole session | full user API access | **yes** (background sync/refresh) | **No** | re-login |
| S2 | `cloudmail_secure_device_reference_v1` | secure device reference | `:1466` | `:1462` | (device reset paths) | device identity | device-identity binding | yes (startup) | **No** | re-provision device reference |
| S3 | `cloudmail_owner_mac_broker_pair_id` | owner-Mac broker pair ID | `:3432` | `:82,3459,3462,3522,3525` | `:3498,3583` (unpair) | broker pairing | identifies the paired owner-Mac broker | no (user-initiated AI actions) | **No** | re-pair |
| S4 | `cloudmail_owner_mac_broker_pair_secret` | owner-Mac broker secret | `:3433` | with S3 | `:3499,3584` (unpair) | broker pairing | **grants access to owner-Mac local AI broker** | no (user-initiated) | **No** | re-pair |

## Server / recovery semantics (E7/E8/E9)

- **S1 token (E7):** server-issued session; losing/rotating it is safe — the user re-authenticates and
  the server issues a new token (see F3 logout/session model). No client-only irrecoverable state.
- **S2 device reference (E8):** if absent/changed, the device re-provisions its reference on next
  authenticated flow; a restored device is legitimately a *different* device and should re-provision.
- **S3/S4 broker (E9):** if the broker secret is absent, the owner-Mac pairing flow re-runs
  (`AppState` broker pairing paths ~`:3420–3590`); a new device must re-pair to obtain a fresh secret.

## Migration hook (E11)

**None exists** — no `migrat*` logic in `AppState.swift`/`Keychain.swift`. The hardening design must
introduce a unified, versioned migration hook (see the migration state machine).

## Non-interference (E13/E14)

No iOS source/project/entitlements/Build change; no `task.md`/`implementation_plan.md`/UCS file change;
no production/UCS state touched. Read-only inspection only.
