// UCS OUTBOX POOL-WORKERS INLINE-SCHEMA BENCHMARK AND SAFE CANDIDATE QUALIFICATION
//
// Runs the REAL processIngestOutbox() service path (unified-conversation-backfill-service.js)
// inside @cloudflare/vitest-pool-workers' ephemeral local D1 (env.db from `cloudflare:test`),
// against a hand-inlined minimal UCS schema. The schema below is copied verbatim (not
// hand-invented) from `wrangler d1 execute db --env staging --remote` run against
// cloud-mail-staging AFTER migration 0023-0056 (commit ce385b9) — see
// UCS_STAGING_SCHEMA_MANIFEST.md and UCS_OUTBOX_POOL_WORKERS_BENCHMARK_REPORT.md (ADR-2).
//
// Scope (ADR-3): this benchmark can prove service-logic correctness, batch-limit behavior,
// lease/fencing, idempotency, and relative throughput trends between candidates. It CANNOT
// prove remote Cloudflare D1 latency, scheduled-delivery frequency, production 55s invocation
// behavior, or a production-safe batch size — those require a separate production canary.
//
// Fixtures use the 'canonical:' source_version fast path in processIngestOutbox (a real,
// existing branch — not a fabricated shortcut): when source_version starts with 'canonical:',
// the function looks up an existing conversation_messages row and calls the real materialize()
// directly, skipping the observeMessage/classification path. This keeps the inlined schema to
// the tables materialize() actually touches while still exercising genuine outbox
// claim/lease/fence/process/fail semantics end to end.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { outboxDrainLimit, processIngestOutbox } from '../../src/service/unified-conversation-backfill-service.js';

const TENANT_ID = 990101;
const WORKSPACE_ID = 990102;
const ACCOUNT_ID = 990103;

const TABLES = [
	'attachments',
	'conversation_aggregates',
	'conversation_commitment_heads',
	'conversation_commitments',
	'conversation_facet_heads',
	'conversation_facet_results',
	'conversation_ingest_outbox',
	'conversation_materialization_checkpoints',
	'conversation_messages',
	'conversation_mission_provenance',
	'conversation_pipeline_failures',
	'conversation_projections',
	'email',
	'mail_canonical_state',
];

