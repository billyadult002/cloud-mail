# UCS HWM V3 Final Production Acceptance

Mission: UCS HWM V3 CONTROLLED PRODUCTION ACTIVATION, CONVERGENCE, PARITY, AND FINAL ACCEPTANCE
Date: 2026-07-16

## FINAL VERDICT: PRODUCTION_CONVERGENCE_IN_PROGRESS

(One of the four allowed verdicts per A20. **FULL_PRODUCTION_PASS is NOT declared** — partial
progress must never be recorded as a pass.)

## What is established (production evidence)

- v2026.07-ucs-hwm-v3 deployed to production (`525681a1`, from code `dbcf4c70`), commit
  `3ab120b`; `UCS_HWM_COMPLETION_ENABLED="true"` confirmed live (enablement commit `0b5dd1d3`,
  tag `v2026.07-ucs-hwm-v3-enabled`). Deploy in a paused/unowned window; health 200; no config drift.
- Backfill checkpoint READY and latched at immutable W=3807 (2 observations).
- Membership checkpoint READY.
- V3 composite watermark frozen `(created_at,id)=2026-07-16 19:23:13|conversation:623f0b8a-…`,
  immutable across observations; V3 natively re-materializing ≤W (cursor monotonic, generation
  advancing, unowned between runs).
- Projection reads remain 0% (`projection_read_enabled=0`, epoch 1).
- No manual checkpoint/cursor/lease/outbox/projection edits; native scheduler only.

## What is NOT yet established (blocks FULL_PRODUCTION_PASS)

- V3 ≤W current-materializer coverage complete (E10) — in progress.
- V3 READY latch (A10/V13) — pending.
- Parity native execution + PASS (A12/V16) with all integrity metrics 0 — pending V3.
- Target Build + real-iPhone production acceptance (A19/E14) — only after parity PASS and a
  separate, explicitly authorized projection-read cutover.

## Audit answers (per mission)

1. Commit/Tag to prod: `3ab120b` / `v2026.07-ucs-hwm-v3` (code) + `0b5dd1d3` / `v2026.07-ucs-hwm-v3-enabled` (flag).
2. Old→new Worker: `d05ffd3e` → `dbcf4c70` (code, flag off) → `525681a1` (flag on).
3. W2 paused/unowned at deploy? Yes (backfill/membership unowned; V3 lease expired).
4. HWM flag effective? Yes — `env.UCS_HWM_COMPLETION_ENABLED("true")` + observed HWM behavior.
5. Backfill frozen watermark? email_id **3807**.
6. V3 (created_at,id) watermark? **`2026-07-16 19:23:13|conversation:623f0b8a-6320-4236-a38a-f3d0684f24c1`**.
7. Watermark immutable in epoch? Yes — unchanged across 19:24:31 and 19:26:59.
8. V3 cursor only ≤W? Yes — composite fetch bounded by ≤W; cursor monotonic from epoch start.
9. >W not lost / retained for later? Yes — excluded from this epoch, eligible for the next (ADR-4).
10. V3 converging via native scheduler? Yes — generation/processed/cursor advance while unowned.
11. READY latched? Backfill yes; V3 pending convergence.
12. Parity auto-executed? Not yet (pending V3 ready); will be native, never injected.
13. Parity on same frozen snapshot? By design (parity binds to the frozen high_watermark).
14/15. missing/contentMismatch/unexplained/duplicates/orphans/failures/quarantine all 0? **Pending** (parity not yet passed).
16. When are reads switched? Only after parity PASS + all gates + explicit cutover authorization (not done).
17. Target Build / real iPhone verified backend? Not yet (post-parity, separate).
18. Any manual state modification? **No.**
19. How to disable/rollback? Flag `="false"`+redeploy, or `wrangler rollback dbcf4c70`/`d05ffd3e`. No data edits.
20. FULL_PRODUCTION_PASS justified by complete evidence? **No — not yet.**

## Update — 19:37:43 UTC observation (verdict unchanged: IN_PROGRESS)

- Worker still `525681a1`, flag on, reads 0%. Backfill READY-latched hw=3807; membership READY;
  V3 watermark immutable (`2026-07-16 19:23:13|conversation:623f0b8a-…`), cursor advanced
  03:09:30→03:15:11, gen 117→128, proc 574→629 — native.
- **Parity is now executing natively** (E11 met) at frozen hw=3807 but **passed=0**:
  contentMismatch=1350, unexplained=1658. Integrity clean: duplicates=0, orphans=0, failures=0.
- **Two long-poles to passed=1** (both ≤W, draining natively): V3 rematerialization
  (contentMismatch, ~hours) and ≤W ingest-outbox drain (outbox_le_w=1655, ~2/min ⇒ ~14 h).
- No manual UCS mutation; rollback (flag-off / Worker `dbcf4c70`/`d05ffd3e`) remains available.
- Real-iPhone + cutover gates remain unreachable (require parity PASS first; and a physical device).

## Update — 19:43:53 UTC observation (verdict: PRODUCTION_CONVERGENCE_IN_PROGRESS)

Monotonic native convergence confirmed, no blocker:
- contentMismatch 1350→**1336**, outbox_le_w 1655→**1650**, unexplained 1650 (==outbox_le_w+0 failures).
- V3 gen 128→132, proc 629→649, cursor 03:15:11→03:20:14; watermark immutable; backfill/membership READY.
- **New >W ingest correctly excluded:** outbox_global 1677 = outbox_le_w 1650 + future(>3807) 27.
- Integrity: duplicates=0, orphans=0, unresolved_failures=0. Parity passed=0 (in progress). Reads 0%.

### Backfill historical quarantine=24 — acceptance interpretation (ADR-5 / E16 / V18)

`conversation_materialization_checkpoints.quarantined_count` is a **monotonic lifetime counter**
(the runtime only ever does `quarantined_count = quarantined_count + <this-run>`; it is never
decremented). backfill=24 therefore records 24 historical quarantine *events* over the pipeline's
life, **not** 24 currently-unresolved rows. The operative acceptance signals are the *current*
ones: `unresolved_failures=0` (`conversation_pipeline_failures WHERE resolved_at IS NULL`) and the
parity `missing`/`contentMismatch`. Since parity `missing`≈0 and unresolved failures=0, the
historical 24 do **not** block the current frozen-snapshot acceptance. It is disclosed here, not
hidden, and will be re-confirmed at parity PASS (missing must be 0, i.e. no ≤W conversation left
without a current projection).

## Update — 19:48:18 UTC observation (verdict: PRODUCTION_CONVERGENCE_IN_PROGRESS)

- All metrics flat vs 19:43 (contentMismatch 1336, outbox_le_w 1650, unexplained 1650, missing 5,
  integrity 0, passed 0) because of a **scheduler telemetry gap**: latest runtime_telemetry id
  2821 @ 19:41:26 UTC (~7 min gap at observation).
- Classification (ADR-6/V26/V27): NOT a blocker — leases UNOWNED (native reclaim pending), watermark
  immutable, no cursor regression, no duplicates/orphans/failures. Matches the RCA's intermittent
  Cloudflare scheduled-event gaps that self-resume via native reclaim. No manual lease action taken.
- Worker/flag/reads unchanged and authorized; frozen-snapshot scope intact (outbox future 27 excluded).

## Follow-up to reach FULL_PRODUCTION_PASS

Observe (read-only) until V3 latches READY and a `conversation_projection_parity` row shows
`passed=1` with all integrity metrics 0 under continuous ingest; then evaluate the separate,
authorized projection-read cutover with target-build + real-iPhone acceptance. Only then may the
verdict advance to FULL_PRODUCTION_PASS.
