# ADR-UCS-WORKSPACE2-FRESHNESS-COMPLETION

## Completion-monitor decision — 2026-07-16 01:27 UTC

Decision: **continue scheduler-only observation; parity is not authorized**.

The prior comparison baseline is the independently certified 01:07:23 snapshot: Workspace 2 V3 checkpoint generation 11, processed 55, target 2,034, cursor remaining 1,979, and 314 current V3 projections. The read-only 01:27:14 sample returned generation 19, processed 95, state `paused`, no owner/lease, quarantine 0, target 2,049, remaining 1,953, and 377 current V3 projections (18.40% coverage).

Target growth is +15 and processed delta is +40. The requested reconciliation gives `1979 + 15 - 1953 = 41`, not 40. A later creation-time probe observed one post-baseline aggregate whose ordered ID is at/before the current cursor; therefore total target growth is not identical to growth after the cursor. This is a live-target ordering effect, not evidence of a cursor reset.

Current V3 projection count increased by 63 while the V3 checkpoint processed 40. Provenance since baseline contains 40 current rows linked to `ucs-projection-rematerialize-v3:1:2`, 17 linked to the atomic `ucs-checkpoint:1:2`, and 15 linked to `ucs-live-checkpoint:1:2`. Atomic and live paths are legitimate production projection writers. Their version replacement/materialization activity is explicitly distinguished from the ordered V3 traversal and is never described as a competing writer.

Eight persisted `unifiedConversation` telemetry cycles (IDs 1922–1971, 01:07:32–01:14:34) report Workspace 2 V3 processed 40, failed 0, ready false. Workspace 2 ingest telemetry reports 15 processed and 1 failed; the outbox ledger shows 16 rows processed and 3 created in the window, so backlog net decreased by 13. Frozen outbox state is 1,785 pending, 1 failed, 842 processed; unresolved pipeline failures are zero. The latest UCS telemetry remains 01:14:34, and subsequent target creation proves the target was not stable.

Conditional forecasts are separate: V3 traversal has `ceil(1953/5)=391` successful cycles remaining (~6h31m nominal) if minute delivery resumes, throughput remains five, and no targets are added. Ingest has an observed ledger gross rate of 2 processed rows/cycle and net rate of 1.625 rows/cycle, forecasting roughly 893 cycles gross or 1,100 cycles net for the current nonprocessed population, subject to arrivals and separate recovery of the failed row.

Parity was not run because checkpoint readiness, exact coverage, target stability, scheduler continuity, and outbox-zero predicates all fail. No rematerializer, cursor reset, projection change, outbox cleanup, read enablement, or early parity action occurred. This decision does not declare `FULL_PRODUCTION_PASS`.

**Date:** 2026-07-15  
**Status:** BLOCKED — V3 rematerialization is not authorized

## Supersession and reconciliation — 2026-07-16

This ADR's original 2026-07-15 snapshot is **SUPERSEDED** by the production
reconciliation snapshot at `2026-07-16 00:52:06 UTC`. It remains historical
evidence only and must not be used to infer V3 completion.

1. Workspace 2 v2 membership freshness and Workspace 2 V3 completion are
   separate facts. The former is `ready`, generation `127`, cursor equal to
   aggregate head, and lag `0`; it did not create a V3 checkpoint.
2. `processed_count=372` belongs solely to
   `ucs-projection-rematerialize-v3:1:1` (Workspace 1, generation `114`), not
   Workspace 2. A generation or processed count is never meaningful without
   checkpoint ID, pipeline key, workspace, cursor, and materializer version.
3. The current evaluator freezes ten authoritative parity surfaces: the six
   product workflow surfaces (`all_mail`, `categories`, `action_required`,
   `waiting_for_me`, `waiting_for_others`, `mission_control`) plus the four
   canonical membership surfaces (`vip`, `unread`, `starred`, `attachments`).
   The former six-surface contract is therefore not a substitute for the
   deployed ten-surface audit.
