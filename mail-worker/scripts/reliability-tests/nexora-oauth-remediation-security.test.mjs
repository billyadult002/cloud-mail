import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/hono/webs.js';
import scopeManifest from '../../src/service/nexora-oauth-scope-manifest-service.js';
import exchangeReceipt from '../../src/service/nexora-oauth-exchange-receipt-service.js';
import callbackIntake from '../../src/service/nexora-oauth-callback-intake-service.js';
import tokenStorage from '../../src/service/nexora-onboarding-token-storage-service.js';

const TENANT_ID = 88101;
const WORKSPACE_ID = 88102;
const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };
const c = { env: { ...env, AI_PROVIDER_TOKEN_SECRET: 'test-only-oauth-receipt-secret' } };

const SCHEMA = [
	`CREATE TABLE nexora_onboarding_authorization_sessions (
	 id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,
	 provider TEXT NOT NULL,status TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE nexora_onboarding_callback_claims (
	 id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL,authorization_session_id TEXT NOT NULL,onboarding_mission_id TEXT NOT NULL,
	 tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,lease_owner TEXT,lease_expires_at TEXT,
	 fencing_token INTEGER NOT NULL,claim_status TEXT NOT NULL,recovery_mode TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE nexora_onboarding_callback_checkpoints (
	 id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL,claim_id TEXT NOT NULL,fencing_token INTEGER NOT NULL,step TEXT NOT NULL,
	 status TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,observed_at TEXT,persisted_at TEXT,completed_at TEXT,last_error_code TEXT,
	 UNIQUE(correlation_id,step)
	)`,
	`CREATE TABLE nexora_oauth_authorization_session_bindings (
	 authorization_session_id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,
	 provider TEXT NOT NULL,runtime_mode TEXT NOT NULL DEFAULT 'LEGACY',connection_id TEXT,connection_generation INTEGER,authority_generation INTEGER,account_id INTEGER,
	 account_owner_user_id INTEGER,domain_authority_id TEXT,domain_authority_generation INTEGER,authority_kind TEXT,
	 membership_authority_id TEXT,membership_authority_generation INTEGER,delegation_authority_id TEXT,delegation_authority_generation INTEGER,
	 redirect_uri_hash TEXT NOT NULL,oauth_client_fingerprint TEXT NOT NULL,scope_manifest_version TEXT NOT NULL,
	 scope_manifest_digest TEXT NOT NULL,issued_at TEXT NOT NULL,expires_at TEXT NOT NULL,callback_receipt_status TEXT NOT NULL DEFAULT 'NOT_RECEIVED',
	 exchange_status TEXT NOT NULL DEFAULT 'EXCHANGE_NOT_STARTED',recovery_status TEXT NOT NULL DEFAULT 'NONE',
	 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE nexora_oauth_exchange_attempts (
	 id TEXT PRIMARY KEY,authorization_session_id TEXT NOT NULL UNIQUE,callback_correlation_id TEXT NOT NULL UNIQUE,
	 callback_claim_id TEXT NOT NULL,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,
	 provider TEXT NOT NULL,connection_id TEXT,expected_connection_generation INTEGER,expected_authority_generation INTEGER,
	 exchange_owner TEXT NOT NULL,lease_expires_at TEXT NOT NULL,fencing_token INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
	 request_digest TEXT NOT NULL,provider_request_reference TEXT,state TEXT NOT NULL,receipt_ciphertext TEXT,receipt_digest TEXT,
	 receipt_expires_at TEXT,credential_reference_id TEXT,provider_connection_id TEXT,provider_connection_generation INTEGER,
	 terminal_reason_code TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT
	)`,
	`CREATE TABLE nexora_oauth_callback_intakes (
	 id TEXT PRIMARY KEY,authorization_session_id TEXT NOT NULL UNIQUE,callback_correlation_id TEXT NOT NULL UNIQUE,
	 callback_claim_id TEXT NOT NULL,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,
	 provider TEXT NOT NULL,payload_ciphertext TEXT NOT NULL,payload_digest TEXT NOT NULL,payload_expires_at TEXT NOT NULL,
	 state TEXT NOT NULL,lease_owner TEXT,lease_expires_at TEXT,fencing_token INTEGER NOT NULL DEFAULT 0,attempt INTEGER NOT NULL DEFAULT 0,
	 terminal_reason_code TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT
	)`,
	`CREATE TABLE nexora_autonomy_jobs (
	 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,job_type TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
	 state TEXT NOT NULL DEFAULT 'QUEUED',attempt_count INTEGER NOT NULL DEFAULT 0,input_json TEXT NOT NULL DEFAULT '{}',
	 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE nexora_connections (
	 id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,
	 state TEXT NOT NULL,connection_generation INTEGER NOT NULL,authority_generation INTEGER NOT NULL,
	 account_id INTEGER NOT NULL,domain_authority_id TEXT NOT NULL,domain_authority_generation INTEGER NOT NULL,credential_reference_id TEXT,
	 credential_generation INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE workspaces(id INTEGER PRIMARY KEY,tenant_key TEXT NOT NULL)`,
	`CREATE TABLE workspace_members(workspace_id INTEGER NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id))`,
	`CREATE TABLE account(account_id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,is_del INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE nexora_domain_authorities(
	 id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,generation INTEGER NOT NULL,
	 verification_status TEXT NOT NULL,revoked_at TEXT
	)`,
	`CREATE TABLE workspace_membership_authorities(
	 id TEXT PRIMARY KEY,tenant_key TEXT NOT NULL,workspace_id INTEGER NOT NULL,subject_user_id INTEGER NOT NULL,
	 state TEXT NOT NULL,authority_generation INTEGER NOT NULL,expires_at TEXT
	)`,
	`CREATE TABLE workspace_account_delegations(
	 id TEXT PRIMARY KEY,tenant_key TEXT NOT NULL,workspace_id INTEGER NOT NULL,account_id INTEGER NOT NULL,
	 owner_user_id INTEGER NOT NULL,subject_user_id INTEGER NOT NULL,scope_json TEXT NOT NULL,state TEXT NOT NULL,
	 authority_generation INTEGER NOT NULL,owner_consent_at TEXT,approved_at TEXT,expires_at TEXT NOT NULL
	)`,
	`CREATE VIEW nexora_oauth_live_authorization_bindings AS
	 SELECT b.authorization_session_id
	 FROM nexora_oauth_authorization_session_bindings b
	 JOIN nexora_connections cn ON cn.id=b.connection_id AND cn.tenant_id=b.tenant_id AND cn.workspace_id=b.workspace_id
	  AND cn.authority_generation=b.authority_generation
	  AND cn.account_id=b.account_id AND cn.domain_authority_id=b.domain_authority_id
	  AND cn.domain_authority_generation=b.domain_authority_generation
	 JOIN nexora_domain_authorities da ON da.id=b.domain_authority_id AND da.tenant_id=b.tenant_id
	  AND da.workspace_id=b.workspace_id AND da.generation=b.domain_authority_generation
	  AND da.verification_status='verified' AND da.revoked_at IS NULL
	 JOIN account a ON a.account_id=b.account_id AND a.user_id=b.account_owner_user_id AND a.is_del=0
	 JOIN workspaces w ON w.id=b.workspace_id
	 JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=b.tenant_id
	 WHERE b.runtime_mode='CONNECTION_RUNTIME' AND ((b.authority_kind='ACCOUNT_OWNER' AND b.account_owner_user_id=b.tenant_id AND b.authority_generation=0
	        AND b.membership_authority_id IS NULL AND b.delegation_authority_id IS NULL)
	    OR (b.authority_kind='ACCOUNT_DELEGATION' AND b.account_owner_user_id<>b.tenant_id
	        AND EXISTS(SELECT 1 FROM workspace_membership_authorities ma WHERE ma.id=b.membership_authority_id
	         AND ma.workspace_id=b.workspace_id AND ma.subject_user_id=b.tenant_id AND ma.tenant_key=w.tenant_key
	         AND ma.authority_generation=b.membership_authority_generation AND ma.state='active'
	         AND (ma.expires_at IS NULL OR ma.expires_at>CURRENT_TIMESTAMP))
	        AND EXISTS(SELECT 1 FROM workspace_account_delegations d WHERE d.id=b.delegation_authority_id
	         AND d.workspace_id=b.workspace_id AND d.account_id=b.account_id AND d.owner_user_id=b.account_owner_user_id
	         AND d.subject_user_id=b.tenant_id AND d.tenant_key=w.tenant_key
	         AND d.authority_generation=b.delegation_authority_generation AND d.authority_generation=b.authority_generation
	         AND d.state='active' AND d.owner_consent_at IS NOT NULL AND d.approved_at IS NOT NULL
	         AND d.expires_at>CURRENT_TIMESTAMP
	         AND EXISTS(SELECT 1 FROM json_each(d.scope_json) WHERE value='account_state_visibility'))))`,
	`CREATE TABLE nexora_onboarding_tokens (
	 id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,
	 provider TEXT NOT NULL,provider_account_hash TEXT NOT NULL,refresh_token_ciphertext TEXT NOT NULL,
	 access_token_ciphertext TEXT,access_token_expires_at TEXT,granted_scopes_json TEXT NOT NULL,
	 rotation_generation INTEGER NOT NULL DEFAULT 1,connection_health TEXT NOT NULL DEFAULT 'unknown',
	 revoked_at TEXT,revoked_reason TEXT,refresh_failure_count INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
];

async function resetSchema() {
	await env.db.prepare(`DROP VIEW IF EXISTS nexora_oauth_live_authorization_bindings`).run();
	for (const table of ['workspace_account_delegations','workspace_membership_authorities','nexora_domain_authorities','account','workspace_members','workspaces','nexora_onboarding_tokens','nexora_connections','nexora_autonomy_jobs','nexora_oauth_callback_intakes','nexora_oauth_exchange_attempts','nexora_oauth_authorization_session_bindings','nexora_onboarding_callback_checkpoints','nexora_onboarding_callback_claims','nexora_onboarding_authorization_sessions']) {
		await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	}
	for (const sql of SCHEMA) await env.db.prepare(sql).run();
	await env.db.batch([
		env.db.prepare(`INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status,expires_at) VALUES('session-1','mission-1',?1,?2,'google','consumed',datetime('now','+5 minutes'))`).bind(TENANT_ID, WORKSPACE_ID),
		env.db.prepare(`INSERT INTO nexora_onboarding_callback_claims(id,correlation_id,authorization_session_id,onboarding_mission_id,tenant_id,workspace_id,provider,lease_owner,lease_expires_at,fencing_token,claim_status,recovery_mode) VALUES('claim-1','correlation-1','session-1','mission-1',?1,?2,'google','worker-1',datetime('now','+5 minutes'),7,'CLAIMED','EXECUTION')`).bind(TENANT_ID, WORKSPACE_ID),
		env.db.prepare(`INSERT INTO workspaces(id,tenant_key) VALUES(?1,?2)`).bind(WORKSPACE_ID, `user:${TENANT_ID}`),
		env.db.prepare(`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?1,?2,'OWNER')`).bind(WORKSPACE_ID, TENANT_ID),
		env.db.prepare(`INSERT INTO account(account_id,user_id,is_del) VALUES(42,?1,0)`).bind(TENANT_ID),
		env.db.prepare(`INSERT INTO nexora_domain_authorities(id,tenant_id,workspace_id,generation,verification_status) VALUES('domain-1',?1,?2,1,'verified')`).bind(TENANT_ID, WORKSPACE_ID),
		env.db.prepare(`INSERT INTO nexora_oauth_authorization_session_bindings(
		 authorization_session_id,onboarding_mission_id,tenant_id,workspace_id,provider,runtime_mode,connection_id,connection_generation,
		 authority_generation,account_id,account_owner_user_id,domain_authority_id,domain_authority_generation,authority_kind,
		 redirect_uri_hash,oauth_client_fingerprint,scope_manifest_version,scope_manifest_digest,issued_at,expires_at
		) VALUES('session-1','mission-1',?1,?2,'google','CONNECTION_RUNTIME','connection-1',8,0,42,?1,'domain-1',1,'ACCOUNT_OWNER',
		 'redirect-hash','client-hash','google-oauth-scopes-v1','manifest-hash',CURRENT_TIMESTAMP,datetime('now','+5 minutes'))`).bind(TENANT_ID, WORKSPACE_ID),
		env.db.prepare(`INSERT INTO nexora_connections(id,tenant_id,workspace_id,provider,state,connection_generation,authority_generation,account_id,domain_authority_id,domain_authority_generation) VALUES('connection-1',?1,?2,'google','AUTHORIZATION_PENDING',8,0,42,'domain-1',1)`).bind(TENANT_ID, WORKSPACE_ID),
	]);
}

beforeEach(resetSchema);

async function bindDelegatedAuthority() {
	await env.db.batch([
		env.db.prepare(`UPDATE workspaces SET tenant_key='org:fixture' WHERE id=?1`).bind(WORKSPACE_ID),
		env.db.prepare(`UPDATE account SET user_id=99001 WHERE account_id=42`),
		env.db.prepare(`INSERT INTO workspace_membership_authorities(id,tenant_key,workspace_id,subject_user_id,state,authority_generation,expires_at) VALUES('membership-1','org:fixture',?1,?2,'active',4,datetime('now','+1 day'))`).bind(WORKSPACE_ID, TENANT_ID),
		env.db.prepare(`INSERT INTO workspace_account_delegations(id,tenant_key,workspace_id,account_id,owner_user_id,subject_user_id,scope_json,state,authority_generation,owner_consent_at,approved_at,expires_at) VALUES('delegation-1','org:fixture',?1,42,99001,?2,'["account_state_visibility"]','active',3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,datetime('now','+1 day'))`).bind(WORKSPACE_ID, TENANT_ID),
		env.db.prepare(`UPDATE nexora_oauth_authorization_session_bindings SET authority_generation=3,account_owner_user_id=99001,authority_kind='ACCOUNT_DELEGATION',membership_authority_id='membership-1',membership_authority_generation=4,delegation_authority_id='delegation-1',delegation_authority_generation=3 WHERE authorization_session_id='session-1'`),
		env.db.prepare(`UPDATE nexora_connections SET authority_generation=3 WHERE id='connection-1'`),
	]);
}

describe('OAuth callback browser confidentiality', () => {
	it('always redirects an incomplete callback to a fixed queryless route and clears the verifier cookie', async () => {
		const response = await app.request('/v3/onboarding/providers/google/callback?state=sensitive-state-fixture&code=sensitive-code-fixture', {
			headers: { Cookie: 'nexora_pkce_verifier=wrong-fixture' },
		}, { ...env, NEXORA_GOOGLE_OAUTH_REDIRECT_URI: 'https://example.test/v3/onboarding/providers/google/callback' });
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/v3/onboarding/providers/google/result');
		expect(response.headers.get('location')).not.toMatch(/state|code|sensitive/i);
		expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
	});

	it('serves a static clean result with no third-party resources or callback artifacts', async () => {
		const response = await app.request('/v3/onboarding/providers/google/result', {}, env);
		const body = await response.text();
		expect(response.status).toBe(200);
		expect(body).not.toMatch(/state=|code=|token|script|img|iframe/i);
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
	});
});

describe('Encrypted callback intake and durable restart processing', () => {
	const consumption = {
		duplicate: false,
		authorizationSessionId: 'session-1',
		correlationId: 'correlation-1',
		onboardingMissionId: 'mission-1',
		provider: 'google',
		scope,
		callbackClaim: { id: 'claim-1' },
	};
	const payload = {
		code: 'authorization-code-fixture',
		verifier: 'pkce-verifier-fixture',
		redirectUri: 'https://example.test/v3/onboarding/providers/google/callback',
	};

	it('seals callback artifacts, records retry state, and completes from durable intake after a worker restart', async () => {
		const sealed = await callbackIntake.sealCallback(c, consumption, payload);
		expect(sealed.payload_ciphertext).not.toContain(payload.code);
		expect(sealed.payload_ciphertext).not.toContain(payload.verifier);
		await expect(callbackIntake.processIntake(c, sealed.id, async () => {
			throw new Error('simulated_worker_eviction');
		})).rejects.toThrow('simulated_worker_eviction');
		expect(await env.db.prepare(`SELECT state FROM nexora_oauth_callback_intakes WHERE id=?1`).bind(sealed.id).first()).toMatchObject({ state: 'RECOVERY_REQUIRED' });
		expect(await env.db.prepare(`SELECT state,attempt_count FROM nexora_autonomy_jobs WHERE id=?1`).bind(`oauth-callback-job:${sealed.id}`).first()).toMatchObject({ state: 'RETRYING', attempt_count: 1 });

		const restartedContext = { env: { ...env, AI_PROVIDER_TOKEN_SECRET: 'test-only-oauth-receipt-secret' } };
		const outcome = await callbackIntake.processPending(restartedContext, async (_worker, _row, opened) => {
			expect(opened).toMatchObject(payload);
			return { recovered: true };
		});
		expect(outcome).toEqual([{ processed: true, result: { recovered: true } }]);
		expect(await env.db.prepare(`SELECT state,payload_ciphertext FROM nexora_oauth_callback_intakes WHERE id=?1`).bind(sealed.id).first()).toMatchObject({ state: 'COMPLETED', payload_ciphertext: '' });
		expect(await env.db.prepare(`SELECT state,attempt_count FROM nexora_autonomy_jobs WHERE id=?1`).bind(`oauth-callback-job:${sealed.id}`).first()).toMatchObject({ state: 'SUCCEEDED', attempt_count: 2 });
	});

	it('fails closed on damaged ciphertext and tombstones expired intake with its durable job blocked', async () => {
		const sealed = await callbackIntake.sealCallback(c, consumption, payload);
		await env.db.prepare(`UPDATE nexora_oauth_callback_intakes SET payload_ciphertext='damaged-envelope' WHERE id=?1`).bind(sealed.id).run();
		await expect(callbackIntake.processIntake(c, sealed.id, async () => ({ ok: true }))).rejects.toThrow();
		expect(await env.db.prepare(`SELECT state FROM nexora_oauth_callback_intakes WHERE id=?1`).bind(sealed.id).first()).toMatchObject({ state: 'RECOVERY_REQUIRED' });
		await env.db.prepare(`UPDATE nexora_oauth_callback_intakes SET payload_expires_at=datetime('now','-1 second') WHERE id=?1`).bind(sealed.id).run();
		const purged = await callbackIntake.purgeExpired(c);
		expect(Number(purged.meta?.changes)).toBe(1);
		expect(await env.db.prepare(`SELECT state,payload_ciphertext,terminal_reason_code FROM nexora_oauth_callback_intakes WHERE id=?1`).bind(sealed.id).first()).toMatchObject({
			state: 'REAUTHORIZATION_REQUIRED',
			payload_ciphertext: '',
			terminal_reason_code: 'CALLBACK_INTAKE_EXPIRED',
		});
		expect(await env.db.prepare(`SELECT state FROM nexora_autonomy_jobs WHERE id=?1`).bind(`oauth-callback-job:${sealed.id}`).first()).toMatchObject({ state: 'BLOCKED' });
	});

	it('a stale intake worker cannot complete or fail another intake fence', async () => {
		const sealed = await callbackIntake.sealCallback(c, consumption, payload);
		await expect(callbackIntake.processIntake(c, sealed.id, async (_worker, row) => {
			await env.db.prepare(
				`UPDATE nexora_oauth_callback_intakes
				 SET lease_owner='replacement-worker',fencing_token=fencing_token+1,lease_expires_at=datetime('now','+60 seconds')
				 WHERE id=?1 AND state='PROCESSING'`
			).bind(row.id).run();
			return { stale: true };
		})).rejects.toThrow();
		expect(await env.db.prepare(`SELECT state,lease_owner FROM nexora_oauth_callback_intakes WHERE id=?1`).bind(sealed.id).first()).toMatchObject({
			state: 'PROCESSING',
			lease_owner: 'replacement-worker',
		});
		expect(await env.db.prepare(`SELECT state FROM nexora_autonomy_jobs WHERE id=?1`).bind(`oauth-callback-job:${sealed.id}`).first()).not.toMatchObject({ state: 'SUCCEEDED' });
	});
});

describe('Versioned minimum-scope gate', () => {
	it('approves only the exact read-only Google scope set', async () => {
		const approved = await scopeManifest.verifyRequestedScopes({
			provider: 'google',
			capabilities: ['mail_read'],
			requestedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
		});
		expect(approved.approved).toBe(true);
		expect(approved.manifestVersion).toBe('google-oauth-scopes-v1');
		const overbroad = await scopeManifest.verifyRequestedScopes({
			provider: 'google',
			capabilities: ['mail_read'],
			requestedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
		});
		expect(overbroad).toMatchObject({ approved: false, reason: 'SCOPE_MANIFEST_MISMATCH' });
		expect(overbroad.unexpectedScopes).toContain('https://www.googleapis.com/auth/gmail.send');
	});

	it('rejects post-authorization scope substitution', async () => {
		const approved = await scopeManifest.verifyRequestedScopes({
			provider: 'google', capabilities: ['mail_read'], requestedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
		});
		const result = await scopeManifest.verifyGrantedScopes({
			manifestVersion: approved.manifestVersion,
			manifestDigest: approved.manifestDigest,
			provider: 'google',
			capabilities: ['mail_read'],
			requestedScopes: approved.expectedScopes,
			grantedScopes: [...approved.expectedScopes, 'https://www.googleapis.com/auth/gmail.modify'],
		});
		expect(result).toMatchObject({ approved: false, reason: 'POST_AUTHORIZATION_SCOPE_SUBSTITUTION' });
	});
});

describe('Sealed exchange receipt and fenced recovery', () => {
	it('allows exactly one exchange owner when two intake workers race the same claim', async () => {
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const args = {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 0, requestDigest: 'request-digest-race',
		};
		const first = await exchangeReceipt.claimExchange(c, scope, args);
		const loser = await exchangeReceipt.claimExchange(c, scope, args);
		expect(first.claimed).toBe(true);
		expect(loser.claimed).toBe(false);
		expect(loser.attempt.id).toBe(first.attempt.id);
	});

	it.each([
		['account deletion', `UPDATE account SET is_del=1 WHERE account_id=42`],
		['Domain Authority revocation', `UPDATE nexora_domain_authorities SET verification_status='revoked',revoked_at=CURRENT_TIMESTAMP,generation=2 WHERE id='domain-1'`],
	])('blocks provider exchange before the network boundary after live %s without changing the cached Connection', async (_label, revokeSql) => {
		const runtimeContext = { env: { ...c.env, NEXORA_CONNECTION_RUNTIME_ENABLED: 'true' } };
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const cachedBefore = await env.db.prepare(`SELECT connection_generation,authority_generation,domain_authority_generation FROM nexora_connections WHERE id='connection-1'`).first();
		await env.db.prepare(revokeSql).run();
		await expect(exchangeReceipt.claimExchange(runtimeContext, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 0, requestDigest: `request-digest-${_label}`,
		})).rejects.toThrow(/runtime_authority_denied/);
		expect(await env.db.prepare(`SELECT connection_generation,authority_generation,domain_authority_generation FROM nexora_connections WHERE id='connection-1'`).first()).toEqual(cachedBefore);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_oauth_exchange_attempts`).first()).n)).toBe(0);
	});

	it('blocks provider exchange after live delegation revocation without changing the cached Connection', async () => {
		const runtimeContext = { env: { ...c.env, NEXORA_CONNECTION_RUNTIME_ENABLED: 'true' } };
		await bindDelegatedAuthority();
		await env.db.prepare(`UPDATE workspace_account_delegations SET state='revoked',authority_generation=4 WHERE id='delegation-1'`).run();
		const cachedBefore = await env.db.prepare(`SELECT connection_generation,authority_generation,domain_authority_generation FROM nexora_connections WHERE id='connection-1'`).first();
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		await expect(exchangeReceipt.claimExchange(runtimeContext, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 3, requestDigest: 'request-digest-delegation-revoked',
		})).rejects.toThrow(/runtime_authority_denied/);
		expect(await env.db.prepare(`SELECT connection_generation,authority_generation,domain_authority_generation FROM nexora_connections WHERE id='connection-1'`).first()).toEqual(cachedBefore);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_oauth_exchange_attempts`).first()).n)).toBe(0);
	});

	it.each([
		['account deletion', 0, `UPDATE account SET is_del=1 WHERE account_id=42`],
		['Domain Authority revocation', 0, `UPDATE nexora_domain_authorities SET verification_status='revoked',revoked_at=CURRENT_TIMESTAMP,generation=2 WHERE id='domain-1'`],
	])('atomically rejects response sealing after in-flight live %s', async (_label, authorityGeneration, revokeSql) => {
		const runtimeContext = { env: { ...c.env, NEXORA_CONNECTION_RUNTIME_ENABLED: 'true' } };
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const claimed = await exchangeReceipt.claimExchange(runtimeContext, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration, requestDigest: `request-digest-inflight-${_label}`,
		});
		await env.db.prepare(revokeSql).run();
		await expect(exchangeReceipt.sealResult(runtimeContext, scope, claimed.attempt, {
			ok: true, accessToken: 'inflight-access', refreshToken: 'inflight-refresh',
			grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'], idToken: 'inflight-id',
		})).rejects.toThrow();
		expect(await env.db.prepare(`SELECT state,receipt_ciphertext,receipt_digest FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(claimed.attempt.id).first()).toMatchObject({
			state: 'EXCHANGE_IN_PROGRESS',
			receipt_ciphertext: null,
			receipt_digest: null,
		});
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_callback_checkpoints WHERE step='TOKEN_EXCHANGE_RESPONSE_SEALED'`).first()).n)).toBe(0);
		expect(await env.db.prepare(`SELECT callback_receipt_status,exchange_status,recovery_status FROM nexora_oauth_authorization_session_bindings WHERE authorization_session_id='session-1'`).first()).toMatchObject({
			callback_receipt_status: 'NOT_RECEIVED',
			exchange_status: 'EXCHANGE_NOT_STARTED',
			recovery_status: 'NONE',
		});
	});

	it('atomically rejects response sealing after in-flight delegation revocation', async () => {
		const runtimeContext = { env: { ...c.env, NEXORA_CONNECTION_RUNTIME_ENABLED: 'true' } };
		await bindDelegatedAuthority();
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const claimed = await exchangeReceipt.claimExchange(runtimeContext, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 3, requestDigest: 'request-digest-inflight-delegation',
		});
		await env.db.prepare(`UPDATE workspace_account_delegations SET state='revoked',authority_generation=4 WHERE id='delegation-1'`).run();
		await expect(exchangeReceipt.sealResult(runtimeContext, scope, claimed.attempt, {
			ok: true, accessToken: 'inflight-delegated-access', refreshToken: 'inflight-delegated-refresh',
			grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'], idToken: 'inflight-delegated-id',
		})).rejects.toThrow();
		expect(await env.db.prepare(`SELECT state,receipt_ciphertext FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(claimed.attempt.id).first()).toMatchObject({
			state: 'EXCHANGE_IN_PROGRESS',
			receipt_ciphertext: null,
		});
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_callback_checkpoints WHERE step='TOKEN_EXCHANGE_RESPONSE_SEALED'`).first()).n)).toBe(0);
	});

	it('persists an encrypted receipt before recovery and never stores token plaintext', async () => {
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const claimed = await exchangeReceipt.claimExchange(c, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 0, requestDigest: 'request-digest-1',
		});
		expect(claimed.claimed).toBe(true);
		const exchangeResult = { ok: true, accessToken: 'access-token-fixture', refreshToken: 'refresh-token-fixture', expiresAt: '2099-01-01T00:00:00.000Z', grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'], idToken: 'id-token-fixture' };
		const sealed = await exchangeReceipt.sealResult(c, scope, claimed.attempt, exchangeResult);
		expect(sealed.state).toBe('EXCHANGE_SUCCEEDED_COMMIT_PENDING');
		const stored = await env.db.prepare(`SELECT * FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(claimed.attempt.id).first();
		expect(stored.receipt_ciphertext).not.toContain('access-token-fixture');
		expect(stored.receipt_ciphertext).not.toContain('refresh-token-fixture');
		expect(JSON.stringify(stored)).not.toContain('id-token-fixture');
		expect(await exchangeReceipt.openResult(c, scope, stored.id)).toEqual(exchangeResult);
		await expect(exchangeReceipt.openResult(c, { tenantId: TENANT_ID + 1, workspaceId: WORKSPACE_ID }, stored.id)).rejects.toThrow(/receipt_missing/);
	});

	it('rejects stale fencing and tombstones receipt ciphertext after exact-once verification', async () => {
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const claimed = await exchangeReceipt.claimExchange(c, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 0, requestDigest: 'request-digest-2',
		});
		await exchangeReceipt.sealResult(c, scope, claimed.attempt, { ok: true, accessToken: 'a', refreshToken: 'r', grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'], idToken: 'i' });
		await env.db.prepare(`UPDATE nexora_onboarding_callback_claims SET fencing_token=8,lease_owner='worker-2' WHERE id='claim-1'`).run();
		await expect(exchangeReceipt.markState(c, scope, claimed.attempt.id, ['EXCHANGE_SUCCEEDED_COMMIT_PENDING'], 'CREDENTIAL_STORED_CONNECTION_PENDING', { callbackClaim: claim, credentialReferenceId: 'credential-1' })).rejects.toThrow(/state_conflict/);
		const current = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		await exchangeReceipt.markState(c, scope, claimed.attempt.id, ['EXCHANGE_SUCCEEDED_COMMIT_PENDING'], 'CREDENTIAL_STORED_CONNECTION_PENDING', { callbackClaim: current, credentialReferenceId: 'credential-1' });
		await exchangeReceipt.markState(c, scope, claimed.attempt.id, ['CREDENTIAL_STORED_CONNECTION_PENDING'], 'CONNECTION_COMMITTED_VERIFICATION_PENDING', { callbackClaim: current, providerConnectionId: 'provider-connection-1', providerConnectionGeneration: 1 });
		await exchangeReceipt.markState(c, scope, claimed.attempt.id, ['CONNECTION_COMMITTED_VERIFICATION_PENDING'], 'CALLBACK_VERIFIED', { callbackClaim: current });
		const completed = await env.db.prepare(`SELECT state,receipt_ciphertext,credential_reference_id,provider_connection_id FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(claimed.attempt.id).first();
		expect(completed).toMatchObject({ state: 'CALLBACK_VERIFIED', receipt_ciphertext: null, credential_reference_id: 'credential-1', provider_connection_id: 'provider-connection-1' });
		await expect(exchangeReceipt.markState(c, scope, claimed.attempt.id, ['CALLBACK_VERIFIED'], 'RECOVERY_REQUIRED', { callbackClaim: current })).rejects.toThrow(/transition_denied/);
	});

	it('atomically rejects token persistence when live Connection authority changes after exchange preflight', async () => {
		const runtimeContext = { env: { ...c.env, NEXORA_CONNECTION_RUNTIME_ENABLED: 'true' } };
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const claimed = await exchangeReceipt.claimExchange(runtimeContext, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 0, requestDigest: 'request-digest-authority-race',
		});
		await exchangeReceipt.sealResult(runtimeContext, scope, claimed.attempt, {
			ok: true, accessToken: 'authority-race-access', refreshToken: 'authority-race-refresh',
			grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'], idToken: 'authority-race-id',
		});
		const attempt = await env.db.prepare(`SELECT * FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(claimed.attempt.id).first();
		await env.db.prepare(`UPDATE nexora_connections SET authority_generation=1 WHERE id='connection-1'`).run();
		await expect(tokenStorage.storeTokens(runtimeContext, scope, {
			onboardingMissionId: 'mission-1',
			provider: 'google',
			providerAccountHash: 'account-hash-1',
			refreshToken: 'authority-race-refresh',
			accessToken: 'authority-race-access',
			grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
			callbackClaim: claim,
			exchangeAttempt: attempt,
		})).rejects.toThrow(/exchange_atomic_commit_rejected/);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_tokens`).first()).n)).toBe(0);
		expect(await env.db.prepare(`SELECT state FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(attempt.id).first()).toMatchObject({ state: 'EXCHANGE_SUCCEEDED_COMMIT_PENDING' });
	});

	it('atomically rejects token persistence when Domain Authority is revoked after exchange without changing the cached Connection', async () => {
		const runtimeContext = { env: { ...c.env, NEXORA_CONNECTION_RUNTIME_ENABLED: 'true' } };
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const claimed = await exchangeReceipt.claimExchange(runtimeContext, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 0, requestDigest: 'request-digest-domain-race',
		});
		await exchangeReceipt.sealResult(runtimeContext, scope, claimed.attempt, {
			ok: true, accessToken: 'domain-race-access', refreshToken: 'domain-race-refresh',
			grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'], idToken: 'domain-race-id',
		});
		const attempt = await env.db.prepare(`SELECT * FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(claimed.attempt.id).first();
		const cachedBefore = await env.db.prepare(`SELECT connection_generation,authority_generation,domain_authority_generation FROM nexora_connections WHERE id='connection-1'`).first();
		await env.db.prepare(`UPDATE nexora_domain_authorities SET verification_status='revoked',revoked_at=CURRENT_TIMESTAMP,generation=2 WHERE id='domain-1'`).run();
		await expect(tokenStorage.storeTokens(runtimeContext, scope, {
			onboardingMissionId: 'mission-1',
			provider: 'google',
			providerAccountHash: 'account-hash-domain-race',
			refreshToken: 'domain-race-refresh',
			accessToken: 'domain-race-access',
			grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
			callbackClaim: claim,
			exchangeAttempt: attempt,
		})).rejects.toThrow(/exchange_atomic_commit_rejected/);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_tokens`).first()).n)).toBe(0);
		expect(await env.db.prepare(`SELECT connection_generation,authority_generation,domain_authority_generation FROM nexora_connections WHERE id='connection-1'`).first()).toEqual(cachedBefore);
		expect(await env.db.prepare(`SELECT state FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(attempt.id).first()).toMatchObject({ state: 'EXCHANGE_SUCCEEDED_COMMIT_PENDING' });
	});

	it('terminalizes an expired unsealed exchange as ambiguous without replay authority', async () => {
		const claim = await env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id='claim-1'`).first();
		const claimed = await exchangeReceipt.claimExchange(c, scope, {
			authorizationSessionId: 'session-1', correlationId: 'correlation-1', callbackClaim: claim, provider: 'google',
			connectionId: 'connection-1', connectionGeneration: 8, authorityGeneration: 0, requestDigest: 'request-digest-ambiguous',
		});
		await env.db.prepare(`UPDATE nexora_oauth_exchange_attempts SET lease_expires_at=datetime('now','-1 second') WHERE id=?1`).bind(claimed.attempt.id).run();
		const purged = await exchangeReceipt.purgeExpired(c);
		expect(Number(purged.meta?.changes)).toBe(1);
		expect(await env.db.prepare(`SELECT state,receipt_ciphertext,terminal_reason_code FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(claimed.attempt.id).first()).toMatchObject({
			state: 'REAUTHORIZATION_REQUIRED',
			receipt_ciphertext: null,
			terminal_reason_code: 'EXCHANGE_OUTCOME_AMBIGUOUS',
		});
	});
});
