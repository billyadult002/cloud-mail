import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
	assertConnectionMissionAssociation,
	AUTHORIZATION_SESSION_EXPIRED_SQL,
	AUTHORIZATION_SESSION_LIVE_SQL,
	AUTHORIZATION_SESSION_QUALIFIED_EXPIRED_SQL,
	createConnectionOperation,
	persistConnectionEvidence,
} from '../../src/service/connection-runtime-service.js';

const scope = { tenantId: 71001, workspaceId: 71002 };
const tables = [
	'mission_runtime_evidence',
	'mission_runtime_evidence_relations',
	'mission_runtime_verification_evidence',
	'mission_runtime_verifications',
	'mission_runtime_events',
	'mission_runtime_claims',
	'mission_runtime_verification_policies',
	'mission_runtime_runs',
	'mission_runtime_missions',
	'nexora_connection_operations',
	'nexora_onboarding_authorization_sessions',
];
const schema = [
	`CREATE TABLE mission_runtime_missions (
		id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL
	)`,
	`CREATE TABLE mission_runtime_runs (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL,
		workspace_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE mission_runtime_verification_policies (
		id TEXT NOT NULL, version INTEGER NOT NULL, claim_type TEXT NOT NULL,
		required_evidence_json TEXT NOT NULL, freshness_seconds INTEGER NOT NULL,
		minimum_distinct_evidence INTEGER NOT NULL DEFAULT 1,
		conflict_mode TEXT NOT NULL DEFAULT 'reject', active INTEGER NOT NULL DEFAULT 1,
		policy_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(id,version)
	)`,
	`CREATE TABLE mission_runtime_claims (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL,
		step_id TEXT NOT NULL, action_id TEXT, tenant_id INTEGER NOT NULL,
		workspace_id INTEGER NOT NULL, claim_key TEXT NOT NULL, claim_type TEXT NOT NULL,
		subject_hash TEXT NOT NULL, assertion_hash TEXT NOT NULL,
		required_evidence_json TEXT NOT NULL, policy_id TEXT NOT NULL,
		policy_version INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
		version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(mission_id,claim_key)
	)`,
	`CREATE TABLE mission_runtime_evidence (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL,
		step_id TEXT NOT NULL, action_id TEXT, tenant_id INTEGER NOT NULL,
		workspace_id INTEGER NOT NULL, claim_key TEXT NOT NULL, source_type TEXT NOT NULL,
		status TEXT NOT NULL, reference_hash TEXT NOT NULL, summary_json TEXT NOT NULL DEFAULT '{}',
		observed_at TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		evidence_type TEXT NOT NULL DEFAULT 'provider_observation',
		producer_type TEXT NOT NULL DEFAULT 'controlled_system',
		producer_id_hash TEXT NOT NULL DEFAULT '', integrity_hash TEXT NOT NULL DEFAULT ''
	)`,
	`CREATE TABLE mission_runtime_evidence_relations (
		id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		evidence_id TEXT NOT NULL, related_evidence_id TEXT NOT NULL, relation_type TEXT NOT NULL
	)`,
	`CREATE TABLE mission_runtime_verifications (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, action_id TEXT,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, state TEXT NOT NULL,
		evidence_id TEXT NOT NULL, verifier TEXT NOT NULL, claim_id TEXT, policy_id TEXT,
		policy_version INTEGER, evidence_set_hash TEXT NOT NULL DEFAULT '',
		reason_codes_json TEXT NOT NULL DEFAULT '[]', integrity_state TEXT NOT NULL DEFAULT 'valid',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE mission_runtime_verification_evidence (
		verification_id TEXT NOT NULL, evidence_id TEXT NOT NULL, tenant_id INTEGER NOT NULL,
		workspace_id INTEGER NOT NULL, disposition TEXT NOT NULL, reason_code TEXT NOT NULL,
		evidence_integrity_hash TEXT NOT NULL
	)`,
	`CREATE TABLE mission_runtime_events (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT, step_id TEXT, action_id TEXT,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, event_type TEXT NOT NULL,
		from_state TEXT, to_state TEXT, expected_version INTEGER, fencing_token INTEGER,
		detail_json TEXT NOT NULL DEFAULT '{}'
	)`,
	`CREATE TABLE nexora_connection_operations (
		id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, tenant_id INTEGER NOT NULL,
		workspace_id INTEGER NOT NULL, operation_type TEXT NOT NULL, idempotency_key TEXT NOT NULL,
		authorization_session_id TEXT, expected_authority_generation INTEGER NOT NULL,
		expected_connection_generation INTEGER NOT NULL, expected_credential_generation INTEGER NOT NULL,
		lease_owner TEXT, lease_expires_at TEXT, fencing_token INTEGER, state TEXT NOT NULL,
		request_digest TEXT NOT NULL, authority_tuple_digest TEXT NOT NULL, error_code TEXT,
		attempt INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(connection_id,operation_type,idempotency_key)
	)`,
	`CREATE TABLE nexora_onboarding_authorization_sessions (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL,
		workspace_id INTEGER NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
		expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
];

beforeEach(async () => {
	for (const table of tables) await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	for (const statement of schema) await env.db.prepare(statement).run();
	await env.db.prepare(`INSERT INTO mission_runtime_missions(id,tenant_id,workspace_id) VALUES('mission-prod',?1,?2)`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id) VALUES('run-prod','mission-prod',?1,?2)`).bind(scope.tenantId, scope.workspaceId).run();
});