4. Coverage and correctness are independent gates. A current projection row
   is insufficient; V3 completion requires one current V3 projection per
   aggregate and zero same-epoch parity defects.
5. The scheduler routing defect was confirmed in deployed source: it invoked
   the fenced V3 path only for Workspace 1 even though the scope query selected
   both dual-write workspaces. The successor repair routes every selected scope
   through the existing `materialize()`, lease, generation-fence, checkpoint,
   and parity path with the existing bounded limit.
6. Projection reads remain at `0%` until backend gates, canary, rollback
   verification, target build, and real-iPhone acceptance are independently
   complete. This ADR does not declare FULL_PRODUCTION_PASS.

## Workspace 2 V3 scheduler execution certification — 2026-07-16

The Scheduler Repair was deployed at `2026-07-16 00:55:09 UTC` as Worker
`40ff8b98-911d-49de-82b4-97ae6a374ad0`, routed at 100%, with the minute Cron.
Production telemetry then recorded scheduler-owned Workspace 2 V3 execution:

| telemetry ID | UTC | Workspace 2 V3 result |
| ---: | --- | --- |
| 1845 | 00:56:45 | claimed, 5 processed, 0 failed |
| 1852 | 00:57:28 | claimed, 5 processed, 0 failed |
| 1859 | 00:58:27 | claimed, 5 processed, 0 failed |

At the single final snapshot `2026-07-16 00:59:30 UTC`, checkpoint
`ucs-projection-rematerialize-v3:1:2` was readable as `running`, generation
`4`, processed `18`, quarantined `0`, cursor
`conversation:02e1ad32-c8c6-40a8-aa8c-d761cc29feb3`, and `2002` ordered
aggregate rows remained. This is native scheduler evidence, not Workspace 1
reuse, manual cursor movement, a direct projection rewrite, or a competing
writer. No unresolved native Workspace 2 V3 failure exists.

Forecast methodology: use durable cursor lag / observed completed batch size.
The observed batch is 5 rows per successful minute-cron run. At snapshot,
`ceil(2002 / 5) = 401` successful scheduler cycles remain; the nominal
minute-cron elapsed bound is approximately 401 minutes (6 h 41 m), conditional
on the target set not growing and the observed 5-row scheduler capacity
continuing. This forecasts V3 traversal only; it is not parity or product
acceptance.

## Independent scheduler-delivery certification — 2026-07-16

An independent production snapshot at `01:07:23 UTC` confirms that the same
100%-routed Worker `40ff8b98-911d-49de-82b4-97ae6a374ad0` continues to receive
the minute Cron and enter `unifiedConversation`. Telemetry IDs `1845` through
`1915` show Workspace 2 selected in every observed invocation; each reports
the existing fenced V3 path as `claimed=true`, `processed=5`, `failed=0`.

The independently reread Workspace 2 checkpoint is
`ucs-projection-rematerialize-v3:1:2`, `paused` after its bounded turn,
generation `11`, processed `55`, quarantined `0`, with persisted continuation
cursor `conversation:0796e35c-19cc-498a-99e1-1c832cd20030`. Workspace 1 uses
its distinct key and is unmodified by Workspace 2 ownership. The terminal
paused/no-owner state after each bounded turn, unique-current projection counts,
and sequential telemetry results provide the fencing/no-competing-writer
evidence. No Workspace 2 native V3 failure exists. Historical Workspace 1
local-adapter failures remain separate; their matching-resolution behavior was
not exercised in Workspace 2 and is therefore not claimed.

At this snapshot Workspace 2 has 2,034 aggregate targets, 314 current V3
projections, and 1,979 cursor-remaining rows. The measured lower-bound
throughput is five durable rows per completed cron cycle, yielding
`ceil(1979 / 5) = 396` cycles (nominally about 6 h 36 m at one minute per
cycle). The target population grew during observation, so this is a conditional
traversal forecast, not a completion guarantee. Scheduler Delivery and
Checkpoint Certification is PASS; parity, read canary, and FULL_PRODUCTION_PASS
remain separate unmet gates.