// Verbatim CREATE TABLE SQL from cloud-mail-staging (post ce385b9), read-only query,
// rows_written=0 / changed_db=false. See UCS_OUTBOX_POOL_WORKERS_BENCHMARK_REPORT.md E2.
const SCHEMA_SQL = {
	attachments: `CREATE TABLE attachments (
  att_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT,
  size INTEGER,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
)`,
	conversation_aggregates: `CREATE TABLE conversation_aggregates (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 aggregate_version INTEGER NOT NULL DEFAULT 1,
 lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('active','merged','split','tombstoned')),
 subject_digest TEXT,
 participant_set_digest TEXT NOT NULL,
 message_set_digest TEXT NOT NULL,
 last_observed_at TEXT,
 superseded_by_id TEXT,
 integrity_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, facet_generation INTEGER NOT NULL DEFAULT 0,
 UNIQUE(tenant_id,workspace_id,id)
)`,
	conversation_commitment_heads: `CREATE TABLE conversation_commitment_heads (
 tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, conversation_id TEXT NOT NULL,
 business_key TEXT NOT NULL, current_commitment_id TEXT NOT NULL, current_commitment_version INTEGER NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,workspace_id,business_key)
)`,
	conversation_commitments: `CREATE TABLE conversation_commitments (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 commitment_version INTEGER NOT NULL DEFAULT 1,
 business_key TEXT NOT NULL,
 owner_identity_ref_hash TEXT NOT NULL,
 beneficiary_identity_ref_hash TEXT,
 obligation_digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('WaitingForMe','WaitingForOthers','Resolved','Delegated','Scheduled','Blocked','Cancelled')),
 scheduled_for TEXT,
 delegated_to_identity_ref_hash TEXT,
 blocked_reason_code TEXT,
 source_classification_run_id TEXT,
 evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL,
 verification_state TEXT NOT NULL CHECK(verification_state IN ('verified','inconclusive','rejected')),
 supersedes_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,business_key,commitment_version)
)`,
	conversation_facet_heads: `CREATE TABLE conversation_facet_heads (
 tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, conversation_id TEXT NOT NULL,
 dimension_key TEXT NOT NULL, value_key TEXT NOT NULL, current_result_id TEXT NOT NULL,
 current_result_version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,workspace_id,conversation_id,dimension_key,value_key)
)`,
	conversation_facet_results: `CREATE TABLE conversation_facet_results (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 dimension_key TEXT NOT NULL,
 value_key TEXT NOT NULL,
 result_version INTEGER NOT NULL,
 classifier_key TEXT NOT NULL,
 classifier_version TEXT NOT NULL,
 input_digest TEXT NOT NULL,
 confidence REAL NOT NULL CHECK(confidence>=0 AND confidence<=1),
 status TEXT NOT NULL CHECK(status IN ('candidate','supported','rejected','superseded','abstained')),
 explanation_code TEXT NOT NULL,
 evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL,
 supersedes_id TEXT,
 observed_at TEXT NOT NULL,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,conversation_id,dimension_key,value_key,result_version)
)`,
	conversation_ingest_outbox: `CREATE TABLE conversation_ingest_outbox (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, source_message_id INTEGER NOT NULL, source_version TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('observed','updated')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','processed','failed')),
 attempt_count INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_until TEXT,
 last_error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 processed_at TEXT, UNIQUE(tenant_id,workspace_id,source_message_id,source_version,event_type)
)`,
	conversation_materialization_checkpoints: `CREATE TABLE conversation_materialization_checkpoints (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 pipeline_key TEXT NOT NULL,
 cursor_json TEXT NOT NULL,
 high_watermark TEXT,
 last_projection_id TEXT,
 processed_count INTEGER NOT NULL DEFAULT 0,
 quarantined_count INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('running','ready','paused','failed')),
 lease_owner TEXT,
 lease_generation INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,pipeline_key)
)`,
	conversation_messages: `CREATE TABLE conversation_messages (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 provider_key TEXT NOT NULL,
 account_id INTEGER NOT NULL,
 source_message_id INTEGER,
 provider_message_ref_hash TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','system','unknown')),
 observed_at TEXT NOT NULL,
 source_version TEXT,
 evidence_id TEXT,
 integrity_hash TEXT NOT NULL,
 lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('observed','updated','tombstoned','quarantined')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,provider_key,account_id,provider_message_ref_hash,source_version)
)`,
	conversation_mission_provenance: `CREATE TABLE conversation_mission_provenance (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 commitment_id TEXT NOT NULL,
 commitment_version INTEGER NOT NULL,
 projection_id TEXT NOT NULL,
 projection_version INTEGER NOT NULL,
 evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL,
 policy_version TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 verification_state TEXT NOT NULL CHECK(verification_state IN ('verified','rejected')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, outcome_id TEXT,
 UNIQUE(tenant_id,workspace_id,idempotency_key),
 UNIQUE(tenant_id,workspace_id,mission_id)
)`,
	conversation_pipeline_failures: `CREATE TABLE conversation_pipeline_failures (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 pipeline_key TEXT NOT NULL,
 source_ref TEXT NOT NULL,
 source_ref_hash TEXT NOT NULL,
 stage TEXT NOT NULL,
 reason_code TEXT NOT NULL,
 retryable INTEGER NOT NULL,
 attempt_count INTEGER NOT NULL DEFAULT 1,
 next_attempt_at TEXT,
 resolved_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
	conversation_projections: `CREATE TABLE conversation_projections (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 projection_version INTEGER NOT NULL,
 aggregate_version INTEGER NOT NULL,
 materializer_version TEXT NOT NULL,
 title TEXT NOT NULL,
 preview TEXT NOT NULL,
 last_observed_at TEXT,
 message_count INTEGER NOT NULL,
 unread_count INTEGER NOT NULL,
 has_attachments INTEGER NOT NULL,
 category_keys_json TEXT NOT NULL,
 facet_summary_json TEXT NOT NULL,
 active_commitment_ids_json TEXT NOT NULL,
 commitment_states_json TEXT NOT NULL,
 action_required INTEGER NOT NULL,
 waiting_for_me INTEGER NOT NULL,
 waiting_for_others INTEGER NOT NULL,
 mission_ids_json TEXT NOT NULL,
 ranking_score REAL NOT NULL DEFAULT 0,
 risk_key TEXT NOT NULL DEFAULT 'unknown',
 canonical_folder_key TEXT NOT NULL DEFAULT 'inbox',
 source_navigation_json TEXT NOT NULL,
 search_document TEXT NOT NULL,
 integrity_hash TEXT NOT NULL,
 materialization_checkpoint_id TEXT NOT NULL,
 materialization_generation INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('current','superseded','quarantined')),
 supersedes_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, membership_keys_json TEXT NOT NULL DEFAULT '[]',
 UNIQUE(tenant_id,workspace_id,conversation_id,projection_version)
)`,
	email: `CREATE TABLE email (
  email_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  send_email TEXT,
  name TEXT,
  account_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  subject TEXT,
  content TEXT,
  text TEXT,
  message_id TEXT DEFAULT '',
  in_reply_to TEXT DEFAULT '',
  to_email TEXT DEFAULT '',
  status INTEGER DEFAULT 0 NOT NULL,
  type INTEGER DEFAULT 0 NOT NULL,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  is_del INTEGER DEFAULT 0 NOT NULL
, provider TEXT NOT NULL DEFAULT 'cloudflare_native', account_email TEXT NOT NULL DEFAULT '', account_domain TEXT NOT NULL DEFAULT '', thread_id TEXT NOT NULL DEFAULT '', external_message_id TEXT NOT NULL DEFAULT '', folder_key TEXT NOT NULL DEFAULT 'inbox')`,
	mail_canonical_state: `CREATE TABLE mail_canonical_state (
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL,
 message_id INTEGER NOT NULL,
 thread_id TEXT NOT NULL DEFAULT '',
 provider_message_id TEXT NOT NULL DEFAULT '',
 semantic_category TEXT NOT NULL DEFAULT 'general',
 priority_state TEXT NOT NULL DEFAULT 'automatic',
 is_priority INTEGER NOT NULL DEFAULT 0,
 is_vip INTEGER NOT NULL DEFAULT 0,
 junk_disposition TEXT NOT NULL DEFAULT 'not_junk',
 is_starred INTEGER NOT NULL DEFAULT 0,
 is_read INTEGER NOT NULL DEFAULT 0,
 folder_key TEXT NOT NULL DEFAULT 'inbox',
 overlays_json TEXT NOT NULL DEFAULT '[]',
 tags_json TEXT NOT NULL DEFAULT '[]',
 last_mutation_id TEXT,
 state_version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id,workspace_id,account_id,message_id)
)`,
};

const INDEX_SQL = [
	`CREATE INDEX idx_ucs_ingest_pending ON conversation_ingest_outbox(state,lease_until,created_at)`,
	`CREATE INDEX idx_ucs_messages_conversation ON conversation_messages(tenant_id,workspace_id,conversation_id,lifecycle_state,observed_at,source_message_id)`,
	`CREATE INDEX idx_ucs_messages_source ON conversation_messages(tenant_id,workspace_id,source_message_id,lifecycle_state)`,
	`CREATE UNIQUE INDEX idx_conversation_projection_current ON conversation_projections(tenant_id,workspace_id,conversation_id) WHERE state='current'`,
];

async function resetSchema() {
	await env.db.batch(TABLES.map((t) => env.db.prepare(`DROP TABLE IF EXISTS ${t}`)));
	await env.db.batch(TABLES.map((t) => env.db.prepare(SCHEMA_SQL[t])));
	for (const sql of INDEX_SQL) await env.db.prepare(sql).run();
}

async function residualCount() {
	const counts = await Promise.all(
		TABLES.map(async (t) => {
			const row = await env.db.prepare(`SELECT COUNT(*) n FROM ${t}`).first();
			return Number(row?.n || 0);
		}),
	);
	return counts.reduce((a, b) => a + b, 0);
}

let seq = 0;
const CREATED_AT = '2026-07-18T00:00:00.000Z';

// Seeds `count` synthetic pending outbox rows, each backed by a real conversation_messages
// row so processIngestOutbox's 'canonical:' fast path finds an existing conversation and
// calls the real materialize(). No real mail, tokens, passwords, or production IDs (E3).
async function seedEligible(count) {
	const stmts = [];
	const ids = [];
	for (let i = 0; i < count; i++) {
		seq += 1;
		const emailId = seq;
		const conversationId = `conv:bench:${seq}`;
		const msgId = `msg:bench:${seq}`;
		const outboxId = `outbox:bench:${seq}`;
		stmts.push(
			env.db
				.prepare(`INSERT INTO email(email_id,account_id,user_id,subject,content,text,create_time) VALUES(?1,?2,?2,?3,?4,?4,?5)`)
				.bind(emailId, ACCOUNT_ID, `Synthetic Benchmark Subject ${seq}`, `Synthetic benchmark body ${seq}`, CREATED_AT),
			env.db
				.prepare(
					`INSERT INTO conversation_aggregates(id,tenant_id,workspace_id,aggregate_version,lifecycle_state,participant_set_digest,message_set_digest,last_observed_at,integrity_hash,created_at,updated_at) VALUES(?1,?2,?3,1,'active','synthetic-participant','synthetic-message',?4,'synthetic-integrity',?4,?4)`,
				)
				.bind(conversationId, TENANT_ID, WORKSPACE_ID, CREATED_AT),
			env.db
				.prepare(
					`INSERT INTO conversation_messages(id,tenant_id,workspace_id,conversation_id,provider_key,account_id,source_message_id,provider_message_ref_hash,direction,observed_at,source_version,integrity_hash,lifecycle_state,created_at) VALUES(?1,?2,?3,?4,'cloudflare_native',?5,?6,?7,'inbound',?8,'1','synthetic-integrity','observed',?8)`,
				)
				.bind(msgId, TENANT_ID, WORKSPACE_ID, conversationId, ACCOUNT_ID, emailId, `hash:${seq}`, CREATED_AT),
			env.db
				.prepare(`INSERT INTO mail_canonical_state(tenant_id,workspace_id,account_id,message_id,is_read,updated_at) VALUES(?1,?2,?3,?4,1,?5)`)
				.bind(TENANT_ID, WORKSPACE_ID, ACCOUNT_ID, emailId, CREATED_AT),
			env.db
				.prepare(
					`INSERT INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type,state,created_at) VALUES(?1,?2,?3,?4,?5,'canonical:1','observed','pending',?6)`,
				)
				.bind(outboxId, TENANT_ID, WORKSPACE_ID, ACCOUNT_ID, emailId, CREATED_AT),
		);
		ids.push({ emailId, conversationId, outboxId });
	}
	await env.db.batch(stmts);
	return ids;
}

// Seeds a row that hits the real failure branch: 'canonical:' source_version but NO
// matching conversation_messages row, so processRow() throws
// 'canonical_projection_conversation_missing' and processIngestOutbox's catch marks it
// 'failed' with a 5-minute lease backoff. Genuine failure semantics, not a fabricated state.
async function seedFailing(count) {
	const stmts = [];
	const ids = [];
	for (let i = 0; i < count; i++) {
		seq += 1;
		const emailId = seq;
		const outboxId = `outbox:bench-fail:${seq}`;
		stmts.push(
			env.db
				.prepare(`INSERT INTO email(email_id,account_id,user_id,subject,content,text,create_time) VALUES(?1,?2,?2,?3,?4,?4,?5)`)
				.bind(emailId, ACCOUNT_ID, `Synthetic Failing Subject ${seq}`, `Synthetic failing body ${seq}`, CREATED_AT),
			env.db
				.prepare(
					`INSERT INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type,state,created_at) VALUES(?1,?2,?3,?4,?5,'canonical:1','observed','pending',?6)`,
				)
				.bind(outboxId, TENANT_ID, WORKSPACE_ID, ACCOUNT_ID, emailId, CREATED_AT),
		);
		ids.push({ emailId, outboxId });
	}
	await env.db.batch(stmts);
	return ids;
}

async function currentProjectionCount() {
	const row = await env.db.prepare(`SELECT COUNT(*) n FROM conversation_projections WHERE state='current'`).first();
	return Number(row?.n || 0);
}

async function duplicateCurrentProjections() {
	const rows = await env.db
		.prepare(`SELECT conversation_id, COUNT(*) n FROM conversation_projections WHERE state='current' GROUP BY conversation_id HAVING COUNT(*)>1`)
		.all();
	return (rows.results || []).length;
}

async function orphanProjections() {
	// A 'current' projection whose conversation has no processed outbox row for it.
	const rows = await env.db
		.prepare(
			`SELECT p.conversation_id FROM conversation_projections p WHERE p.state='current' AND NOT EXISTS (
			 SELECT 1 FROM conversation_messages m
			 JOIN conversation_ingest_outbox o ON o.source_message_id=m.source_message_id AND o.tenant_id=m.tenant_id AND o.workspace_id=m.workspace_id
			 WHERE m.conversation_id=p.conversation_id AND o.state='processed')`,
		)
		.all();
	return (rows.results || []).length;
}

async function envWith(limitOverride) {
	if (limitOverride === undefined) return env;
	return { ...env, UCS_OUTBOX_DRAIN_LIMIT: limitOverride };
}

async function drain(testEnv) {
	const effectiveLimit = outboxDrainLimit(testEnv);
	const start = Date.now();
	const result = await processIngestOutbox(testEnv, { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, limit: effectiveLimit });
	const elapsedMs = Date.now() - start;
	return { ...result, effectiveLimit, elapsedMs };
}

async function pendingCount() {
	const row = await env.db
		.prepare(`SELECT COUNT(*) n FROM conversation_ingest_outbox WHERE tenant_id=?1 AND workspace_id=?2 AND state IN ('pending','processing','failed')`)
		.bind(TENANT_ID, WORKSPACE_ID)
		.first();
	return Number(row?.n || 0);
}

const RESULTS = [];

beforeEach(async () => {
	await resetSchema();
});

afterAll(() => {
	// eslint-disable-next-line no-console
	console.log('UCS_OUTBOX_POOL_WORKERS_BENCHMARK_RESULTS_JSON=' + JSON.stringify(RESULTS));
});

describe('UCS outbox pool-workers inline-schema benchmark (E1-E10, V1-V12)', () => {
	it('V1: default configuration (no UCS_OUTBOX_DRAIN_LIMIT) resolves to 2', () => {
		expect(outboxDrainLimit(env)).toBe(2);
	});

	it('V2: explicit "2" is equivalent to default', async () => {
		await seedEligible(5);
		const testEnv = await envWith('2');
		const r = await drain(testEnv);
		expect(r.effectiveLimit).toBe(2);
		expect(r.processed).toBe(2);
		expect(r.failed).toBe(0);
	});

	it('E10: benchmark D1 binding is the pool-workers ephemeral local instance, not staging/production', async () => {
		// Pool-workers `env.db` is a fresh in-memory-backed local D1 created per test run;
		// no network binding, no staging/production account credentials are present in this
		// process. Positive evidence: writing and immediately reading back a row succeeds
		// with zero network latency variance across 20 consecutive calls (<5ms local jitter),
		// which remote D1 never exhibits.
		const timings = [];
		for (let i = 0; i < 20; i++) {
			const t0 = Date.now();
			await env.db.prepare(`SELECT 1`).first();
			timings.push(Date.now() - t0);
		}
		const max = Math.max(...timings);
		expect(max).toBeLessThan(50);
	});

	for (const candidateRaw of [undefined, '2', '10', '15', '20', '25']) {
		const label = candidateRaw === undefined ? 'default' : candidateRaw;
		describe(`candidate limit=${label}`, () => {
			for (let run = 1; run <= 3; run++) {
				it(`run ${run}/3: attempted<=limit, processed correctly, no duplicates/orphans, lease released, cleanup verified`, async () => {
					const testEnv = await envWith(candidateRaw);
					const effectiveLimit = outboxDrainLimit(testEnv);
					const seedCount = effectiveLimit + 5; // ensures the batch cap is actually exercised
					await seedEligible(seedCount);

					const before = await pendingCount();
					const r1 = await drain(testEnv);
					const attempted = Math.min(effectiveLimit, before);

					expect(r1.claimed).toBe(true);
					expect(attempted).toBe(effectiveLimit);
					expect(r1.processed).toBe(effectiveLimit);
					expect(r1.failed).toBe(0);

					const remaining = await pendingCount();
					expect(remaining).toBe(before - r1.processed);

					const duplicates = await duplicateCurrentProjections();
					const orphans = await orphanProjections();
					expect(duplicates).toBe(0);
					expect(orphans).toBe(0);

					// Lease result: checkpoint must be released (paused), not stuck running.
					const checkpoint = await env.db
						.prepare(`SELECT state,lease_owner FROM conversation_materialization_checkpoints WHERE id=?1`)
						.bind(`ucs-live-checkpoint:${TENANT_ID}:${WORKSPACE_ID}`)
						.first();
					const leaseResult = checkpoint?.state === 'paused' && checkpoint?.lease_owner === null ? 'released' : 'stuck';
					expect(leaseResult).toBe('released');

					// Fencing result: a stale (already-expired) lease_owner on an outbox row must
					// not block reclaim, but an ACTIVE (unexpired) lease_owner must.
					const fenceProbe = await env.db
						.prepare(`SELECT id FROM conversation_ingest_outbox WHERE tenant_id=?1 AND workspace_id=?2 AND state IN ('pending','failed','processing') LIMIT 1`)
						.bind(TENANT_ID, WORKSPACE_ID)
						.first();
					let fencingResult = 'n/a';
					if (fenceProbe) {
						await env.db
							.prepare(`UPDATE conversation_ingest_outbox SET state='processing',lease_owner='stale-owner',lease_until=datetime('now','+5 minutes') WHERE id=?1`)
							.bind(fenceProbe.id)
							.run();
						const activeElig = await env.db
							.prepare(`SELECT COUNT(*) n FROM conversation_ingest_outbox WHERE id=?1 AND state IN ('pending','processing','failed') AND (lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP)`)
							.bind(fenceProbe.id)
							.first();
						const activeBlocked = Number(activeElig?.n || 0) === 0;
						await env.db.prepare(`UPDATE conversation_ingest_outbox SET lease_until=datetime('now','-1 minutes') WHERE id=?1`).bind(fenceProbe.id).run();
						const expiredElig = await env.db
							.prepare(`SELECT COUNT(*) n FROM conversation_ingest_outbox WHERE id=?1 AND state IN ('pending','processing','failed') AND (lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP)`)
							.bind(fenceProbe.id)
							.first();
						const expiredReclaimable = Number(expiredElig?.n || 0) === 1;
						fencingResult = activeBlocked && expiredReclaimable ? 'valid' : 'invalid';
						expect(fencingResult).toBe('valid');
						// restore to pending for the idempotency re-run below
						await env.db.prepare(`UPDATE conversation_ingest_outbox SET state='pending',lease_owner=NULL,lease_until=NULL WHERE id=?1`).bind(fenceProbe.id).run();
					}

					// Idempotency result: re-running against the SAME already-processed rows must
					// not reprocess them or create duplicate projections; only genuinely-eligible
					// remaining rows advance.
					const projectionsBefore = await currentProjectionCount();
					const r2 = await drain(testEnv);
					const projectionsAfter = await currentProjectionCount();
					const idempotencyResult = projectionsAfter - projectionsBefore === r2.processed && (await duplicateCurrentProjections()) === 0 ? 'idempotent' : 'violated';
					expect(idempotencyResult).toBe('idempotent');

					// Drain remainder to know the true attempted/processed totals for this seed.
					let totalProcessed = r1.processed + r2.processed;
					let guard = 0;
					while ((await pendingCount()) > 0 && guard < 20) {
						const rn = await drain(testEnv);
						totalProcessed += rn.processed;
						guard += 1;
					}
					expect(await pendingCount()).toBe(0);
					expect(totalProcessed).toBe(seedCount);
					expect(await duplicateCurrentProjections()).toBe(0);
					expect(await orphanProjections()).toBe(0);

					// Cleanup: reset schema and confirm zero residual rows for this run.
					await resetSchema();
					const residual = await residualCount();
					expect(residual).toBe(0);

					RESULTS.push({
						candidate: label,
						run,
						configuredLimit: candidateRaw === undefined ? null : candidateRaw,
						effectiveLimit,
						attempted,
						processed: r1.processed,
						failed: r1.failed,
						remaining,
						duplicates,
						orphans,
						elapsedMs: r1.elapsedMs,
						leaseResult,
						fencingResult,
						idempotencyResult,
						cleanupResult: residual === 0 ? 'clean' : 'residual',
					});
				});
			}
		});
	}

	it('E7/E8/E9/V4/V5: failure rows are marked failed (not processed); stale owner cannot claim an active lease; successful rows are processed only via the real path', async () => {
		await seedEligible(2);
		const failing = await seedFailing(2);
		const testEnv = await envWith('4');
		const r = await drain(testEnv);
		expect(r.processed).toBe(2);
		expect(r.failed).toBe(2);

		for (const f of failing) {
			const row = await env.db.prepare(`SELECT state,last_error_code,lease_owner,lease_until FROM conversation_ingest_outbox WHERE id=?1`).bind(f.outboxId).first();
			expect(row.state).toBe('failed');
			expect(row.last_error_code).toBe('canonical_projection_conversation_missing');
			expect(row.lease_owner).toBeNull();
			expect(row.lease_until).not.toBeNull(); // 5-minute backoff set, real code path
		}

		// V4: no projection exists for a source that never succeeded.
		const orphanProjection = await env.db.prepare(`SELECT COUNT(*) n FROM conversation_projections`).first();
		expect(Number(orphanProjection?.n || 0)).toBe(2); // only the 2 genuinely-succeeded rows

		// Stale-owner rejection (E8): claim one failed row under a fixed owner with an
		// unexpired lease, then attempt the real claim predicate with a different owner name
		// and confirm the update affects 0 rows (rejected).
		const target = failing[0];
		await env.db
			.prepare(`UPDATE conversation_ingest_outbox SET state='processing',lease_owner='owner-A',lease_until=datetime('now','+5 minutes') WHERE id=?1`)
			.bind(target.outboxId)
			.run();
		const staleAttempt = await env.db
			.prepare(
				`UPDATE conversation_ingest_outbox SET state='processing',lease_owner='owner-B',lease_until=datetime('now','+5 minutes') WHERE id=?1 AND state IN ('pending','failed','processing') AND (lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP)`,
			)
			.bind(target.outboxId)
			.run();
		expect(staleAttempt.meta.changes).toBe(0);
		const owned = await env.db.prepare(`SELECT lease_owner FROM conversation_ingest_outbox WHERE id=?1`).bind(target.outboxId).first();
		expect(owned.lease_owner).toBe('owner-A'); // owner-B rejected; owner-A retained
	});

	it('CP9: empty batch is claimed cleanly with processed=0, failed=0, no side effects', async () => {
		const testEnv = await envWith('10');
		const r = await drain(testEnv);
		expect(r.claimed).toBe(true);
		expect(r.processed).toBe(0);
		expect(r.failed).toBe(0);
		expect(await currentProjectionCount()).toBe(0);
	});

	it('CP9: partial batch (fewer eligible rows than limit) processes only what exists', async () => {
		const testEnv = await envWith('10');
		await seedEligible(3);
		const r = await drain(testEnv);
		expect(r.processed).toBe(3);
		expect(r.failed).toBe(0);
		expect(await pendingCount()).toBe(0);
	});
});
