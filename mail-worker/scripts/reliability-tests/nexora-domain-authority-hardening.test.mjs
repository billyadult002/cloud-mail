import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import ownership from '../../src/service/nexora-domain-ownership-service.mjs';
import authority from '../../src/service/nexora-domain-authority-bootstrap-service.mjs';

const actor = { userId: 7001, authSessionRef: 'session:test' };
const scope = { tenantId: 7001, workspaceId: 7101 };
const domain = 'example-corporate.test';
const tables = ['nexora_domain_ownership_verification_events','nexora_domain_ownership_challenges','nexora_domain_authorities','workspace_domains','workspace_audit_events','nexora_audit_events','workspace_members','workspaces','cloudmail_domains','workspace_account_bindings','account','email'];
const schema = [
	`CREATE TABLE workspaces(id INTEGER PRIMARY KEY,tenant_key TEXT,display_name TEXT,created_by_user_id INTEGER)`,
	`CREATE TABLE workspace_members(workspace_id INTEGER,user_id INTEGER,role TEXT,PRIMARY KEY(workspace_id,user_id))`,
	`CREATE TABLE workspace_domains(id INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id INTEGER NOT NULL,domain TEXT NOT NULL UNIQUE,provider TEXT,authority_state TEXT,lifecycle_state TEXT,health_state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TRIGGER workspace_domain_owner_immutable BEFORE UPDATE OF workspace_id ON workspace_domains WHEN OLD.workspace_id != NEW.workspace_id BEGIN SELECT RAISE(ABORT,'domain ownership owner is immutable'); END`,
	`CREATE TABLE nexora_domain_ownership_challenges(id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,normalized_domain TEXT,challenge_name TEXT,challenge_token_hash TEXT,hmac_key_version TEXT NOT NULL,verification_method TEXT DEFAULT 'DNS_TXT',verification_status TEXT,verification_evidence_ref TEXT,administrator_authority_ref TEXT,idempotency_key TEXT,attempt INTEGER DEFAULT 0,generation INTEGER DEFAULT 1,expires_at TEXT,verified_at TEXT,consumed_at TEXT,superseded_at TEXT,verification_operation_id TEXT UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(tenant_id,workspace_id,normalized_domain,idempotency_key))`,
	`CREATE TABLE nexora_domain_ownership_verification_events(id TEXT PRIMARY KEY,challenge_id TEXT NOT NULL,tenant_id INTEGER,workspace_id INTEGER,normalized_domain TEXT,generation INTEGER,verification_operation_id TEXT UNIQUE,authority_id TEXT,authority_generation INTEGER,verification_evidence_ref TEXT,actor_user_id INTEGER,auth_session_ref TEXT,hmac_key_version TEXT,request_id TEXT,runtime_deployment_id TEXT,acceptance_correlation_ref TEXT,result TEXT,observed_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_domain_authorities(id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,normalized_domain TEXT,verification_status TEXT,verification_method TEXT,verification_evidence_ref TEXT,administrator_authority_ref TEXT,generation INTEGER DEFAULT 1,revoked_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(tenant_id,workspace_id,normalized_domain))`,
	`CREATE TABLE nexora_audit_events(user_id INTEGER,domain TEXT,action TEXT,object_type TEXT,object_ref TEXT,outcome TEXT,metadata_json TEXT)`,
	`CREATE TABLE workspace_audit_events(workspace_id INTEGER,actor_user_id INTEGER,action TEXT,object_type TEXT,object_ref TEXT,before_state_json TEXT,after_state_json TEXT,request_id TEXT)`,
	`CREATE TABLE cloudmail_domains(id INTEGER,domain TEXT,provisioning_state TEXT,zone_status TEXT,linkage_state TEXT,created_at TEXT,updated_at TEXT)`,
	`CREATE TABLE workspace_account_bindings(workspace_id INTEGER,account_id INTEGER)`,
	`CREATE TABLE account(account_id INTEGER,user_id INTEGER,is_del INTEGER,domain TEXT,email TEXT,provider TEXT,sync_status TEXT,last_successful_sync_at TEXT,last_message_received_at TEXT,create_time TEXT)`,
	`CREATE TABLE email(account_id INTEGER,user_id INTEGER,is_del INTEGER,account_domain TEXT,account_email TEXT,create_time TEXT)`,
];