describe('Connection evidence uses the production Mission Claim contract', () => {
	it('persists and rereads every required claim and policy authority field', async () => {
		const result = await persistConnectionEvidence(
			{ env: { db: env.db } },
			scope,
			{
				connection: {
					id: 'connection-prod',
					account_id: 71003,
					onboarding_mission_id: 'mission-prod',
					connection_generation: 4,
					credential_generation: 0,
					fencing_token: 9,
				},
				operation: { id: 'operation-prod', type: 'REAUTHORIZE' },
				result: {
					classification: 'AUTHORIZATION_SESSION_BOUND',
					providerHttpStatus: null,
					providerNetworkCalled: false,
				},
			},
		);

		const claim = await env.db.prepare(`SELECT * FROM mission_runtime_claims WHERE id='connection-claim:operation-prod'`).first();
		const policy = await env.db.prepare(`SELECT * FROM mission_runtime_verification_policies WHERE id='connection_reauthorize_v1' AND version=1`).first();
		expect(claim).toMatchObject({
			mission_id: 'mission-prod',
			run_id: 'run-prod',
			step_id: 'connection_reauthorize',
			action_id: 'operation-prod',
			tenant_id: scope.tenantId,
			workspace_id: scope.workspaceId,
			claim_key: 'connection_reauthorize:operation-prod',
			claim_type: 'connection_operation_outcome',
			policy_id: 'connection_reauthorize_v1',
			policy_version: 1,
		});
		expect(claim.subject_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(claim.assertion_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.parse(claim.required_evidence_json)).toEqual(['connection_reauthorize']);
		expect(policy).toMatchObject({
			claim_type: 'connection_operation_outcome',
			required_evidence_json: '["connection_reauthorize"]',
			freshness_seconds: 300,
			minimum_distinct_evidence: 1,
			conflict_mode: 'fail_closed',
			active: 1,
		});
		expect(result).toMatchObject({
			claimId: 'connection-claim:operation-prod',
		});
		expect(result.verificationId).toMatch(/^[0-9a-f-]{36}$/);

		const replay = await persistConnectionEvidence(
			{ env: { db: env.db } },
			scope,
			{
				connection: {
					id: 'connection-prod',
					account_id: 71003,
					onboarding_mission_id: 'mission-prod',
					connection_generation: 4,
					credential_generation: 0,
					fencing_token: 9,
				},
				operation: { id: 'operation-prod', type: 'REAUTHORIZE' },
				result: {
					classification: 'AUTHORIZATION_SESSION_BOUND',
					providerHttpStatus: null,
					providerNetworkCalled: false,
				},
			},
		);
		expect(replay.verificationId).toBe(result.verificationId);
		expect((await env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_evidence`).first()).count).toBe(1);
		expect((await env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_verifications`).first()).count).toBe(1);
	});

	it('retires an expired partial operation and creates one newly fenced retry attempt', async () => {
		await env.db.prepare(`INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,authorization_session_id,expected_authority_generation,expected_connection_generation,expected_credential_generation,lease_owner,lease_expires_at,fencing_token,state,request_digest,authority_tuple_digest,attempt) VALUES('expired-op','connection-prod',?1,?2,'REAUTHORIZE','authorization:session-prod','session-prod',0,4,0,'old-owner',datetime('now','-1 minute'),9,'LEASED',?3,?4,1)`).bind(scope.tenantId, scope.workspaceId, 'a'.repeat(64), 'b'.repeat(64)).run();
		const operation = await createConnectionOperation(
			{ env: { db: env.db } },
			scope,
			{
				id: 'connection-prod',
				authority_generation: 0,
				connection_generation: 4,
				credential_generation: 0,
				lease_owner: 'new-owner',
				lease_expires_at: '2099-01-01 00:00:00',
				fencing_token: 10,
			},
			{ type: 'REAUTHORIZE', idempotencyKey: 'authorization:session-prod', authorizationSessionId: 'session-prod' },
		);
		const retired = await env.db.prepare(`SELECT state,lease_owner,lease_expires_at,fencing_token,error_code FROM nexora_connection_operations WHERE id='expired-op'`).first();
		const retry = await env.db.prepare(`SELECT idempotency_key,state,lease_owner,fencing_token FROM nexora_connection_operations WHERE id=?1`).bind(operation.id).first();
		expect(retired).toMatchObject({ state: 'FAILED', lease_owner: null, lease_expires_at: null, fencing_token: null, error_code: 'INCOMPLETE_ATTEMPT_EXPIRED' });
		expect(retry).toMatchObject({ idempotency_key: 'authorization:session-prod:retry:10', state: 'LEASED', lease_owner: 'new-owner', fencing_token: 10 });
	});

	it('rebinds only a credential-free DISCOVERED Connection whose prior ISO session is expired', async () => {
		await env.db.prepare(`INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status,expires_at) VALUES('old-session','old-mission',?1,?2,'google','pending',?3)`).bind(scope.tenantId, scope.workspaceId, new Date(Date.now() - 60000).toISOString()).run();
		const discovered = {
			state: 'DISCOVERED',
			onboarding_mission_id: 'old-mission',
			provider_connection_id: null,
			provider_connection_generation: 0,
			credential_reference_id: null,
			credential_generation: 0,
		};
		await expect(assertConnectionMissionAssociation({ env: { db: env.db } }, scope, discovered, 'new-mission', 'google')).resolves.toBe(true);
		await env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET expires_at=?1 WHERE id='old-session'`).bind(new Date(Date.now() + 60000).toISOString()).run();
		await expect(assertConnectionMissionAssociation({ env: { db: env.db } }, scope, discovered, 'new-mission', 'google')).rejects.toThrow('connection_mission_association_session_conflict');
		await env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET expires_at='malformed' WHERE id='old-session'`).run();
		await expect(assertConnectionMissionAssociation({ env: { db: env.db } }, scope, discovered, 'new-mission', 'google')).rejects.toThrow('connection_mission_association_session_conflict');
		await env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET expires_at=?1 WHERE id='old-session'`).bind(new Date(Date.now() - 60000).toISOString()).run();
		await env.db.prepare(`INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status,expires_at) VALUES('live-sibling','old-mission',?1,?2,'google','pending',?3)`).bind(scope.tenantId, scope.workspaceId, new Date(Date.now() + 60000).toISOString()).run();
		await expect(assertConnectionMissionAssociation({ env: { db: env.db } }, scope, discovered, 'new-mission', 'google')).rejects.toThrow('connection_mission_association_session_conflict');
		await expect(assertConnectionMissionAssociation({ env: { db: env.db } }, scope, { ...discovered, credential_reference_id: 'credential-1', credential_generation: 1, provider_connection_id: 'provider-1', provider_connection_generation: 1 }, 'new-mission', 'google')).rejects.toThrow('connection_mission_association_authority_conflict');
	});

	it('normalizes ISO authorization-session timestamps in every SQL recovery guard', async () => {
		expect(AUTHORIZATION_SESSION_EXPIRED_SQL).toBe("julianday(expires_at)<=julianday('now')");
		expect(AUTHORIZATION_SESSION_QUALIFIED_EXPIRED_SQL).toBe("julianday(s.expires_at)<=julianday('now')");
		expect(AUTHORIZATION_SESSION_LIVE_SQL).toBe("julianday(expires_at)>julianday('now')");

		const past = new Date(Date.now() - 60000).toISOString();
		const future = new Date(Date.now() + 60000).toISOString();
		const comparison = await env.db.prepare(
			`SELECT julianday(?1)<=julianday('now') AS past_expired,
			        julianday(?2)>julianday('now') AS future_live,
			        julianday(?1)>julianday('now') AS expired_replacement_live,
			        julianday('malformed')<=julianday('now') AS malformed_expired,
			        julianday('malformed')>julianday('now') AS malformed_live,
			        ?1<=CURRENT_TIMESTAMP AS bare_past_comparison`
		).bind(past, future).first();
		expect(comparison).toMatchObject({
			past_expired: 1,
			future_live: 1,
			expired_replacement_live: 0,
			malformed_expired: null,
			malformed_live: null,
			bare_past_comparison: 0,
		});
	});
});
