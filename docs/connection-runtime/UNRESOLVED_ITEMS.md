# Checkpoint 5 Unresolved Items

1. Migration 0082 must be committed, applied once remotely, and verified before retrying the existing pending read-only OAuth launch.
2. Production has zero consumed Google authorization sessions and zero eligible Google token/provider-connection bindings. Human consent must complete through the canonical Google callback with only `mail_read`; the first launch stopped before Google on the generation-zero schema guard.
3. No authenticated live Gmail health request, production Connection Evidence/Verification transition, enabled negative production matrix, or full rollback drill has occurred.
4. Migration 0081 is applied. Worker version `9b143fab-4c10-48c1-b694-222f40bb2333` carries immutable commit `2176869ef1d55947be1180f8b2343b5f454a8106` and the bounded exact allowlists; automatic refresh remains disabled and must stay disabled through acceptance.
5. Checkpoint 5 validates the Connection Runtime and Gmail linking lifecycle foundation only; it does not complete Sync Runtime, real-time email sync, watch, get_delta, Microsoft live integration, provider writes, or `EMAIL_TAB_INTERACTION_FAILURE`.
