# UCS Staging Benchmark Readiness Report

Mission: UCS ISOLATED STAGING SCHEMA PROVISIONING. Date: 2026-07-17.
Verdict: **STAGING_UCS_SCHEMA_PROVISIONED_BENCHMARK_READY**.

## Minimal schema contract for benchmark (ADR-9 / A17) — all satisfied

| Requirement | Status |
|-------------|--------|
| conversation_ingest_outbox with eligibility+lease columns + index | ✅ |
| conversation_materialization_checkpoints (hwm, cursor_json, lease, generation, state) | ✅ |
| conversation_aggregates / messages / projections / mail_canonical_state | ✅ |
| conversation_processing_receipts (idempotency) | ✅ |
| conversation_pipeline_failures + checkpoint quarantined_count (failure/quarantine) | ✅ |
| conversation_cutover_state / workspace_account_bindings / workspace_members (scope) | ✅ |
| eligibility + lease/fencing smoke passes; cleanup zero-residue | ✅ |

## Explicit scope boundaries (V29/V30)

- **Schema readiness ≠ harness readiness.** No benchmark harness, no dedicated authorization, no candidate
  sweep exists yet — those are the *next* mission (`UCS OUTBOX STAGING-ONLY BENCHMARK HARNESS IMPLEMENTATION
  AND CANDIDATE QUALIFICATION`).
- **Staging D1 timing ≠ production timing.** Any latency/CPU measured on staging is not a production
  verification; candidate qualification must account for this (the harness measures relative cost vs batch
  size, informing a safe B, then production applies it under its own coordinated rollout).
- Full data backup was not possible (D1 fts5 export limitation); rollback is drop-based (see rollback plan).

## Next mission entry condition (met)

Staging now has the complete UCS schema + a passing eligibility/lease smoke. The benchmark harness mission may
proceed: build the staging-only, fail-closed, authorization-gated harness + materialize-succeeding synthetic
fixture, then run the 2/10/15/20/25 sweep and qualify a candidate — all staging-only, production untouched.
