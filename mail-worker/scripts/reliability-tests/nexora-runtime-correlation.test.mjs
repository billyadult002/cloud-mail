import { describe, expect, it } from 'vitest';
import correlationService, {
	deriveActorScope,
	normalizeBuild,
	redactAcceptanceRow
} from '../../src/service/nexora-runtime-correlation-service.mjs';
import { deriveSessionRef } from '../../src/service/nexora-session-ref-service.mjs';

const ARTIFACT_DIGEST = 'a'.repeat(64);
const SOURCE_COMMIT = 'b'.repeat(40);
const BUILD_IDENTITY = {
	artifactDigest: ARTIFACT_DIGEST,
	sourceCommit: SOURCE_COMMIT,
	signingIdentity: 'developer-id:nexora',
	signingKeyVersion: 'key-v1'
};
const BUILD_POLICY = {
	...BUILD_IDENTITY,
	validFrom: '2026-01-01T00:00:00.000Z',
	validUntil: '2999-01-01T00:00:00.000Z',
	revoked: false,
	policyVersion: 'policy-v1'
};

function statement(sql, handlers, calls) {
	return {
		bindings: [],
		bind(...bindings) {
			this.bindings = bindings;
			calls.push({ sql, bindings });
			return this;
		},
		async first() { return handlers.first?.(sql, this.bindings) ?? null; },
		async all() { return handlers.all?.(sql, this.bindings) ?? { results: [] }; },
		async run() { return handlers.run?.(sql, this.bindings) ?? { meta: { changes: 1 } }; },
	};
}

function context({ actorId = 7, handlers = {}, env = {} } = {}) {
	const calls = [];
	return {
		calls,
		c: {
			env: {
				db: {
					prepare(sql) { return statement(sql, handlers, calls); },
					async batch(statements) {
						return handlers.batch?.(statements, calls) ?? statements.map(() => ({ meta: { changes: 1 } }));
					}
				},
				CF_VERSION_METADATA: { id: 'worker-version-7337' },
				NEXORA_ACCEPTANCE_BUILDS_JSON: JSON.stringify([
					{ platform: 'DESKTOP', buildId: 'mac-357', buildVersion: '1.2.0', ...BUILD_POLICY },
					{ platform: 'IOS_PHYSICAL', buildId: 'ios-357', buildVersion: '1.2.0', ...BUILD_POLICY }
				]),
				NEXORA_CORRELATION_HASH_SECRET: 'test-only-runtime-correlation-secret-32-bytes',
				NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-v1',
				...env
			},
			get(key) { return key === 'user' ? { userId: actorId, email: 'member@example.test' } : null; },
			req: { header(name) { return name.toLowerCase() === 'authorization' ? 'Bearer private-token' : name.toLowerCase() === 'cf-ray' ? 'ray-123' : null; } }
		}
	};
}

