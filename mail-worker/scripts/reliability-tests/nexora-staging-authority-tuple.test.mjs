import { describe, expect, it } from 'vitest';
import app from '../../src/hono/webs.js';
import { normalizeDomain, stableDigest } from '../../src/service/nexora-staging-authority-tuple-service.js';
import { BROKERED_DELEGATION_SCOPES, DELEGATION_SCOPES, evaluateRuntimeAuthority } from '../../src/service/enterprise-authority-service.js';
import enterpriseAuthorityService from '../../src/service/enterprise-authority-service.js';
import stagingAuthorityTupleService from '../../src/service/nexora-staging-authority-tuple-service.js';

const authoritySecret = 'test-only-authority-secret-at-least-32-bytes';
const verifierSecret = 'different-test-only-verifier-secret-at-least-32-bytes';
function requestContext(env, db, headers = {}) {
	return {
		env: { CLOUDFLARE_EMAIL_WORKER: 'cloud-mail-staging', ...env, db },
		req: {
			url: 'https://staging.example/init/authority-tuple/prepare',
			header: (name) => headers[name.toLowerCase()] || null,
		},
	};
}

describe('staging authority tuple boundary', () => {
	it('normalizes only non-public verified-domain candidates', () => {
		expect(normalizeDomain('Authority-Staging.Example.Test.')).toBe('authority-staging.example.test');
		expect(() => normalizeDomain('gmail.com')).toThrow('STAGING_AUTHORITY_PUBLIC_DOMAIN_DENIED');
		expect(() => normalizeDomain('not-a-domain')).toThrow('STAGING_AUTHORITY_DOMAIN_INVALID');
	});

	it('uses stable tuple digests and exposes only minimum mail_read delegation', async () => {
		expect(await stableDigest({ b: 2, a: 1 })).toBe(await stableDigest({ a: 1, b: 2 }));
		expect(DELEGATION_SCOPES.has('mail_read')).toBe(false);
		expect(BROKERED_DELEGATION_SCOPES.has('mail_read')).toBe(true);
		for (const denied of ['send_email', 'delete_email', 'watch_mailbox', 'get_delta', 'refresh', 'draft_reply', '*']) {
			expect(BROKERED_DELEGATION_SCOPES.has(denied)).toBe(false);
		}
	});

	it('never applies the account-owner shortcut to brokered mail_read lifecycle checks', () => {
		const base = {
			membership: { state: 'active', expires_at: '2099-01-01T00:00:00Z' },
			ownerUserId: 1, actingUserId: 1, capability: 'mail_read', requireDelegation: true,
			delegation: { id: 'd1', state: 'active', owner_consent_at: '2026-01-01', approved_at: '2026-01-01', expires_at: '2099-01-01T00:00:00Z', scope_json: '["mail_read"]', authority_generation: 1 },
		};
		expect(evaluateRuntimeAuthority(base)).toMatchObject({ allowed: true, reason: 'active_delegation' });
		expect(evaluateRuntimeAuthority({ ...base, membership: { ...base.membership, state: 'suspended' } })).toMatchObject({ allowed: false });
		expect(evaluateRuntimeAuthority({ ...base, delegation: { ...base.delegation, state: 'revoked' } })).toMatchObject({ allowed: false });
	});

	it('is staging-disabled by default and does not reflect supplied material', async () => {
		const marker = 'must-not-be-reflected';
		const response = await app.request('/init/authority-tuple/prepare', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ authority_secret: marker, domain: 'authority-staging.example.test' }),
		}, { CLOUDFLARE_EMAIL_WORKER: 'cloud-mail-staging', NEXORA_STAGING_AUTHORITY_TUPLE_ENABLED: 'false' });
		expect(response.status).toBe(403);
		expect(await response.text()).not.toContain(marker);
	});

	it('denies cross-site submission before secret comparison', async () => {
		const response = await app.request('/init/authority-tuple/prepare', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
			body: JSON.stringify({ authority_secret: 'test-only-authority-secret-at-least-32-bytes', domain: 'authority-staging.example.test' }),
		}, {
			CLOUDFLARE_EMAIL_WORKER: 'cloud-mail-staging',
			NEXORA_STAGING_AUTHORITY_TUPLE_ENABLED: 'true',
			NEXORA_STAGING_AUTHORITY_TUPLE_SECRET: 'test-only-authority-secret-at-least-32-bytes',
		});
		expect(response.status).toBe(403);
	});

	it('prepare persists only the expiring challenge operation before DNS', async () => {
		const statements = [];
		let reads = 0;
		const preparedRow = {
			operation_id: 'nexora-staging-authority-tuple-v1',
			request_digest: await stableDigest({ contract: 'nexora-staging-authority-tuple-v1', domain: 'authority-staging.example.test', capability: 'mail_read' }),
			state: 'DNS_CHALLENGE_READY',
			normalized_domain: 'authority-staging.example.test',
			worker_version: 'worker-v1',
		};
		const db = {
			prepare(sql) {
				statements.push(sql);
				return {
					bind() { return this; },
					async first() { reads += 1; return reads === 1 ? null : preparedRow; },
				};
			},
			async batch() { return []; },
		};
		const outcome = await stagingAuthorityTupleService.prepare(requestContext({
			NEXORA_STAGING_AUTHORITY_TUPLE_ENABLED: 'true',
			NEXORA_STAGING_AUTHORITY_TUPLE_SECRET: authoritySecret,
			NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-hmac-v1',
			NEXORA_CORRELATION_HASH_SECRET: 'test-only-correlation-secret-at-least-32-bytes',
			CF_VERSION_METADATA: { id: 'worker-v1' },
		}, db), { authority_secret: authoritySecret, domain: 'authority-staging.example.test' });
		expect(outcome.status).toBe(200);
		expect(statements.join('\n')).not.toMatch(/INSERT INTO (user|tenants|workspaces|workspace_members|account)\b/i);
		expect(outcome.body.dnsChallenge.value).toMatch(/^nexora-domain-verification=/);
		expect(JSON.stringify(outcome.body)).not.toContain(authoritySecret);
	});

	it('rejects an expired challenge before DNS or authority writes', async () => {
		let dnsCalled = false;
		const row = { operation_id: 'op', state: 'DNS_CHALLENGE_READY', normalized_domain: 'authority-staging.example.test', challenge_expires_at: '2000-01-01T00:00:00.000Z' };
		const db = { prepare: () => ({ first: async () => row }) };
		const outcome = await stagingAuthorityTupleService.finalize(requestContext({
			NEXORA_STAGING_AUTHORITY_TUPLE_ENABLED: 'true',
			NEXORA_STAGING_AUTHORITY_TUPLE_SECRET: authoritySecret,
		}, db), { authority_secret: authoritySecret }, async () => { dnsCalled = true; });
		expect(outcome).toMatchObject({ status: 409, body: { error: 'STAGING_AUTHORITY_DOMAIN_CHALLENGE_EXPIRED' } });
		expect(dnsCalled).toBe(false);
	});

	it('uses a separately scoped verifier secret and never reads the OAuth client Secret', async () => {
		let secretRead = false;
		const c = requestContext({
			NEXORA_STAGING_AUTHORITY_VERIFIER_ENABLED: 'true',
			NEXORA_STAGING_AUTHORITY_VERIFIER_SECRET: verifierSecret,
			NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'client-id-sensitive-value',
			NEXORA_GOOGLE_OAUTH_REDIRECT_URI: 'https://cloud-mail-staging.fastonegroup.workers.dev/v3/onboarding/providers/google/callback',
		}, {});
		Object.defineProperty(c.env, 'NEXORA_GOOGLE_OAUTH_CLIENT_SECRET', {
			get() { secretRead = true; throw new Error('secret_must_not_be_read'); },
		});
		expect((await stagingAuthorityTupleService.oauthProvenance(c, { verifier_secret: authoritySecret })).status).toBe(401);
		const outcome = await stagingAuthorityTupleService.oauthProvenance(c, { verifier_secret: verifierSecret });
		expect(outcome.status).toBe(200);
		const serialized = JSON.stringify(outcome.body);
		expect(serialized).not.toContain('client-id-sensitive-value');
		expect(secretRead).toBe(false);
		expect(outcome.body).toMatchObject({ secretBinding: 'NOT_INSPECTED_IN_RUNTIME', secretBindingInventoryRequired: true });
	});

	it('fails independent verification when ceremony tuple or evidence integrity is tampered', async () => {
		const row = {
			operation_id: 'nexora-staging-authority-tuple-v1', state: 'TUPLE_CREATED',
			user_id: 1, tenant_id: 1, workspace_id: 1, account_id: 1,
			membership_authority_id: 'membership-1', domain_authority_id: 'domain-1',
			delegation_authority_id: 'delegation-1', normalized_domain: 'authority-staging.example.test',
			authority_tuple_digest: '0'.repeat(64), evidence_id: 'evidence-1',
		};
		const db = {
			prepare(sql) {
				return {
					bind() { return this; },
					async first() {
						if (sql.includes('SELECT * FROM nexora_staging_authority_tuple_operations')) return row;
						if (sql.includes('SELECT reference_hash')) return { reference_hash: row.authority_tuple_digest, summary_json: '{}', integrity_hash: '0'.repeat(64) };
						return Object.fromEntries([
							'users','organizations','tenants','org_memberships','workspaces','memberships',
							'membership_authorities','domain_authorities','accounts','account_bindings','workspace_domains',
							'domain_challenges','domain_events','delegations','audit_events','workspace_audit_events',
						].map(key => [key, 1]).concat([
							['oauth_sessions', 0], ['credential_refs', 0], ['provider_connections', 0], ['connections', 0],
						]));
					},
				};
			},
		};
		const outcome = await stagingAuthorityTupleService.verify(requestContext({
			NEXORA_STAGING_AUTHORITY_VERIFIER_ENABLED: 'true',
			NEXORA_STAGING_AUTHORITY_VERIFIER_SECRET: verifierSecret,
		}, db), { verifier_secret: verifierSecret });
		expect(outcome).toMatchObject({ status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_INDEPENDENT_VERIFICATION_FAILED' } });
	});

	it('keeps finalize fail-closed when the atomic D1 batch rejects', async () => {
		const token = 'a'.repeat(64);
		const challengeHash = await (async () => {
			const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-only-correlation-secret-at-least-32-bytes'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
			const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`nexora-correlation-hmac-v1\ntest-hmac-v1\ndns-txt-token\n${token}`));
			return [...new Uint8Array(mac)].map(byte => byte.toString(16).padStart(2, '0')).join('');
		})();
		const row = {
			operation_id: 'nexora-staging-authority-tuple-v1', request_digest: 'b'.repeat(64),
			state: 'DNS_CHALLENGE_READY', normalized_domain: 'authority-staging.example.test',
			domain_challenge_id: 'challenge-1', domain_challenge_token_hash: challengeHash,
			challenge_expires_at: '2099-01-01T00:00:00.000Z', worker_version: 'worker-v1',
		};
		const db = {
			prepare() { return { bind() { return this; }, first: async () => row }; },
			async batch() { throw new Error('simulated_atomic_batch_abort'); },
		};
		const dnsFetch = async () => new Response(JSON.stringify({ Answer: [{ data: `\"nexora-domain-verification=${token}\"` }] }), { status: 200 });
		const outcome = await stagingAuthorityTupleService.finalize(requestContext({
			NEXORA_STAGING_AUTHORITY_TUPLE_ENABLED: 'true',
			NEXORA_STAGING_AUTHORITY_TUPLE_SECRET: authoritySecret,
			NEXORA_CORRELATION_HASH_SECRET: 'test-only-correlation-secret-at-least-32-bytes',
			NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-hmac-v1',
		}, db), { authority_secret: authoritySecret }, dnsFetch);
		expect(outcome).toMatchObject({ status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_FINALIZE_FAILED' } });
		expect(row.state).toBe('DNS_CHALLENGE_READY');
	});

	it('enforces the brokered membership/domain binding even for account-owner mail_read', async () => {
		const values = [
			{ tenant_key: 'tenant-1' },
			{ user_id: 1, normalized_domain: 'authority-staging.example.test' },
			{ one: 1 }, { one: 1 },
			{ role: 'OWNER' },
			{ id: 'delegation-1', owner_user_id: 1, subject_user_id: 1, state: 'active', scope_json: '["mail_read"]', owner_consent_at: '2026-01-01', approved_at: '2026-01-01', expires_at: '2099-01-01T00:00:00Z', authority_generation: 1 },
			{ id: 'membership-1', state: 'active', authority_generation: 1, expires_at: '2099-01-01T00:00:00Z' },
			null,
		];
		const db = { prepare: () => ({ bind() { return this; }, first: async () => values.shift() }) };
		const denied = await enterpriseAuthorityService.resolveAccountAuthority({ env: { db } }, { workspaceId: 1, actingUserId: 1, accountId: 1, capability: 'mail_read' });
		expect(denied).toMatchObject({ allowed: false, reason: 'brokered_authority_binding_invalid' });
		expect(values).toHaveLength(0);
	});
});
