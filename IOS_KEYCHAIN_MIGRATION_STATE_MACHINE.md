# iOS Keychain Accessibility Migration State Machine (F6)

Mission: CLOUDMAIL IOS KEYCHAIN DEVICE-BOUND SECURITY HARDENING DESIGN. Date: 2026-07-16. Design-only.

## Principles

- **Atomic per item:** change accessibility with `SecItemUpdate(query, { kSecAttrAccessible: targetClass })`
  — this rewrites the attribute **in place, no delete**. There is never a window where the only valid
  credential is absent (V7/V8/A11).
- **Idempotent:** re-running is safe — an already-migrated item's update is a harmless no-op; a
  UserDefaults marker `keychainAccessibilityMigrationVersion` records completion but the operation is safe
  even if the marker is missing/repeated (V6/A10).
- **Fail-closed & status-aware (V9/V10):** distinguish `errSecItemNotFound` (nothing to migrate) from
  `errSecInteractionNotAllowed`/other access-denied (device locked / pre-first-unlock). Access-denied ⇒
  leave the item untouched and retry on a later unlocked launch; **never** delete on ambiguous status.

## Per-item migration

```mermaid
stateDiagram-v2
    [*] --> CHECK: app launch, migrationVersion < target
    CHECK --> ABSENT: SecItemCopyMatching = errSecItemNotFound
    CHECK --> DENIED: access-denied (locked / pre-first-unlock)
    CHECK --> PRESENT: item found

    ABSENT --> DONE_ITEM: nothing to migrate (fresh install / new device)
    DENIED --> RETRY_LATER: leave as-is; re-attempt next unlocked launch (no delete)
    PRESENT --> UPDATE: SecItemUpdate kSecAttrAccessible = targetClass (atomic)
    UPDATE --> VERIFY: read back; confirm value intact + new class
    VERIFY --> DONE_ITEM: success
    VERIFY --> RETRY_LATER: update/verify failed -> leave old item intact, retry later
```

## Overall migration

```
onLaunch():
  if UserDefaults[keychainAccessibilityMigrationVersion] >= TARGET: return
  allDone = true
  for item in [S1(AfterFirstUnlockTDO), S2(AfterFirstUnlockTDO), S3(WhenUnlockedTDO), S4(WhenUnlockedTDO)]:
     result = migrateAccessibility(item.key, item.targetClass)   // per-item SM above
     if result == RETRY_LATER: allDone = false
  if allDone: UserDefaults[keychainAccessibilityMigrationVersion] = TARGET
  // marker set ONLY when every item is ABSENT or migrated+verified -> no partial "migrated" claim (V8/A12)
```

- **Writer alignment:** `Keychain.set(...)` must also be updated so *new* writes use the per-key target
  class (so a fresh token/device-ref/broker item is created device-bound). The migration hook handles
  *existing* items; the writer handles *future* items. Both use the same per-key policy table.
- **S3/S4 note:** `WhenUnlockedThisDeviceOnly` items can only be migrated/verified while unlocked; a locked
  launch defers them (RETRY_LATER) — correct, not a failure.

## Cleanup behavior (A13)

- **Logout / delete:** `SecItemDelete` S1 (and any per-account items); device reference and broker items
  are unaffected by logout unless the flow explicitly unpairs.
- **Account switch:** delete S1 for the old session before writing the new one (existing token didSet
  overwrites; ensure delete-before-add is not the credential-loss pattern for the *migration* — it is fine
  for a deliberate logout/switch).
- **Broker unpair:** delete S3+S4 together (existing `:3498/3499/3583/3584`), keeping them consistent (V17).

## Failure downgrade (A12)

If migration cannot complete (persistent access-denied or update failure), the app continues to function
with the old-class items (still readable) and retries next launch. No half-migrated authentication state
is possible because (a) `SecItemUpdate` is atomic per item and (b) the version marker is set only after all
items are ABSENT-or-verified. Worst case is "hardening not yet applied," never "user locked out."

## State-consistency invariant (V17)

At any time each item is either fully old-class or fully new-class; S3 and S4 always share the same class;
no item is ever deleted before its replacement is confirmed. There is no mixed session/device-ref/broker
state that yields partial authority.
