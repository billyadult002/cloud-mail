# UCS W2 Outbox Safe Acceleration Options (design)

Mission: UCS W2 FROZEN-SNAPSHOT OUTBOX DRAIN THROUGHPUT RCA. Date: 2026-07-17. Design-only.

## Invariants every option must preserve (ADR-6 / A15 / V9–V13)

Frozen watermark unchanged; only ≤W processed; >W never enters current parity; idempotency via
receipts + digest-keyed projections + `supersedes_id`; lease fencing intact; `processed` only from real
success; no fabricated completion; projection reads stay 0% until Parity PASS.

## Options evaluated (ADR-7)

| # | Option | Leverage | Risk | Verdict |
|---|--------|----------|------|---------|
| O1 | **Raise ≤W outbox batch limit** (decouple from shared `limit=2`; measured-safe B) | High (drain ≈5×B/hr) | Low — same single consumer, per-invocation count only; bounded by CPU/wall measurement | **SELECTED** |
| O2 | Move outbox stage earlier / ahead of W1 | Low–Med | Med — reorders a shared loop; risks W1/ingest fairness & correctness (V17) | Rejected |
| O3 | Dedicated scheduled trigger for outbox | High (raises F_eff) | Med–High — new trigger + must prevent concurrent double-consume with existing consumer (V16) | Rejected (scope/risk) |
| O4 | Cloudflare Queue consumer for outbox | High | High — new infra, delivery semantics, double-consume guardrails, bigger surface | Rejected (scope/risk) |
| O5 | Split CPU-heavy V3 rematerialization from outbox drain | Med | Med — restructures monitorScheduled; larger change | Rejected (bigger than needed) |
| O6 | D1 index covering `(tenant_id,workspace_id,state,lease_until,created_at)` | Low–Med (cuts per-query wall time) | Low, but requires a migration (out of scope here) | Deferred follow-up (not this mission) |
| O7 | NO_CHANGE (accept ~9.4-day convergence) | 0 | 0 | Rejected — a safe evidence-backed improvement exists (V19 not triggered) |

## Why the rejected options are unsuitable now (ADR-8)

- O2/O5 reorder or restructure a correctness-sensitive shared pipeline (W1 live cutover + ingest + backfill
  + V3 + parity); the risk to Gmail ingest / W1 readers outweighs the modest gain.
- O3/O4 add infrastructure and a real **double-consumption** hazard (two consumers racing the same outbox
  rows) that must be fenced; higher build + verification cost than the ≤W batch raise, for the same goal.
- O6 needs a schema migration (forbidden here) and only trims wall time, not the batch/frequency caps.
- O7 is not justified: O1 is a low-risk, reversible, invariant-preserving improvement.

## Selected: O1 — raise the ≤W outbox batch limit (measured-safe, flag-gated)

- Introduce a dedicated bound for the ≤W outbox drain (e.g. env `UCS_OUTBOX_DRAIN_LIMIT`, default = current
  2 so default behavior is unchanged), read by `processIngestOutbox`, **separate** from the shared
  `runWorkspace` limit so backfill batch is unaffected.
- Set B by **staging measurement** (V15): choose the largest B whose per-invocation `elapsedMs` and CPU stay
  within the scheduled-event budget with margin and whose failure rate stays 0. Candidate range 10–25;
  the number is measured, not guessed.
- Single consumer unchanged ⇒ no double-consume (V16 N/A). Lease/receipt/digest/fencing untouched (V11).
  Watermark/parity scope untouched (V9/V10). Reversible by setting the env back to 2 (flag rollback, V14).
