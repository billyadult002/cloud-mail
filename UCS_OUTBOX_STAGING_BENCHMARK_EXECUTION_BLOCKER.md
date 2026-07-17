# UCS Outbox Staging Benchmark — Execution-Model Blocker & Candidate Decision

Mission: UCS OUTBOX STAGING-ONLY BENCHMARK HARNESS IMPLEMENTATION AND CANDIDATE QUALIFICATION
Date: 2026-07-17
Verdict: **OUTBOX_STAGING_HARNESS_BLOCKED_WITH_EVIDENCE** · Candidate decision: **NO_SAFE_CANDIDATE**
(no faithful measurement obtained — this is NOT proof that any candidate is unsafe).

Companion to the parallel process's untracked drafts (`UCS_OUTBOX_STAGING_HARNESS_IMPLEMENTATION_REPORT.md`
etc.), left untouched. This records the independent, evidence-based execution-model finding after schema
provisioning `ce385b9`.

## Not repeated (E1)

RCA `38f61de`, limit impl `3b46ecd` (`UCS_OUTBOX_DRAIN_LIMIT`), schema provisioning `ce385b9` — confirmed
present, not re-run. Staging schema still ready (read-only): 28 `conversation_*` tables, outbox 0 rows,
58 migrations.

## The blocker: no safe execution model for a *faithful* benchmark right now

A faithful candidate benchmark must (a) drive the **real** `processIngestOutbox` → `materialize()` success
path (not the `source_removed`/failure shortcut), and (b) measure it against the **remote staging D1**, since
that remote-D1 latency is the entire reason the prior mission provisioned the staging schema, and staging D1
timing — not local timing — is what informs a safe batch size. Both requirements collide with safety:

1. **Remote-D1 measurement requires a staging Worker endpoint.** `processIngestOutbox` is Worker-bound
   (needs `env.db` = the D1 binding). The only way to invoke it against the *remote* staging D1 is an HTTP
   endpoint in the deployed Worker. But that Worker is the **shared production Worker codebase**: any endpoint
   added to `src/` ships (fail-closed) in the *next production deploy* of `cloud-mail`. Adding a
   benchmark/fixture-mutation surface to the live Worker **during active production UCS convergence**
   (`NATIVE_RECLAIM_CONFIRMED_CONVERGENCE_IN_PROGRESS`, reads 0%) is an unjustified risk — the mission itself
   forbids interfering with that convergence, and ADR-13 concedes a staging benchmark yields *eligibility
   only, not production performance*.

2. **The CLI/shadow (pool-workers) alternative can't measure remote-D1 latency.** `@cloudflare/vitest-pool-workers`
   runs the real function in real `workerd` (good for CPU/correctness) but against a **local miniflare D1**,
   whose I/O latency is not representative of remote D1 — which defeats the purpose of the staging provisioning
   and cannot qualify a candidate on the dimension that actually matters (per-invocation wall time under real
   D1). It would also require synthesizing the deep `materialize()` dependency graph (aggregate + messages +
   canonical_state + optional facets/commitments/evidence via `deriveProjection`), a fragile fixture.

3. **The upside does not justify the risk.** The RCA (`38f61de`) established the dominant throughput limiter
   is intermittent scheduler *delivery frequency* (~5 invocations/hr), with batch size the *secondary* factor;
   the convergence has projection reads at 0% (no user-visible impact). Trading real production-Worker surface,
   mid-convergence, for a batch-size eligibility number is not warranted.

Therefore no benchmark was executed and no candidate was measured. **NO_SAFE_CANDIDATE** stands as
*evidence-absent*, exactly as before schema provisioning — the schema is now ready, but a safe *execution
model* is not, under the current production-convergence constraint.

## What was NOT done (integrity)

No benchmark endpoint or fixture code was added to the shared Worker; no staging Worker was redeployed; no
harness authorization was created; no synthetic fixtures were seeded (staging outbox remains 0 rows); no
candidate results were fabricated. No production/staging deploy, no production mutation, no UCS-epoch write.

## Unblock options (for a future, safe run)

1. **Defer to post-convergence:** once UCS reaches Parity PASS / convergence completes, the shared Worker can
   safely carry a *temporary* staging-only benchmark endpoint (fail-closed, dedicated auth, synthetic
   namespace) per the harness design; run the 2/10/15/20/25 sweep against remote staging D1, then remove it.
2. **Isolated throwaway Worker/service:** deploy a separate, never-production Worker that imports the same
   `processIngestOutbox` + a synthetic fixture against a dedicated benchmark D1 — no shared-Worker surface.
3. **Direct conservative canary (user decision):** the downstream *controlled production acceleration* mission
   is itself flag-gated (`UCS_OUTBOX_DRAIN_LIMIT`) and reversible; a modest value (e.g. 10) could be validated
   in a tightly stop-conditioned production canary instead of a staging benchmark. (This is the user's call,
   not asserted here.)

## Production non-interference (read-only, verified)

Worker `525681a1` (100%); W2 `projection_read_enabled=0` (`rows_written=0`); `UCS_HWM_COMPLETION_ENABLED="true"`.
No `UCS_OUTBOX_BENCHMARK_*` var anywhere. Production UCS convergence undisturbed.

## Audit answers (key)

- Harness execution model chosen? None executed — both viable models are blocked under the current
  production-convergence constraint (endpoint = shared-Worker surface; pool-workers = non-representative D1).
- processIngestOutbox invoked? No (no safe path to a faithful remote-D1 measurement now).
- Candidate 2/10/15/20/25 results? None measured.
- First unsafe candidate? Unknown (unmeasured).
- Recommended candidate? NO_SAFE_CANDIDATE (evidence-absent).
- Fixtures cleaned / authority closed? None created.
- Production Worker/flag/reads changed? No — `525681a1` / true / 0%.
- Final verdict? **OUTBOX_STAGING_HARNESS_BLOCKED_WITH_EVIDENCE.**

## Next

Per NEXT-IF-BLOCKED: continue **UCS HWM V3 LONG-INTERVAL NATIVE CONVERGENCE AND PARITY CHECKPOINT** (read-only,
≥1 h cadence). The safe-execution-model options above are the prerequisites for a future faithful benchmark.