async function reset() {
	for (const table of tables) await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	for (const sql of schema) await env.db.prepare(sql).run();
	await env.db.prepare(`INSERT INTO workspaces VALUES(?1,?2,'Workspace',?3)`).bind(scope.workspaceId, `user:${actor.userId}`, actor.userId).run();
	await env.db.prepare(`INSERT INTO workspace_members VALUES(?1,?2,'OWNER')`).bind(scope.workspaceId, actor.userId).run();
}

const c = { env: { ...env, NEXORA_CORRELATION_HASH_SECRET: 'test-only-domain-authority-secret-32-bytes', NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-v1', CF_VERSION_METADATA: { id: 'worker-test-version' } }, req: { header: (name) => ({ authorization: 'Bearer test-token', 'cf-ray': 'ray-test' })[name.toLowerCase()] || null } };
const dns = (token) => async () => ({ ok: true, json: async () => ({ Answer: [{ data: `"nexora-domain-verification=${token}"` }] }) });

describe('NEXORA domain ownership and authority P0 hardening', () => {
	beforeEach(reset);

	it('makes challenge idempotency immutable and supersedes old pending generations', async () => {
		const first = await ownership.createDnsChallenge(c, scope, { domain, idempotencyKey: 'create-1' }, actor);
		await expect(ownership.createDnsChallenge(c, scope, { domain, idempotencyKey: 'create-1' }, actor)).rejects.toThrow('already been used');
		const second = await ownership.createDnsChallenge(c, scope, { domain, idempotencyKey: 'create-2' }, actor);
		expect(second.challenge.generation).toBe(2);
		const prior = await env.db.prepare(`SELECT superseded_at,challenge_token_hash FROM nexora_domain_ownership_challenges WHERE id=?1`).bind(first.challenge.id).first();
		expect(prior.superseded_at).not.toBeNull();
	});

	it('requires the exact challenge and generation and consumes it once with evidence', async () => {
		const created = await ownership.createDnsChallenge(c, scope, { domain, idempotencyKey: 'create' }, actor);
		const token = created.dnsRecord.value.split('=')[1];
		await expect(ownership.verifyDnsChallenge(c, scope, { domain, challengeId: created.challenge.id, expectedGeneration: 9, idempotencyKey: 'verify-wrong' }, actor, dns(token))).rejects.toThrow('pending domain ownership challenge');
		const verified = await ownership.verifyDnsChallenge(c, scope, { domain, challengeId: created.challenge.id, expectedGeneration: 1, idempotencyKey: 'verify-1' }, actor, dns(token));
		expect(verified.workspaceDomain.workspace_id).toBe(scope.workspaceId);
		expect((await env.db.prepare(`SELECT consumed_at FROM nexora_domain_ownership_challenges WHERE id=?1`).bind(created.challenge.id).first()).consumed_at).not.toBeNull();
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_domain_ownership_verification_events`).first()).n).toBe(1);
		const event = await env.db.prepare(`SELECT auth_session_ref,request_id,runtime_deployment_id,acceptance_correlation_ref,observed_at FROM nexora_domain_ownership_verification_events`).first();
		expect(event.auth_session_ref).not.toContain('test-token');
		expect(event.request_id).toBe('ray-test');
		expect(event.runtime_deployment_id).toBe('worker-test-version');
		expect(event.acceptance_correlation_ref).toBeTruthy();
		expect(event.observed_at).toBeTruthy();
		await expect(ownership.verifyDnsChallenge(c, scope, { domain, challengeId: created.challenge.id, expectedGeneration: 1, idempotencyKey: 'verify-2' }, actor, dns(token))).rejects.toThrow('pending domain ownership challenge');
	});

	it('rejects body-forged server correlation fields', async () => {
		const created = await ownership.createDnsChallenge(c, scope, { domain, idempotencyKey: 'create' }, actor);
		const token = created.dnsRecord.value.split('=')[1];
		await expect(ownership.verifyDnsChallenge(c, scope, { domain, challengeId: created.challenge.id, expectedGeneration: 1, idempotencyKey: 'verify', acceptanceCorrelationRef: 'forged' }, actor, dns(token))).rejects.toThrow('derived exclusively');
	});

	it('fails closed when the challenge HMAC key version rotates and performs no ownership write', async () => {
		const created = await ownership.createDnsChallenge(c, scope, { domain, idempotencyKey: 'create-rotation' }, actor);
		const token = created.dnsRecord.value.split('=')[1];
		const rotated = { ...c, env: { ...c.env, NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-v2' } };
		await expect(ownership.verifyDnsChallenge(rotated, scope, { domain, challengeId: created.challenge.id, expectedGeneration: 1, idempotencyKey: 'verify-rotation' }, actor, dns(token))).rejects.toThrow('HMAC key version continuity denied');
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM workspace_domains`).first()).n).toBe(0);
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_domain_ownership_verification_events`).first()).n).toBe(0);
	});

	it('atomically rolls back the concurrent cross-workspace loser after both pre-read no owner', async () => {
		const otherScope = { tenantId: scope.tenantId, workspaceId: 7102 };
		await env.db.prepare(`INSERT INTO workspaces VALUES(?1,?2,'Other',?3)`).bind(otherScope.workspaceId, `user:${actor.userId}`, actor.userId).run();
		await env.db.prepare(`INSERT INTO workspace_members VALUES(?1,?2,'OWNER')`).bind(otherScope.workspaceId, actor.userId).run();
		const first = await ownership.createDnsChallenge(c, scope, { domain, idempotencyKey: 'create-a' }, actor);
		const second = await ownership.createDnsChallenge(c, otherScope, { domain, idempotencyKey: 'create-b' }, actor);
		const answers = [first.dnsRecord.value, second.dnsRecord.value];
		let arrivals = 0;
		let release;
		const barrier = new Promise((resolve) => { release = resolve; });
		const fetchImpl = async () => {
			arrivals += 1;
			if (arrivals === 2) release();
			await barrier;
			return { ok: true, json: async () => ({ Answer: answers.map((value) => ({ data: `"${value}"` })) }) };
		};
		const outcomes = await Promise.allSettled([
			ownership.verifyDnsChallenge(c, scope, { domain, challengeId: first.challenge.id, expectedGeneration: 1, idempotencyKey: 'verify-a' }, actor, fetchImpl),
			ownership.verifyDnsChallenge(c, otherScope, { domain, challengeId: second.challenge.id, expectedGeneration: 1, idempotencyKey: 'verify-b' }, actor, fetchImpl),
		]);
		expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_domain_ownership_verification_events`).first()).n).toBe(1);
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_audit_events WHERE action='NEXORA_DOMAIN_OWNERSHIP_VERIFIED'`).first()).n).toBe(1);
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM workspace_audit_events WHERE action='NEXORA_DOMAIN_OWNERSHIP_VERIFIED'`).first()).n).toBe(1);
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_domain_ownership_challenges WHERE verification_status='pending'`).first()).n).toBe(1);
	});

	it('rolls back verification when a different workspace owns the domain', async () => {
		await env.db.prepare(`INSERT INTO workspace_domains(workspace_id,domain,provider,authority_state,lifecycle_state,health_state) VALUES(9999,?1,'dns_txt','VERIFIED','READY','READY')`).bind(domain).run();
		const created = await ownership.createDnsChallenge(c, scope, { domain, idempotencyKey: 'create' }, actor);
		const token = created.dnsRecord.value.split('=')[1];
		await expect(ownership.verifyDnsChallenge(c, scope, { domain, challengeId: created.challenge.id, expectedGeneration: 1, idempotencyKey: 'verify' }, actor, dns(token))).rejects.toThrow('already bound');
		const row = await env.db.prepare(`SELECT verification_status,consumed_at FROM nexora_domain_ownership_challenges WHERE id=?1`).bind(created.challenge.id).first();
		expect(row.verification_status).toBe('pending');
		expect(row.consumed_at).toBeNull();
	});

	it('derives bootstrap evidence server-side and atomically revokes with generation fencing', async () => {
		await env.db.prepare(`INSERT INTO workspace_domains(workspace_id,domain,provider,authority_state,lifecycle_state,health_state) VALUES(?1,?2,'dns_txt','VERIFIED','READY','READY')`).bind(scope.workspaceId, domain).run();
		await env.db.prepare(`INSERT INTO nexora_domain_ownership_verification_events(id,challenge_id,tenant_id,workspace_id,normalized_domain,generation,verification_operation_id,verification_evidence_ref,actor_user_id,result,observed_at) VALUES('ownership-event','challenge',?1,?2,?3,1,'verify','ownership-evidence',?1,'VERIFIED',CURRENT_TIMESTAMP)`).bind(scope.tenantId, scope.workspaceId, domain).run();
		await expect(authority.bootstrapVerifiedDomainAuthority(c, scope, { domain, idempotencyKey: 'bootstrap', verificationEvidenceRef: 'forged' }, actor)).rejects.toThrow('derived exclusively');
		const bootstrapped = await authority.bootstrapVerifiedDomainAuthority(c, scope, { domain, idempotencyKey: 'bootstrap' }, actor);
		expect(bootstrapped.authority.verification_evidence_ref).not.toBe('forged');
		await expect(authority.revokeDomainAuthority(c, scope, { domain, expectedGeneration: 9, idempotencyKey: 'revoke-wrong' }, actor)).rejects.toThrow('generation conflict');
		const revoked = await authority.revokeDomainAuthority(c, scope, { domain, expectedGeneration: 1, idempotencyKey: 'revoke-1' }, actor);
		expect(revoked.authority.verification_status).toBe('revoked');
		expect(revoked.authority.generation).toBe(2);
		await expect(authority.bootstrapVerifiedDomainAuthority(c, scope, { domain, idempotencyKey: 'bootstrap-2' }, actor)).rejects.toThrow('requires explicit re-verification');
	});

	it('allows only one same-generation revocation operation to write state and audits', async () => {
		await env.db.prepare(`INSERT INTO workspace_domains(workspace_id,domain,provider,authority_state,lifecycle_state,health_state) VALUES(?1,?2,'dns_txt','VERIFIED','READY','READY')`).bind(scope.workspaceId, domain).run();
		await env.db.prepare(`INSERT INTO nexora_domain_ownership_verification_events(id,challenge_id,tenant_id,workspace_id,normalized_domain,generation,verification_operation_id,verification_evidence_ref,actor_user_id,result,observed_at) VALUES('ownership-event','challenge',?1,?2,?3,1,'verify','ownership-evidence',?1,'VERIFIED',CURRENT_TIMESTAMP)`).bind(scope.tenantId, scope.workspaceId, domain).run();
		await authority.bootstrapVerifiedDomainAuthority(c, scope, { domain, idempotencyKey: 'bootstrap' }, actor);
		const outcomes = await Promise.allSettled([
			authority.revokeDomainAuthority(c, scope, { domain, expectedGeneration: 1, idempotencyKey: 'revoke-a' }, actor),
			authority.revokeDomainAuthority(c, scope, { domain, expectedGeneration: 1, idempotencyKey: 'revoke-b' }, actor),
		]);
		expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_audit_events WHERE action='NEXORA_DOMAIN_AUTHORITY_REVOKED'`).first()).n).toBe(1);
		expect((await env.db.prepare(`SELECT COUNT(*) n FROM workspace_audit_events WHERE action='NEXORA_DOMAIN_AUTHORITY_REVOKED'`).first()).n).toBe(1);
	});
});
