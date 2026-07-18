# ADR: UCS Outbox Pool-Workers Inline-Schema Benchmark

Status: Accepted — executed locally only (pool-workers ephemeral D1). Date: 2026-07-18.
Related: `UCS_OUTBOX_POOL_WORKERS_BENCHMARK_REPORT.md`,
`platform/cloud-mail/mail-worker/scripts/reliability-tests/ucs-outbox-pool-workers-benchmark.test.mjs`,
`UCS_OUTBOX_STAGING_BENCHMARK_EXECUTION_BLOCKER.md` (prior blocker this supersedes for the authorized scope
only), `UCS_STAGING_SCHEMA_MANIFEST.md`.

- **ADR-1 (why Option A):** the user was asked to choose between four benchmark execution paths after two
  were independently confirmed blocked (a temporary staging HTTP endpoint would add surface to the shared
  production Worker mid-UCS-convergence; a pool-workers full-migration-replay approach is unavailable because
  the installed `@cloudflare/vitest-pool-workers@0.18.4` does not export `./config`, so
  `readD1Migrations`/`applyD1Migrations` cannot be used). The user selected pool-workers with an inlined
  minimal schema: zero production surface, no new HTTP endpoint, no production credentials, no dependency on
  remote staging data, executes the real service path, and requires no toolchain upgrade (avoiding the
  regression risk of upgrading `@cloudflare/vitest-pool-workers`).
- **ADR-2 (schema provenance):** the inlined `CREATE TABLE`/`CREATE INDEX` statements are copied verbatim
  from a read-only `wrangler d1 execute db --env staging --remote` query against `cloud-mail-staging`
  (`rows_written=0`, `changed_db=false`) taken **after** migration commit `ce385b9` applied 0023-0056. No
  column, constraint, or index was hand-invented; only the 13 tables + 4 indexes that
  `processIngestOutbox`/`materialize()` actually reference were included, to keep the fixture minimal without
  diverging from the real runtime contract.
- **ADR-3 (relevance boundary):** this benchmark can prove service-logic correctness, batch-limit
  configuration behavior (`outboxDrainLimit` parsing/clamping), lease/fencing correctness, idempotency, no
  duplicate/orphan side effects, and *relative* throughput trends between candidates within one fixed local
  environment. It explicitly cannot prove Cloudflare remote D1 latency (staging or production), production
  scheduled-delivery frequency, production's real ~55-second Worker invocation budget, or a production-safe
  batch size — pool-workers' local D1 has near-zero I/O latency, unlike a real network round-trip.
- **ADR-4 (production canary gate):** any future production `UCS_OUTBOX_DRAIN_LIMIT` value must be ≤ the
  highest pool-workers-qualified stable value (25, the hard-coded `MAX_OUTBOX_DRAIN_LIMIT`) and must pass a
  separate, explicitly user-authorized production canary that observes real drain rate and Worker CPU/duration
  under actual scheduled delivery before being treated as production-verified. This benchmark alone does not
  authorize a production flag change.

## Fixture design decision: the `'canonical:'` fast path

`processIngestOutbox` (unmodified) branches on whether `event.source_version` starts with `'canonical:'`: if
so, it looks up an existing `conversation_messages` row for the same source and calls `materialize()`
directly, skipping `observeMessage`/classification entirely. This is a real, pre-existing branch in the
production code (not created for this benchmark) that models re-materialization on canonical-state change.
Using it kept the inlined schema to only the tables `materialize()` touches (13 tables) instead of also
requiring the full `observeMessage`/`classifyMessage`/`atomic-classification-mutation-service` dependency
graph, while still exercising genuine outbox claim → lease → fence → process/fail → evidence transitions
through unmodified production code. The genuine-failure test path
(`canonical_projection_conversation_missing`) is likewise a real, pre-existing error branch, not a fabricated
shortcut.

## Boundaries honored

No staging or production D1/KV/R2/Worker was written to or redeployed. No HTTP endpoint was added to the
shared Worker. No `@cloudflare/vitest-pool-workers` (or any) package was upgraded. No cron or Worker
configuration was modified. No production outbox row was touched. Scoped commit: only the new test file, this
ADR, and the benchmark report are part of this change.
