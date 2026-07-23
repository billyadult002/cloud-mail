# Checkpoint 5 Unresolved Items

1. The exact Workspace 1 Domain Authority and account binding are verified, but the locally reviewed authenticated Gmail OAuth launch control is not yet deployed.
2. Production has zero consumed Google authorization sessions and zero eligible Google token/provider-connection bindings. Human consent must complete through the canonical Google callback with only `mail_read`.
3. No authenticated live Gmail health request, production Connection Evidence/Verification transition, enabled negative production matrix, or full rollback drill has occurred.
4. Migration 0081 is applied. The current active Worker version `a64cc08e-65f4-49a1-88b5-0572821a691c` carries the bounded exact allowlists; automatic refresh remains disabled and must stay disabled through acceptance.
5. Checkpoint 5 validates the Connection Runtime and Gmail linking lifecycle foundation only; it does not complete Sync Runtime, real-time email sync, watch, get_delta, Microsoft live integration, provider writes, or `EMAIL_TAB_INTERACTION_FAILURE`.