describe('NEXORA runtime correlation authority', () => {
	it('derives tenant exclusively from the authenticated actor and rejects forged tenant', () => {
		expect(deriveActorScope({ userId: 7 }, {})).toEqual({ tenantId: 7 });
		expect(() => deriveActorScope({ userId: 7 }, { tenantId: 8 })).toThrow(/tenant scope/);
		expect(() => deriveActorScope({ userId: 7 }, { workspaceId: 9 })).toThrow(/server-derived/);
	});

	it('accepts only allowlisted platform/build tuples', () => {
		const env = { NEXORA_ACCEPTANCE_BUILDS_JSON: JSON.stringify([{ platform: 'IOS_PHYSICAL', buildId: '357', buildVersion: '1.0', ...BUILD_POLICY }]) };
		expect(normalizeBuild(env, { platform: 'IOS_PHYSICAL', buildId: '357', buildVersion: '1.0', sourceCommit: SOURCE_COMMIT }).buildId).toBe('357');
		expect(() => normalizeBuild(env, { platform: 'IOS_PHYSICAL', buildId: '357', buildVersion: '1.0', artifactDigest: ARTIFACT_DIGEST })).toThrow(/server-derived/);
		expect(() => normalizeBuild(env, { platform: 'IOS_SIMULATOR', buildId: '357', buildVersion: '1.0' })).toThrow(/platform/);
		expect(() => normalizeBuild(env, { platform: 'IOS_PHYSICAL', buildId: 'forged', buildVersion: '1.0' })).toThrow(/allowlisted/);
	});

	it('creates a short-lived server-authoritative session without persisting the raw challenge or token', async () => {
		const { c, calls } = context({ handlers: {
			all(sql) {
				if (sql.includes('workspace_account_bindings')) return { results: [{ account_id: 44, workspace_id: 9, role: 'member' }] };
				return { results: [] };
			}
		} });
		const result = await correlationService.createSession(c, { accountId: 44, platform: 'DESKTOP', buildId: 'mac-357', buildVersion: '1.2.0', idempotencyKey: 'create-1', sourceCommit: SOURCE_COMMIT });
		expect(result.challenge).toBeTruthy();
		expect(result.status).toBe('ISSUED');
		const serialized = JSON.stringify(calls);
		expect(serialized).not.toContain(result.challenge);
		expect(serialized).not.toContain('private-token');
		expect(serialized).not.toContain('member@example.test');
		expect(serialized).toContain('worker-version-7337');
	});

	it('fails closed when an account is not server-bound to actor and workspace', async () => {
		const { c } = context();
		await expect(correlationService.createSession(c, { accountId: 999, platform: 'DESKTOP', buildId: 'mac-357', buildVersion: '1.2.0' })).rejects.toThrow(/account authority/);
	});

	it('fails closed when the server finds ambiguous workspace bindings', async () => {
		const { c } = context({ handlers: { all() { return { results: [
			{ account_id: 44, workspace_id: 9, role: 'member' },
			{ account_id: 44, workspace_id: 10, role: 'member' }
		] }; } } });
		await expect(correlationService.createSession(c, { accountId: 44, platform: 'DESKTOP', buildId: 'mac-357', buildVersion: '1.2.0' })).rejects.toThrow(/ambiguous/);
	});

	it('rejects a client-supplied workspace even when it matches a real binding', async () => {
		const { c, calls } = context({ handlers: { all() { return { results: [{ account_id: 44, workspace_id: 9, role: 'member' }] }; } } });
		await expect(correlationService.createSession(c, { workspaceId: 9, accountId: 44, platform: 'DESKTOP', buildId: 'mac-357', buildVersion: '1.2.0' })).rejects.toThrow(/server-derived/);
		expect(calls).toHaveLength(0);
	});

	it('rejects a client-supplied actor before any database access', async () => {
		const { c, calls } = context();
		await expect(correlationService.createSession(c, {
			actorUserId: 7,
			accountId: 44,
			platform: 'DESKTOP',
			buildId: 'mac-357',
			buildVersion: '1.2.0'
		})).rejects.toThrow(/actor identity is server-derived/);
		expect(calls).toHaveLength(0);
	});

	it('rejects consume when the current authorization is not the session authorization', async () => {
		const { c } = context({ handlers: { first(sql) {
			if (sql.includes('nexora_runtime_acceptance_sessions')) return {
				id: 's1', tenant_id: 7, workspace_id: 9, actor_user_id: 7, canonical_account_id: 44,
				platform: 'IOS_PHYSICAL', build_id: 'ios-357', build_version: '1.2.0', ...BUILD_IDENTITY,
				artifact_digest: ARTIFACT_DIGEST, source_commit: SOURCE_COMMIT, signing_identity: BUILD_IDENTITY.signingIdentity,
				signing_key_version: BUILD_IDENTITY.signingKeyVersion, runtime_deployment_id: 'worker-version-7337',
				allowlist_policy_version: 'policy-v1',
				hmac_key_version: 'test-v1',
				auth_session_ref: 'different-token-hash', challenge_hash: 'hash', status: 'ISSUED', expires_at: '2999-01-01T00:00:00.000Z'
			};
			return null;
		} } });
		await expect(correlationService.consumeSession(c, { sessionId: 's1', challenge: 'challenge', classificationId: 'class-1' })).rejects.toThrow(/auth session continuity/);
	});

	it('rejects a classification that lacks the exact acceptance-session run lineage', async () => {
		const { c, calls } = context();
		const challengeHash = await correlationService.hashSecret(c.env, 'challenge');
		const authSessionRef = await deriveSessionRef(c.env, 'Bearer private-token');
		c.env.db.prepare = (sql) => statement(sql, { first(query) {
			if (query.includes('nexora_runtime_acceptance_sessions')) return {
				id: 's1', tenant_id: 7, workspace_id: 9, actor_user_id: 7, canonical_account_id: 44,
				platform: 'IOS_PHYSICAL', build_id: 'ios-357', build_version: '1.2.0',
				artifact_digest: ARTIFACT_DIGEST, source_commit: SOURCE_COMMIT,
				signing_identity: BUILD_IDENTITY.signingIdentity, signing_key_version: BUILD_IDENTITY.signingKeyVersion,
				allowlist_policy_version: 'policy-v1',
				hmac_key_version: 'test-v1',
				runtime_deployment_id: 'worker-version-7337', auth_session_ref: authSessionRef,
				challenge_hash: challengeHash, status: 'ISSUED', expires_at: '2999-01-01T00:00:00.000Z'
			};
			return null;
		} }, calls);
		await expect(correlationService.consumeSession(c, { sessionId: 's1', challenge: 'challenge', classificationId: 'class-from-other-session' })).rejects.toThrow(/lineage denied/);
		expect(calls.some(({ sql }) => sql.includes('UPDATE nexora_runtime_acceptance_sessions'))).toBe(false);
	});

	it('returns a privacy-safe read model', () => {
		const row = redactAcceptanceRow({ id: 's1', tenant_id: 7, workspace_id: 9, actor_user_id: 7, account_id: 44, platform: 'DESKTOP', build_id: '357', build_version: '1', runtime_release_id: 'release', status: 'CONSUMED', issued_at: 'a', expires_at: 'b', consumed_at: 'c', challenge_hash: 'secret', auth_session_fingerprint: 'secret2', installation_hash: 'secret3' });
		expect(row).not.toHaveProperty('challenge_hash');
		expect(JSON.stringify(row)).not.toContain('secret');
	});
});
