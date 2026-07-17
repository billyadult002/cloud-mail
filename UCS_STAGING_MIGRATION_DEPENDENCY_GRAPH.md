# UCS Staging Migration Dependency Graph

Mission: UCS ISOLATED STAGING SCHEMA PROVISIONING. Date: 2026-07-17. Read-only analysis + applied set.

## Ledger-derived closure (E5/V1/V2)

Staging `d1_migrations`: 0002–0022 applied. Pending = **0023–0056** (34 files, incl. duplicate-numbered
0029/0044/0045 as distinct filenames). Applying the full pending production sequence in order guarantees a
closed dependency graph with no unresolved reference (production ran this exact order).

## Key UCS surfaces and their creating migrations (created objects)

| Migration | UCS-relevant objects created (subset) |
|-----------|----------------------------------------|
| 0028_workspace_management_os | workspace_members, workspace_mailboxes, workspace_* |
| 0041_enterprise_identity_membership_delegation | workspace_membership_* |
| 0042_classification_commitment_thread_mission | conversation_* (classification/commitment/thread), communication_commitments |
| 0043_commitment_lifecycle_fencing_hardening | commitment fencing triggers; UPDATE communication_commitments (backfill) |
| 0044_mail_action_integrity | mail_canonical_state, mail_action_* |
| 0044_workspace_account_bindings | workspace_account_bindings |
| 0045_hybrid_local_mail_evidence | hybrid/evidence tables |
| 0045_workspace_account_binding_subjects | UPDATE workspace_account_bindings (subject backfill; empty) |
| 0046_unified_conversation_system | conversation_aggregates, conversation_messages, conversation_projections, conversation_evidence, conversation_facet_heads/results, conversation_commitment_heads, conversation_processing_receipts, conversation_materialization_checkpoints |
| 0047_ucs_authoritative_cutover | conversation_ingest_outbox, conversation_cutover_state, idx_ucs_ingest_pending |
| 0048–0050 | UCS mission evidence semantics, cutover gate, rollout cohorts |
| 0051 | UCS projection pipeline indexes |
| 0052/0054/0055 | sender-bulk classification + reconciliation ledgers |
| 0053 | primary-category exclusivity trigger |
| 0056 | projection membership contract |

## Ordering notes (V1)

- `conversation_ingest_outbox` (0047) depends on cutover/workspace scope (0028/0047). Applied in order ⇒ satisfied.
- `conversation_materialization_checkpoints` (0046) precedes cutover (0047). Satisfied.
- Duplicate 0044/0045 applied in filename order (mail_action_integrity → workspace_account_bindings;
  hybrid_local_mail_evidence → workspace_account_binding_subjects); the 0045 subject-backfill UPDATE targets
  the 0044-created `workspace_account_bindings` ⇒ order 0044<0045 satisfies it.

## Result

No unresolved references; the pending sequence applied cleanly (all 34 ✅). See post-apply verification.