## Decision

Workspace 2 is not fresh and V3 fenced rematerialization remains **BLOCKED**. No V3 run, projection-row mutation, checkpoint reset, or lease-fence bypass was performed.

## Production evidence snapshot

Read-only production D1 queries at 2026-07-15 13:53:32 UTC returned:

| Field | Value |
| --- | --- |
| checkpoint | `ucs-projection-membership:1:2` |
| state / owner | `paused` / `NULL` |
| lease generation | `43` |
| lease until | `NULL` |
| updated at | `2026-07-15 13:48:12 UTC` |
| processed count | `1687` |
| cursor | `conversation:e7979c37-8cc2-43c3-931a-af9b39e7d5b5` |
| aggregate head | `conversation:fff3dc7b-5904-4c10-baf4-7bd9e130c080` |
| aggregate count | `1872` |
| remaining lag | `162` |
| unresolved membership failures | `0` |
| unresolved backfill failures | `0` |

Lag was calculated as the number of Workspace 2 `conversation_aggregates` whose ordered ID is greater than the checkpoint cursor. The cursor is not at the aggregate head, so no zero-lag claim is valid.

## Generation and lease history

| Generation | Durable progress | Lease/final state | Interpretation |
| --- | --- | --- | --- |
| 41 | `processed_count=1530`, lag `318` | expired running lease, then conditional stale recovery | recovery preserved cursor/count and did not alter projections |
| 42 | `1530 → 1609`, lag `318 → 239` | later naturally reclaimed by generation 43 | scheduled telemetry observed concurrent fenced ownership (`membership.claimed=false`) |
| 43 | `1609 → 1687`, lag `239 → 162` | expired without final terminal release; conditional stale recovery left `paused`, owner `NULL` | progress/cursor commits were durable, but the run did not reach the terminal zero-lag checkpoint |

The materializer renews its lease before each row and commits its cursor/count after each row. Therefore the durable increments prove renewal and checkpoint commits occurred during generations 42 and 43. The absence of a terminal release/ready transition, combined with no later scheduled telemetry, is not evidence of a checkpoint-commit failure.

## Runtime telemetry

The latest persisted `unifiedConversation` scheduled telemetry is audit-log ID `1208`, at `2026-07-15 13:43:35 UTC`, `ok=true`, elapsed `30,680 ms`. Workspace 2's normal backfill/live work advanced in that invocation, while membership reported `claimed=false`, consistent with another valid fenced writer owning generation 43.

Previous runs for generations 42/43 completed in roughly 30–33 seconds and showed the same legitimate contention. A read-only Worker tail observation spanning approximately 50 seconds and a new audit query at 13:53:32 UTC found no later telemetry event.

## Root-cause classification

**OTHER_VERIFIED_CAUSE — scheduled runtime termination or delivery gap after a valid fenced writer began work.**

This classification excludes lease-renewal failure and checkpoint-commit failure for the rows whose durable cursor/count advances were observed. It also excludes a scheduler-overlap defect: `membership.claimed=false` is the intended one-writer fencing behavior. The available evidence cannot distinguish a platform delivery gap from runtime termination after the last observed invocation, so neither is asserted as uniquely proven.

## Freshness gate

| Requirement | Result |
| --- | --- |
| Workspace 2 reclaim observed | PASS (generations 42 and 43) |
| Lease healthy through terminal completion | FAIL (no terminal zero-lag lifecycle) |
| Processed count/cursor advance | PASS |
| Lag reaches zero | FAIL (`162`) |
| Cursor at aggregate head | FAIL |
| Freshness stable for another scheduled cycle | FAIL (no later telemetry) |
| V3 fenced rematerialization | **BLOCKED** |

