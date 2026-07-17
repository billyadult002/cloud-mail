# UCS Outbox Staging Benchmark — Root-Blocker Evidence & Non-Interference (read-only)

Mission: UCS OUTBOX STAGING-ONLY BENCHMARK HARNESS IMPLEMENTATION AND CANDIDATE QUALIFICATION
Date: 2026-07-17
Verdict: **OUTBOX_STAGING_HARNESS_BLOCKED_WITH_EVIDENCE** · Candidate decision: **NO_SAFE_CANDIDATE**
(measurement absent — NOT proof that limits 2/10/15/20/25 are unsafe).

This is a companion to the existing (untracked) draft deliverables
(`UCS_OUTBOX_STAGING_HARNESS_IMPLEMENTATION_REPORT.md`, `..._BENCHMARK_RESULTS.md`,
`..._CANDIDATE_DECISION.md`, `..._CLEANUP_REPORT.md`, `UCS_OUTBOX_SYNTHETIC_FIXTURE_SPEC.md`,
`..._AUTHORIZATION_SPEC.md`, `..._BENCHMARK_RUNBOOK.md`, `docs/ADR-UCS-OUTBOX-STAGING-SYNTHETIC-HARNESS.md`).
Those were authored by the parallel process and are left untouched. This file records the independent,
read-only evidence I gathered and the deeper root blocker they do not capture.

## Not repeated (CP1/CP2)

- RCA already complete: commit `38f61de` (OUTBOX_THROUGHPUT_RCA_AND_DESIGN_COMPLETE). Not re-run.
- `UCS_OUTBOX_DRAIN_LIMIT` already implemented: commit `3b46ecd`, tag `ucs-outbox-drain-limit-staging-pending`
  (`outboxDrainLimit()` in `unified-conversation-backfill-service.js:8`; default 2, clamp ≤25, only
  `processIngestOutbox` affected). Not re-implemented.

## Root blocker (definitive, read-only, `rows_written=0`)

The prior drafts cite "no dedicated staging authorization / no harness endpoint / staging lacks UCS
activation flags." Those are true but secondary. The **fundamental** blocker is the staging **schema**:

- `wrangler d1 execute cloud-mail-staging --remote` (read-only): staging D1 has **50 tables but ZERO
  `conversation_*` tables** and no `conversation_ingest_outbox`. The UCS migration set (≈0044–0056:
  `conversation_ingest_outbox`, `conversation_aggregates`, `conversation_messages`, `mail_canonical_state`,
  `conversation_materialization_checkpoints`, `conversation_cutover_state`, `conversation_projections`)
  has **not been applied to staging D1**.
- Therefore, even with a perfectly authorized staging-only harness, there is **no `conversation_ingest_outbox`
  table to seed** and `processIngestOutbox` (which reads the outbox and calls `materialize()`/`processRow()`
  against the absent conversation tables) **cannot execute**. No real per-limit latency/CPU measurement is
  obtainable on staging as currently provisioned.

Consequence: candidate qualification for B ∈ {2,10,15,20,25} is **unmeasurable on staging now** ⇒
NO_SAFE_CANDIDATE (evidence-absent), consistent with the mission's stated current staging verdict.

## Unblock prerequisite (for the follow-up)

Before any harness benchmark can produce valid data, staging D1 must be provisioned with the UCS schema:
apply migrations ≈0044–0056 to `cloud-mail-staging` (note the documented historical replay dependency at
migration 0002 for a fresh DB — this schema-provisioning is its own scoped step, not a casual in-benchmark
action). Only after the `conversation_*` tables exist can the synthetic fixture (per the fixture spec) be
seeded and the real `processIngestOutbox` path be exercised and timed.

## Why the harness was not built/deployed in this mission

Two evidence-based reasons: (1) the staging benchmark is unmeasurable regardless of harness code (missing
schema), so deploying a benchmark endpoint yields no measurement; and (2) adding a benchmark HTTP surface +
fixture-write code to the shared production Worker **during active UCS production convergence** adds surface
and risk for zero benefit. Harness implementation + execution is therefore deferred to a follow-up gated on
staging-schema provisioning.

## Production non-interference (read-only, verified)

- Production Worker remains **`525681a1`** (100% active). `projection_read_enabled=0`
  (`rows_written=0`). `UCS_HWM_COMPLETION_ENABLED="true"` (wrangler.toml). Production UCS verdict unchanged:
  NATIVE_RECLAIM_CONFIRMED_CONVERGENCE_IN_PROGRESS.
- No production deploy, no staging deploy, no config/flag change, no D1/KV/R2 write anywhere, no UCS
  checkpoint/watermark/cursor/lease/outbox/projection change. `task.md`/`implementation_plan.md`/active UCS
  ADR/acceptance NOT written. No real email/token/secret read.

## Audit answers (key)

- Why not re-run RCA / re-implement limit? Done at `38f61de` / `3b46ecd`.
- Harness execution model? Staging-only Worker endpoint gated by staging-env + staging-D1 identity +
  `BENCHMARK_HARNESS_ENABLED` + dedicated benchmark secret + synthetic namespace (fail-closed) — **designed,
  not built** (blocked).
- Limit 10/15/20/25 results? None — unmeasurable (no staging UCS schema).
- First unsafe candidate? Unknown — not measured.
- Recommended candidate? NO_SAFE_CANDIDATE (evidence-absent).
- Fixtures cleaned? Vacuously — none were created (staging has no outbox table to seed).
- Harness authority closed? None was created.
- Production Worker/flag/reads changed? No — `525681a1` / true / 0%.
- Final verdict? **OUTBOX_STAGING_HARNESS_BLOCKED_WITH_EVIDENCE.**

## Next

Per the mission's NEXT-IF-BLOCKED path: continue the long-interval **UCS HWM V3 NATIVE CONVERGENCE AND
PARITY CHECKPOINT** (read-only, ≥1 h cadence). Separately, a scoped **staging UCS-schema provisioning**
step is the prerequisite that would let a future harness benchmark actually run and qualify a candidate.
