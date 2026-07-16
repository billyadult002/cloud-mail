# UCS W2 Completion Blocker — Source-Level RCA (companion)

Mission: UCS W2 COMPLETION BLOCKER ROOT-CAUSE INVESTIGATION
Date: 2026-07-16
Priority: P0 CRITICAL — read-only. No production mutation.

## Relationship to existing artifacts

A concurrent UCS monitor independently produced `UCS_W2_COMPLETION_BLOCKER_REPORT.md`
and `docs/ADR-UCS-W2-COMPLETION-BLOCKER.md` at 13:58 UTC. **This companion does not
overwrite them.** It corroborates their conclusion (the 13:32–13:37 gap was a transient
interruption that self-recovered; present state is normal bounded convergence, not
completion) and adds what those documents leave open: the **exact source component that
blocks completion**, the **throughput ceiling**, and the **elimination of the two deploys
as the cause** — items the mission's Audit Requirements explicitly demand.

## Non-interference attestation

One read-only `SELECT` on `audit_logs` (`rows_written: 0, changed_db: false`). No
checkpoint/cursor/outbox/projection/lease/scheduler change. Projection reads 0%.
FULL_PRODUCTION_PASS not declared. Concurrent monitor's two files left untouched.

## Deploy-causation elimination (A5) — disclosed and ruled out

This session deployed F1 (Worker `101308e4`, 13:25:50 UTC) and F3 (`d05ffd3e`,
13:42:22 UTC) to the UCS-monitored Worker. Both are eliminated as the cause of the
13:31:33 telemetry stop:

- Telemetry continued **~6 minutes after F1** (13:25:50 → last audit 2453 @ 13:31:33).
- F3 (13:42:22) occurred **after** the stop; telemetry resumed at 13:49:19 (audit 2531–2537, success).
- Identical intermittent scheduler gaps (68 min, 81 min) are documented in `task.md`
  **before any deploy today**.

Conclusion: the gap belongs to the chronic Cloudflare scheduled-event intermittency, not
to the deploys. A redeploy re-registers triggers and, if anything, aided recovery — but
deploying during an active W2 invocation can interrupt that invocation, so it remains an
operational caution, not the outage cause.

## Exact blocking component (A6 / A7) — the source-level answer

Files: `src/service/unified-conversation-backfill-service.js`, `src/index.js`.

1. **Parity trigger — `monitorScheduled` line 102:**
   `if (run.ready && membership.ready) run.parity = parityWorkspace(...)`.
   Parity only runs when the backfill pipeline (`run`, `PIPELINE='ucs-backfill-v1'`) is ready.
2. **Readiness definition — `runWorkspace` line 66:** `const ready = rows.length < remaining;`
   `ready` latches only when a batch under-fills, i.e. the queue is momentarily empty (quiescence).
3. **`parityWorkspace` line 75** independently requires a backfill checkpoint in `state='ready'`,
   else returns `backfill_not_ready`; its pass condition (line 92) needs
   `coverageMissing==0 && unexplained(failures+non-processed outbox)==0 && missing==0 && extra==0 && contentMismatch==0`.
4. **V3 target growth — `rematerializeWorkspaceV3` line 101:** the V3 cursor traverses
   `conversation_aggregates`, a set that grows as ingest creates new conversations.
5. **Throughput ceiling — `index.js:297`:** ~10 ms CPU per scheduled invocation (Free plan);
   the per-minute path (`index.js:300`) processes `limit=2` (outbox/backfill), `membership=25`,
   `V3=5` per minute.

**Mechanism:** continuous per-minute Gmail ingest keeps creating `conversation_aggregates`
and `conversation_ingest_outbox` rows, so the backfill batch never under-fills →
`runWorkspace.ready` never latches → the parity gate at line 102 never fires → checkpoint
stays `NOT_READY` and parity stays `NOT_RUN`. Simultaneously the V3 target keeps growing and
throughput is capped at ~2–5 rows/invocation, so `missing` (1289), cursor remaining (1680),
and outbox (1706) cannot reach zero. This is a **quiescence-based completion model competing
with live ingest**, not a bug, corruption, or a lease/scheduler defect.

## Lease behavior at 13:37:26 (V4) — by design, not a fault

`claimCheckpoint` sets `LEASE_SECONDS=60`; during processing the lease is renewed to
`now + 5 minutes` per row (line 101). The terminal release
(`state=ready|paused, lease_owner=NULL, lease_until=NULL`) runs **only if the loop completes**.
The last invocation before the gap renewed the lease to ~13:37:26 then ended before
completing (scheduler gap / CPU eviction), so the release never ran and the lease expired
naturally. The next cron reclaimed it (`claimCheckpoint` reclaims `lease_until<=now`,
bumping the generation) — evidenced by generation 84→97 and telemetry resuming at 13:49.
"Expired unreleased" is the fencing/crash-recovery path working as designed.

## Verification (V1–V6)

| ID | Verdict | Basis |
|----|---------|-------|
| V1 cron fired after 13:31:33 | No during gap; yes by 13:49:19 | wrapStep emits per invocation; audit 2531–2537 |
| V2 handler entered after 13:31:33 | Same as V1 | telemetry absence then resumption |
| V3 lease recovery executed | Yes | gen 84→97, telemetry resumed |
| V4 runtime exited cleanly at gap | No | terminal release not persisted → lease expired unreleased |
| V5 completion conditions true | No | missing 1289, cursor 1680, outbox 1706, target growing |
| V6 checkpoint-ready remains false | Yes | `rows.length<remaining` cannot latch under ingest |

## Production-safe remediation target (recommendation only — no change here)

For the NEXT (targeted-fix) mission, the isolated code area is:

1. **Watermark-frozen completion** (primary): make `runWorkspace.ready`
   (`unified-conversation-backfill-service.js:66`) and the parity trigger (`:102`) evaluate
   "backfill covered everything ≤ a FROZEN `high_watermark`" instead of "no pending work at
   all." `parityWorkspace` already binds to `cp.high_watermark`; this lets `ready` latch and
   parity run against a snapshot even while new mail arrives beyond the watermark.
2. **Throughput** (secondary): the 10 ms Free-plan CPU ceiling (`index.js:297`) caps ~2–5
   rows/invocation; a paid-plan CPU budget or a bounded higher-limit catch-up window lets the
   one-time backfill outpace ingest.
3. **Scheduler continuity** (operational): intermittent scheduled-event gaps are a Cloudflare
   delivery trait; a redundant trigger or external heartbeat, plus avoiding redeploys during
   active W2 windows, protects the pre-parity freshness gate.

No code changed and no production state modified in this mission.