## Required resumption evidence

Continue only through the deployed production scheduler. Before authorizing V3, capture a completed Workspace 2 lifecycle showing a healthy terminal lease release, `lag=0`, checkpoint cursor equal to aggregate head, no pending membership work, and one subsequent scheduled cycle with the same zero lag.

## Scheduler-continuity remediation attempt — 2026-07-15

At 13:56 UTC, the current production Worker (`cloud-mail`, version `5df32977-1f5f-48d9-b25a-63c6cf8eae30`, 100% traffic) had its existing trigger configuration explicitly reattached using Wrangler's production trigger deployment command:

* `* * * * *`
* `0 16 * * *`

This changed only the Worker trigger attachment; it did not deploy code or mutate D1, checkpoint rows, cursor JSON, lease fencing, or projections. The command confirmed both schedules were attached. Read-only telemetry checks at 13:57:46, 13:58:31, and 13:59:00 UTC still returned audit-log ID `1208` at 13:43:35 UTC as the latest `unifiedConversation` invocation. Scheduler continuity is therefore not yet demonstrated.

## POST_134335 scheduler execution forensics — 2026-07-15

* **Last successful scheduled execution:** the 13:43 UTC minute invocation of production Worker version `5df32977-1f5f-48d9-b25a-63c6cf8eae30`, routed at 100%.
* **Last successful telemetry:** `unifiedConversation` audit ID `1208` at `13:43:35 UTC`; the final step from that same invocation, `gmailSync`, completed successfully at `13:43:39 UTC`. There is no later scheduled telemetry and no later failed `unifiedConversation` telemetry.
* **Last checkpoint update:** the checkpoint's final persisted `updated_at` is `13:48:12 UTC`, from the conditional stale-lease recovery; it retained generation 43, count 1687, and cursor. There is no later normal materializer commit.
* **Next expected execution:** approximately `13:44 UTC`, because the active configuration contains `* * * * *`.
* **Verified root cause:** `SCHEDULED_EVENT_DISPATCH_GAP_UPSTREAM_OF_WORKER`. The active routed version exposes a `scheduled` handler, its minute Cron is configured/attached, and the final 13:43 invocation emitted successful telemetry for every scheduled step. The absence of an invocation or failure record after the expected 13:44 dispatch excludes a Worker handler, D1 transaction, lease, cursor, or checkpoint code failure as the stopping point.
* **Single repair action:** publish a fresh production Worker version with the unchanged explicit Cron configuration (`* * * * *`, `0 16 * * *`) so Cloudflare creates a new scheduled-event binding, then verify a new `unifiedConversation` telemetry event before allowing the existing fenced scheduler to continue Workspace 2 catch-up. A trigger-only reattachment has already been attempted and did not restore dispatch.

## Fresh binding deployment verification — 2026-07-15

* `npm run check` passed.
* Fresh production version `c7a34b8e-39a8-4b44-94e5-ab7459e82169` was uploaded and deployed with the unchanged explicit schedules `* * * * *` and `0 16 * * *`.
* The deployment confirmed both schedule attachments. A first post-deployment production read at `14:26:28 UTC` still found the newest `unifiedConversation` telemetry at `13:43:35 UTC`, with the Workspace 2 checkpoint unchanged at generation 43, processed count 1687, and lag 162.
* Therefore the version/binding recreation is deployed but not yet validated as an execution repair. No direct D1/checkpoint/projection mutation was performed.

## ADR-UCS-V3-CLAIM-ONLY-RECOVERY — 2026-07-16

