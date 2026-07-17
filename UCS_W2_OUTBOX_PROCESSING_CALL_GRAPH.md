# UCS W2 Outbox Processing Call Graph (read-only)

Mission: UCS W2 FROZEN-SNAPSHOT OUTBOX DRAIN THROUGHPUT RCA. Date: 2026-07-17. Design-only.

## Cron → outbox `processed` (E2/V1)

```
Cloudflare cron "* * * * *"  (per-minute; also */5, */30)
 └─ index.js scheduled(): await runStep('unifiedConversation',
       () => unifiedConversationBackfillService.monitorScheduled({env}, {limit:2, membershipLimit:25}))   [AWAITED, FIRST]
     └─ monitorScheduled  (unified-conversation-backfill-service.js:128)
         scopes = SELECT tenant_id,workspace_id FROM conversation_cutover_state
                  WHERE dual_write_enabled=1 ORDER BY workspace_id LIMIT 10      → [W1(id=1), W2(id=2)]
         for scope in scopes (SEQUENTIAL, W1 then W2):
            live       = await processIngestOutbox(env,{...,limit:2})     ← the ≤W outbox drain
            run        = await runWorkspace(env,{...,limit:2})            ← backfill (W2 ready, ~no-op)
            membership = await refreshProjectionMemberships(env,{...,limit:25})
            v3         = await rematerializeWorkspaceV3(env,{...,limit:5})
            mission    = await materializeMissionProvenance(...)
            if (run.ready && membership.ready) run.parity = await parityWorkspace(...)   ← W2 runs this every invocation
 └─ then Promise.allSettled([gmailSync, outboundDrain(email send, NOT this outbox),
       echartsCache, nexoraAutonomy, durableMissionRuntime, classificationIntelligence])
```

## processIngestOutbox internals (E3/E4/E5/E6/E7)

`processIngestOutbox(env,{tenantId,workspaceId,limit=5})` — but called with `limit=2` from the per-minute path.

1. `INSERT OR IGNORE` its own live checkpoint `ucs-live-checkpoint:{t}:{w}` (pipeline `ucs-live-v1`).
2. `claimCheckpoint` (lease-fenced; LEASE_SECONDS=60). If not claimable → `{claimed:false}` (skip this cycle).
3. `events = SELECT * FROM conversation_ingest_outbox WHERE tenant_id=? AND workspace_id=? AND
   state IN ('pending','failed','processing') AND (lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP)
   ORDER BY created_at,id LIMIT 2`.
4. For each event:
   - claim: `UPDATE … state='processing', lease_owner, lease_until=+5min, attempt_count+1 WHERE eligible`; if
     `meta.changes==0` → `continue` (lost race).
   - load source email; if gone → mark `processed` (`source_removed`).
   - canonical event → `materialize()` (or terminal tombstone → processed); else `processRow()`.
   - success → `UPDATE state='processed', processed_at, lease cleared`; `processed++`.
   - error → `UPDATE state='failed', lease_until=+5min, last_error`; `failed++`  (5-min backoff via lease).
5. Final `UPDATE ucs-live-checkpoint … processed_count += processed …`, lease released.

**Outbox state machine (E4):** `pending → processing → processed` (success), `processing → failed` (error,
retry after 5 min), `processing → processed(source_removed)` (source gone). Rows do NOT normally need
multiple invocations unless a transient error defers them 5 min (E7/E8). `unexplained`/`outbox_le_w` count
`state!='processed'` rows with `source_message_id<=W`, so **net outbox_le_w decline == rows reaching
`processed`** (minus any newly-eligible; but ≤W set is frozen, so it is a monotone drain) (E6).

## Eligibility / backoff (E8)

`lease_until` acts as the retry/backoff clock: a failed or in-flight row is re-eligible only after its
`lease_until` (5 min for failures, 5 min claim lease). No exponential backoff, no explicit `next_attempt_at`
on the outbox (that field is on `conversation_pipeline_failures`, a different table). No provider/auth gate in
the ≤W drain itself (materialize is local D1 work). attempt_count increments but there is no hard attempt cap
in `processIngestOutbox`.

## Position & competition (E9/E11)

W2's `processIngestOutbox` is the **first** call in W2's scope iteration, but the **entire W1 scope chain runs
first** in the same awaited `monitorScheduled` step. W1 is live (`projection_read_enabled=1`) with an ACTIVE
`ucs-projection-rematerialize-v3` lease (running) — so W1 consumes budget/wall-time ahead of W2 every invocation.
