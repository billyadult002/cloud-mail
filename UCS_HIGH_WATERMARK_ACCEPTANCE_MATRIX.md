# Acceptance Test Matrix — High-Watermark Completion

Mission: UCS HIGH-WATERMARK COMPLETION AND PARITY ENABLEMENT (design only)
Date: 2026-07-16

Tests are specified for the implementation mission. Runtime tests belong in
`scripts/reliability-tests/` (vitest + `@cloudflare/vitest-pool-workers`, matching the repo).
No production execution here.

## Unit / pure-logic tests (no I/O)

| ID | Scenario | Assertion | Verifies |
|----|----------|-----------|----------|
| U1 | freeze W once | second epoch-open CAS does not overwrite existing `high_watermark` | V1, I1 |
| U2 | encode/decode composite W | `(created_at,id)` round-trips; tuple compare correct across same-second | design §1 |
| U3 | scope predicate | rows with key ≤ W included; key > W excluded; boundary (=W) included | V3, V7 |
| U4 | ready latch | given a fixed ≤W set fully cursored, `ready(W)` = true and stays true after injecting a >W row | V2, V5 |
| U5 | readiness ignores growth | adding rows > W leaves `ready(W)` unchanged | V6 |

## Integration tests (mock D1 / pool-workers)

| ID | Scenario | Assertion | Verifies |
|----|----------|-----------|----------|
| I1 | converge under ingest | seed ≤W set + continuously insert >W rows during the run → checkpoint reaches `state='ready'` at W | V5, V6, A5 |
| I2 | parity eligibility | with backfill+membership+V3 ready at W and zero ≤W failures/outbox → parity runs and passes | V4, A4 |
| I3 | parity excludes live | inject unresolved failure and unprocessed outbox for records **> W** → parity still passes at W | V4, A5 |
| I4 | parity blocks on ≤W gap | inject one unprocessed outbox for a record **≤ W** → parity `unexplained>0`, not passed | parity spec |
| I5 | no record loss | after `Completed(W_n)`, open epoch n+1; every record in (W_n, MAX] gets a projection | V7, A6 |
| I6 | no duplicate projection | re-run a completed epoch (lease reclaim) → no new `conversation_projections` rows; receipts dedupe | V8 |
| I7 | immutability under reclaim | kill mid-run, reclaim (generation++) → `high_watermark` unchanged, cursor resumes | V1, I3 |
| I8 | epoch monotonicity | `Completed(W_n)` parity row remains `passed=1` after epoch n+1 opens | I4 |

## Production acceptance walkthrough (A10) — read-only, post-implementation

Executed only after the implementation mission deploys (separate authorization). All steps
are SELECT-only against production D1 (`rows_written=0`), matching the UCS monitor discipline:

1. Confirm `high_watermark` is non-null and stable across two observations (immutable).
2. Confirm checkpoint reaches `state='ready'` while `conversation_ingest_outbox` for records
   > W is still non-zero (ingest ongoing) — proves A5.
3. Confirm a `conversation_projection_parity` row with `passed=1` at that W.
4. Confirm `projection_read_enabled=0` throughout (A7 — no read enablement).
5. Confirm no manual checkpoint/lease edits occurred (audit trail; A8/A9).

## Exit criteria

All U*/I* green in CI; production walkthrough steps 1–5 observed read-only. Only then does the
next mission (COMPLETION_VERIFICATION → PARITY_EXECUTION → FULL_PRODUCTION_PASS_EVALUATION) begin.