1. Generation is not durable V3 progress. Generations 103–114 had no count, cursor, quarantine, or checkpoint-linked projection delta.
2. Native scheduled telemetry ended at audit ID 1838 (`2026-07-15 22:05:43 UTC`) after a valid five-row V3 batch. The direct local-adapter entry point bypassed Worker telemetry and was the only repository competing claimant.
3. D1 retains no claim-history or execution-origin record. Historical owners cannot therefore be assigned individually; this limitation is explicit rather than inferred away.
4. The local-adapter CLI now fails closed. Native scheduled execution remains the only authorized V3 writer and preserves `materialize()`, lease fencing, generation fencing, durable cursor commits, and normal release.
5. Recovery acceptance requires a telemetry-linked generation above 114, `processed_count>372`, cursor advancement, and normal terminal release. This ADR does not authorize parity clearance or FULL_PRODUCTION_PASS.

### Recovery evidence

Production Worker `1134b1cb-171f-419e-b35f-be5752352af5` was deployed with the existing minute and daily Cron bindings. Native scheduled telemetry IDs 1866 (`00:59:33 UTC`) and 1873 (`01:00:32 UTC`) recorded two five-row V3 batches. The checkpoint reached generation 117, count 382, and cursor `conversation:31bbc16f-7b82-40a4-954b-31fcf39da5e0`, then released to `paused` with owner and lease cleared. This verifies the recovery criterion; it does not imply V3 completion or parity clearance.

## Workspace 2 counter identity and renewed scheduler-delivery gap — 2026-07-16

The generation/count conflict is resolved from raw D1, not monitor summaries.
`lease_generation=132` and `processed_count=457` belong to
`ucs-projection-rematerialize-v3:1:1` (tenant 1, Workspace 1, V3 pipeline).
They are neither a Workspace 2 count nor a projection count. Workspace 2's
authoritative V3 row is `ucs-projection-rematerialize-v3:1:2` (tenant 1,
Workspace 2, same pipeline): at `01:14:33 UTC`, `lease_generation=19`,
`processed_count=95`, `quarantined_count=0`, paused/no owner/no lease, and
cursor `conversation:0c08ea35-3229-4754-8200-c287a2642c63`. Telemetry 1971 at
`01:14:34 UTC` independently reports that exact Workspace 2 bounded batch.

This is a **MONITOR_QUERY_DEFECT_CONFIRMED** finding: prior monitor output
omitted checkpoint/workspace identity. The monitoring schema now requires the
full checkpoint key, tenant, workspace, pipeline, field names
`lease_generation` and `processed_count`, cursor, lease, and telemetry result
index with workspace ID.

No runtime telemetry of any scheduler step exists after `01:14:37 UTC`, while
the minute trigger remains configured and the Worker source routes Workspace 2.
That is an upstream scheduler-delivery discontinuity, not a V3 fence/cursor
stall. Fresh Worker `a81acb6e-03f6-4e00-a06e-5ecaf4e03603` was deployed with
the unchanged explicit minute and daily triggers after syntax and focused UCS
tests passed. At `01:27:40 UTC` it had not yet emitted a scheduled telemetry
record; recovery requires two telemetry-linked Workspace 2 bounded cycles and
matching durable checkpoint advancement before forecasts or parity resume.

### Continuity recovery — 2026-07-16 01:28–01:29 UTC

The required two native cycles arrived under the fresh deployment: telemetry
1978 at `01:28:34 UTC` and 1985 at `01:29:34 UTC` each carry result index 1
for Workspace 2 with `claimed=true`, `processed=5`, `failed=0`, and
`ready=false`. The same raw D1 checkpoint advanced in order:
`lease_generation/processed_count` `19/95 → 20/100 → 21/105`; the final
checkpoint update is `01:29:33 UTC`, cursor
`conversation:0d54e120-c269-4630-9b5d-bc4e007cd8d3`, with state `paused` and
null owner/lease. This proves normal scheduler continuity and confirms there
is no competing writer or cursor reset.

