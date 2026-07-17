# UCS Staging Schema Rollback Plan

Mission: UCS ISOLATED STAGING SCHEMA PROVISIONING. Date: 2026-07-17. Staging-only.

## Why a drop-based rollback is sufficient (A6/ADR-6/ADR-7)

The provisioning is purely additive (no DROP/DELETE/rebuild in 0023–0056) and existing staging data was empty
(account/user/email = 0). Therefore rollback needs no data restore — it only removes newly-created objects.

## Rollback options (staging D1 only; never production)

1. **Object drop:** drop the objects created by 0023–0056 (the delta between the pre-apply snapshot
   `staging-preapply-schema.txt` (108 objects) and the post-apply schema). Because triggers/indexes are tied
   to their tables, dropping the new tables (28 `conversation_*` + the other new tables) removes dependent
   objects. Order: drop triggers/indexes if needed, then tables. This restores the pre-apply object set.
2. **Ledger reset:** delete rows 0023–0056 from staging `d1_migrations` after the object drop, returning the
   ledger to 0022 (so a future `migrations apply` re-provisions cleanly).
3. **Full reset:** if a clean slate is preferred, re-provision staging D1 from migrations 0001→NNNN in a fresh
   DB (staging is isolated, no production impact).

## Recovery reference

Pre-apply snapshot: scratchpad `staging-preapply-schema.txt` (sha256 `18d61e71…`), listing all 108 pre-apply
objects. Any object not in that list was created by this provisioning and is safe to drop on rollback.

## Constraints

Rollback SQL executes only on `cloud-mail-staging` (`--env staging`). No production D1/KV/R2/Worker touched.