The final classification is **COUNTER_IDENTITY_RECONCILED_AND_PROGRESSING**:
the initial conflict was a monitor query defect, and the later global delivery
gap recovered through the normal minute-cron path. A read-only 01:29:58 UTC
inventory records target 2,053, cursor remaining 1,941, current V3 projections
397, zero checkpoint quarantines, zero unresolved retryable pipeline failures,
and no duplicate current V3 projection. Traversal capacity is exactly five
durable rows per successful observed cycle, so the evidence-backed traversal
forecast is `ceil(1941/5)=389` cycles (~6h29m at one minute), conditional on
continued delivery and target stability. This is not ingest convergence:
outbox remains 1,782 pending and 1 failed. Projection reads remain 0%; parity
has not been executed; FULL_PRODUCTION_PASS was not declared.

## Failed ingest tombstone resolution deployment — 2026-07-16

At `01:40:46 UTC`, raw production evidence identified the only failed Workspace
2 outbox row as `ucs-canonical:1:2:104:1` (tenant 1, workspace 2, account 44,
source message 104, canonical version 1). It has `attempt_count=61` and
`last_error_code=canonical_projection_conversation_missing`. The authoritative
email remains present but is deleted (`is_del=1`), and it has no non-quarantined
`conversation_messages` binding. The row is therefore not eligible to create a
projection and previously retried indefinitely.

Worker `338018fc-7c51-4740-80e4-fc0388357441` was deployed after syntax, ten
focused UCS contract tests, and package checks passed. It preserves the normal
fenced ingest path and only treats a canonical event with both `is_del=1` and no
conversation binding as the existing `source_removed` terminal outcome. It does
not change D1 directly, invoke a rematerializer, or alter projection rows. At
`01:42:53 UTC` no scheduled telemetry from this new version had yet arrived, so
the record remains failed at attempt 61. Resolution is pending a normal minute
cron claim; this is not acceptance evidence yet.

## Corrected read-only convergence sample and renewed delivery block — 2026-07-16

The required corrected Wrangler invocation ran successfully at `02:14:13 UTC`:
`npx wrangler d1 execute cloud-mail --remote --command "SELECT ..."`. It was a
remote production D1 read-only batch of nine SELECT statements, served by
`v3-prod` in `WNAM/DEN`, with `rows_written=0` and exit code 0. The earlier
missing-inline-command invocation therefore remains a client construction error
only, not a D1 or production failure.

Tombstone no-regression is now proven: `ucs-canonical:1:2:104:1` is Workspace
2 `processed` at `01:43:12 UTC`, `last_error_code=source_removed`, attempt 62,
with null owner and lease. It is absent from all non-processed outbox states.

The same scoped checkpoint sample is a new blocker, not a ready boundary:
`ucs-projection-rematerialize-v3:1:2` is tenant 1/workspace 2/V3 pipeline,
`state=running`, owner `56edb71a-b802-4e70-b007-246e62b2db1a`,
`lease_generation=39`, `processed_count=192`, zero quarantine, cursor
`conversation:18755c4f-c921-47ca-acf4-a7f2f7884995`, updated `01:51:22 UTC`,
and its lease expired `01:56:22 UTC`. Telemetry 2111–2139 from
`01:51:56–01:55:24 UTC` reports V3 `claimed=false, processed=0`; no runtime
telemetry of any scheduler step exists later than `01:55:28 UTC` despite the
active 100%-routed Worker `338018fc-7c51-4740-80e4-fc0388357441`.

At this sample target rows are 2,068, current V3 rows 522, cursor remaining
1,873, missing current V3 rows 1,546, duplicate/orphan counts 0, retryable
pipeline failures 0, and outbox is 1,742 pending / 890 processed only. The
outbox is not converged and V3 is not ready. Classification:
**SCHEDULER_CONTINUITY_BLOCKED_BY_EXPIRED_V3_LEASE_AND_GLOBAL_TELEMETRY_GAP**.
No manual lease release, cursor reset, rematerializer invocation, parity, or
projection-read change is authorized by this observation.

## Native expired-V3-lease recovery and telemetry continuity — 2026-07-16

The active production deployment remains Worker
`338018fc-7c51-4740-80e4-fc0388357441`, 100% routed, with the configured
minute Cron retained. Source-level lease semantics are a fenced compare-and-set:
`claimCheckpoint()` updates a row only when its state is paused/failed/ready,
its lease is null, **or** `datetime(lease_until)<=CURRENT_TIMESTAMP`; a
successful claim assigns a fresh owner, increments `lease_generation`, and sets
a 60-second lease. A lost race produces zero changed rows and `claimed=false`.
Thus `running` state does not prevent an expired-lease reclaim.

Telemetry 2111–2139 occurred before the recorded `01:56:22 UTC` expiration
(01:51:56 through 01:55:24), so their `claimed=false/processed=0` outcomes are
legitimate active-lease rejections—not reclaim failures. The first observable
post-expiry W2 invocation is telemetry 2174 at `02:19:30 UTC`; it reports
`claimed=true, processed=5, failed=0`. Consecutive telemetry 2181, 2188, 2195,
2202, 2209, 2216, 2223, 2230, and 2237 continue the same five-row, zero-failure
native bounded path with advancing cursors. Later 2244 (`03:04:34`) and 2251
(`03:05:34`) provide a further consecutive pair.

Independent D1 evidence shows the exact Workspace 2 checkpoint continuing from
the prior `lease_generation=39 / processed_count=192` to
`lease_generation=55 / processed_count=272`, cursor
`conversation:2158d6cd-ee34-4184-930a-02c303f7b582`, `state=paused`, null
owner/lease at `03:05:27 UTC`. Workspace 1 remains separately keyed
`ucs-projection-rematerialize-v3:1:1` (generation 183/count 661); it is not
attributed to Workspace 2. No cursor reset, manual claim/release, direct
checkpoint update, direct projection rewrite, or manual rematerializer call
occurred.

Classification: **CRON_DELIVERY_GAP (intermittent, recovered)**. All runtime
steps ceased after 01:55:28, D1 did not advance during that interval, and all
steps resumed together at 02:19; the available evidence cannot assign a deeper
Cloudflare delivery versus handler-entry cause. It does prove the telemetry gap
was not a persistent D1 telemetry-only failure and that native fenced reclaim
works once a minute invocation arrives. This is
**NATIVE_LEASE_RECOVERY_AND_TELEMETRY_CONTINUITY_PASS** only; it is not V3
completion or parity clearance.

At 03:16:52 UTC, target rows are 2,069, cursor remaining 1,793, current V3
projections 618, missing 1,451, duplicates/orphans 0, retryable failures 0,
and outbox pending/processed is 1,715/922. Measured reclaimed throughput stays
five durable rows per completed cron cycle; traversal remaining is
`ceil(1793/5)=359` cycles (~5h59m nominal at minute cadence), conditional on
delivery and population stability. Tombstone `ucs-canonical:1:2:104:1` remains
processed/source_removed at attempt 62. Projection reads remain 0%; parity has
not run; FULL_PRODUCTION_PASS was not declared.

## Monitor access interruption — 2026-07-16

The next strict read-only monitor attempt was constructed with the required
inline SQL and `--remote`, but Cloudflare rejected it before query execution:
`POST /accounts/9a13d1cf25750a43faa1d96ebc66920b/d1/database/4c05f52d-5d8c-4fb5-9a6d-888bebf8c596/query`
returned HTTP 403 / code 7403. Wrangler `whoami` confirms the OAuth identity
and advertised D1 scope, while the API log confirms no SQL result and no D1
write. This is an external production-D1 authorization interruption, not a
checkpoint, cron, telemetry, or convergence sample. No current production delta
can be asserted until access is restored; retain the last certified scoped
sample and all completion gates.

## Production D1 read authorization recovery — 2026-07-16

The production target is top-level `wrangler.toml`, binding `db`, database
`cloud-mail` (`4c05f52d-5d8c-4fb5-9a6d-888bebf8c596`), with no selected named
environment or environment token override. The cached Wrangler OAuth is the
effective credential. The former 403/7403 remains recorded as a pre-SQL API
authorization rejection. Existing OAuth refresh then restored access without a
new credential: remote `SELECT 1` and an eleven-query SELECT-only W2 sample
succeeded against `v3-prod` / WNAM-DEN, exit 0, `rows_written=0`.

Classification: **STALE_WRANGLER_AUTHENTICATION**. At 13:05:56 UTC, W2 V3 is
paused/unowned with no lease, generation 78, processed 387, quarantine 0, and
cursor `conversation:2e728088-854d-4c34-9ff5-990ba99128f8`. Inventory is
target/current/missing `2097/775/1322`, remaining 1701, pending outbox 1690,
zero other non-processed outbox states, zero unresolved failures, and zero
duplicates/orphans. Tombstone remains processed/source_removed attempt 62.
Against the 04:27 baseline: generation +23, processed +115, target +28,
current V3 +157, missing -129, remaining -92, and net backlog -25. Latest
matching telemetry is 10:31:32 UTC, so 341 cycles (~5h41m) is conditional
capacity only, not a continuity forecast. No parity, reads, or FULL_PRODUCTION_PASS.

## Post-10:31 scheduler continuity sample — 2026-07-16 13:17 UTC

Credential continuity remains intact: cached OAuth is active, no environment
token override exists, and both remote SELECT-only bundles completed with exit
0 and `rows_written=0` against production D1. The new exact-identity W2 sample
is unchanged from 13:05:56: paused/unowned/unleased at generation 78, processed
387, quarantine 0, and the same continuation cursor; coverage/outbox/failures
are also unchanged (2097/775/1322, remaining 1701, pending 1690, no other
non-processed states, no unresolved failures).

No Workspace 2 telemetry exists after 10:31:32 UTC. More importantly, global
runtime telemetry contains only Gmail sync at 10:31:36 UTC after that W2 event;
there are no later runtime steps of any kind. Deployment `338018fc-7c51-4740-80e4-fc0388357441`
remains 100% routed and source configuration retains `* * * * *`. The last
shared unifiedConversation event proves both workspaces were evaluated then;
W2 claimed and processed five rows with its durable cursor. Since neither
telemetry nor D1 changed afterward, classification is
**CHECKPOINT_NOT_ADVANCING** with a proven global runtime-observability gap.
The available production evidence cannot isolate upstream cron delivery from
scheduled-handler entry, so it must not be called a definitive scheduler failure.
No repair is performed under this completion-monitor mission.

## Generation 243 identity correction — 2026-07-16 13:24 UTC

A fresh top-level production D1 sample at `13:24:49 UTC` used nine remote
`SELECT` statements only, completed with exit `0`, and reported `rows_written=0`.
It proves that the `13:18:57 UTC` claim with `lease_generation=243`,
`processed_count=789`, owner `d48d7716-4712-4a21-965b-823fdcafc835`, and
`lease_until=13:19:57 UTC` is `ucs-projection-rematerialize-v3:1:1` for
Workspace 1. The scoped Workspace 2 row `ucs-projection-rematerialize-v3:1:2`
remains paused/unowned/unleased at generation `78`, processed `387`, quarantine
`0`, with unchanged cursor and `updated_at=10:31:24 UTC`.

Classification is **MONITOR_FIELD_OR_EPOCH_MISMATCH**. The W1 claim/expiry does
not evidence any W2 claim, rematerializer entry, durable progress, release, or
telemetry; it is excluded from W2 throughput and recovery calculations. The
independent global telemetry gap after `10:31:36 UTC` remains **NOT OBSERVABLE**
beyond the Worker boundary: configuration and source are not proof of later
cron delivery or handler entry. No manual runtime action, parity, read enablement,
or `FULL_PRODUCTION_PASS` occurred.
