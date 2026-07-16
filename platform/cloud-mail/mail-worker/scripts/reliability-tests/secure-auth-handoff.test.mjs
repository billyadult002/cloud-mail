import { describe, expect, it } from 'vitest';
import {
	activeContinuationOutcome,
	beginProvisioningAuthHandoff,
	consumeProvisioningContinuation,
	createProvisioningContinuation,
	recordProvisioningAuthAttempt,
	safeMetadata
} from '../../src/service/cloudmail-v2-service.js';

function harness({ user = { userId: 7, email: 'admin@hengmao.org' }, admin = 'owner@example.com', authorization = 'session-a' } = {}) {
	const kvRows = new Map();
	const handoffs = new Map();
	const statements = [];
	let session = authorization;
	const kv = {
		async get(key) { return kvRows.get(key) ?? null; },
		async put(key, value) { kvRows.set(key, value); },
		async delete(key) { kvRows.delete(key); }
	};
	const db = {
		prepare(sql) {
			return {
				bind(...bindings) {
					return {
						async first() {
							if (sql.includes('secure_auth_handoffs') && sql.includes('WHERE reference_hash')) {
								return handoffs.get(bindings[0]) || null;
							}
							if (sql.includes('secure_auth_handoffs') && sql.includes('WHERE continuation_hash')) {
								return [...handoffs.values()].find(row => row.continuation_hash === bindings[0]) || null;
							}
							return null;
						},
						async run() {
							statements.push({ sql, bindings });
							if (sql.includes('INSERT INTO secure_auth_handoffs')) {
								handoffs.set(bindings[0], {
									reference_hash: bindings[0], target_email: bindings[1], domain: bindings[2],
									provider: bindings[3], purpose: bindings[4], nonce: bindings[5],
									device_reference_hash: bindings[6], state: 'CHALLENGE', expires_at: bindings[7]
								});
								return { success: true, meta: { changes: 1 } };
							}
							if (sql.includes("state IN ('CONTINUATION','CONSUMED')")) {
								const row = handoffs.get(bindings[1]);
								if (!row || !['CONTINUATION', 'CONSUMED'].includes(row.state) || Number(row.user_id) !== Number(bindings[2]) || row.session_reference_hash !== bindings[3] || row.expires_at <= bindings[4]) return { meta: { changes: 0 } };
								Object.assign(row, { continuation_hash: bindings[0], state: 'CONTINUATION' });
								return { success: true, meta: { changes: 1 } };
							}
							if (sql.includes("state = 'CONSUMED'")) {
								const row = [...handoffs.values()].find(item => item.continuation_hash === bindings[0]);
								if (!row || row.state !== 'CONTINUATION' || row.expires_at <= bindings[1]) return { meta: { changes: 0 } };
								row.state = 'CONSUMED';
								return { success: true, meta: { changes: 1 } };
							}
							if (sql.includes("state = 'CONTINUATION'")) {
								const row = handoffs.get(bindings[3]);
								if (!row || row.state !== 'CHALLENGE' || row.expires_at <= bindings[4]) return { meta: { changes: 0 } };
								Object.assign(row, { continuation_hash: bindings[0], user_id: bindings[1], session_reference_hash: bindings[2], state: 'CONTINUATION' });
								return { success: true, meta: { changes: 1 } };
							}
							return { success: true, meta: { changes: 1 } };
						}
					};
				}
			};
		}
	};
	const c = {
		env: { kv, db, admin, domain: JSON.stringify(['hengmao.org']) },
		get(key) { return key === 'user' ? user : null; },
		req: {
			header(name) {
				if (String(name).toLowerCase() === 'authorization') return session;
				if (String(name).toLowerCase() === 'cf-connecting-ip') return '203.0.113.9';
				return undefined;
			}
		}
	};
	return { c, kvRows, handoffs, statements, setSession(value) { session = value; } };
}

function auditEvents(statements) {
	return statements
		.filter(row => row.sql.includes('audit_logs'))
		.map(row => ({ event: row.bindings[2], outcome: row.bindings[4], metadata: row.bindings[5] }));
}

async function challengeAndContinuation(h, overrides = {}) {
	const deviceReference = overrides.deviceReference || 'device-a';
	const provider = overrides.provider || 'cloudmail';
	const challenge = await beginProvisioningAuthHandoff(h.c, 'admin@hengmao.org', {
		domain: 'hengmao.org', provider, deviceReference
	});
	const continuation = await createProvisioningContinuation(h.c, 'admin@hengmao.org', {
		challengeReference: challenge.challengeReference,
		provider,
		deviceReference
	});
	return { challenge, continuation, deviceReference, provider };
}

describe('GPT67 secure auth handoff', () => {
	it('never reports ready until active routing is observed', () => {
		expect(activeContinuationOutcome({ accountStatus: 'active', routingRuleEnabled: false, accountOwnedByPrincipal: true, identityActive: true })).toMatchObject({
			status: 'blocked', mailboxReady: false, blocker: 'MAILBOX_ROUTING_NOT_READY'
		});
		expect(activeContinuationOutcome({ accountStatus: 'active', routingRuleEnabled: true, accountOwnedByPrincipal: false, identityActive: true })).toMatchObject({
			status: 'blocked', mailboxReady: false
		});
		expect(activeContinuationOutcome({ accountStatus: 'active', routingRuleEnabled: true, accountOwnedByPrincipal: true, identityActive: true })).toMatchObject({
			status: 'ready', mailboxReady: true, healthState: 'HEALTHY'
		});
	});

	it('recursively removes secret-shaped metadata keys', () => {
		const canary = 'GPT67-SECRET-CANARY';
		const safe = safeMetadata({
			provider: 'cloudmail',
			password: canary,
			nested: { otp: canary, continuationToken: canary, status: 'safe' },
			items: [{ activation_code: canary, result: 'ok' }]
		});
		expect(JSON.stringify(safe)).not.toContain(canary);
		expect(safe).toEqual({ provider: 'cloudmail', nested: { status: 'safe' }, items: [{ result: 'ok' }] });
	});

	it('binds and consumes a continuation once on the same principal, target, device, provider, purpose, and session', async () => {
		const h = harness();
		const { continuation, deviceReference, provider } = await challengeAndContinuation(h);
		await expect(consumeProvisioningContinuation(
			h.c, continuation.continuationToken, 'admin@hengmao.org', { deviceReference, provider }
		)).resolves.toBe(true);
		await expect(consumeProvisioningContinuation(
			h.c, continuation.continuationToken, 'admin@hengmao.org', { deviceReference, provider }
		)).rejects.toThrow(/expired/i);
		expect(auditEvents(h.statements).map(row => row.event)).toEqual([
			'auth_required', 'auth_success', 'provisioning_resumed'
		]);
		expect(JSON.stringify(h.statements)).not.toContain(continuation.continuationToken);
	});

	it('records only allowlisted safe authentication attempt events', async () => {
		const h = harness();
		const challenge = await beginProvisioningAuthHandoff(h.c, 'admin@hengmao.org', {
			domain: 'hengmao.org', provider: 'cloudmail', deviceReference: 'device-a'
		});
		await recordProvisioningAuthAttempt(h.c, challenge.challengeReference, 'started');
		await recordProvisioningAuthAttempt(h.c, challenge.challengeReference, 'failed');
		const events = auditEvents(h.statements);
		expect(events.map(row => row.event)).toEqual(['auth_required', 'auth_started', 'auth_failed']);
		expect(JSON.stringify(events)).not.toContain(challenge.challengeReference);
	});

	it('atomically allows only one continuation mint per challenge', async () => {
		const h = harness();
		const challenge = await beginProvisioningAuthHandoff(h.c, 'admin@hengmao.org', {
			domain: 'hengmao.org', provider: 'cloudmail', deviceReference: 'device-a'
		});
		const mint = () => createProvisioningContinuation(h.c, 'admin@hengmao.org', {
			challengeReference: challenge.challengeReference,
			provider: 'cloudmail', deviceReference: 'device-a'
		});
		const results = await Promise.allSettled([mint(), mint()]);
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
	});

	it('atomically allows only one continuation consumption', async () => {
		const h = harness();
		const { continuation, deviceReference, provider } = await challengeAndContinuation(h);
		const consume = () => consumeProvisioningContinuation(
			h.c, continuation.continuationToken, 'admin@hengmao.org', { deviceReference, provider }
		);
		const results = await Promise.allSettled([consume(), consume()]);
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
	});

	it('rotates a consumed continuation from the safe challenge reference without re-authentication', async () => {
		const h = harness();
		const { challenge, continuation, deviceReference, provider } = await challengeAndContinuation(h);
		await consumeProvisioningContinuation(
			h.c, continuation.continuationToken, 'admin@hengmao.org', { deviceReference, provider }
		);
		const renewed = await createProvisioningContinuation(h.c, 'admin@hengmao.org', {
			challengeReference: challenge.challengeReference, provider, deviceReference
		});
		expect(renewed.continuationToken).not.toBe(continuation.continuationToken);
		await expect(consumeProvisioningContinuation(
			h.c, renewed.continuationToken, 'admin@hengmao.org', { deviceReference, provider }
		)).resolves.toBe(true);
		expect(auditEvents(h.statements).filter(row => row.event === 'auth_success')).toHaveLength(1);
	});

	it('rejects a different device reference', async () => {
		const h = harness();
		const { continuation, provider } = await challengeAndContinuation(h);
		await expect(consumeProvisioningContinuation(
			h.c, continuation.continuationToken, 'admin@hengmao.org', { deviceReference: 'device-b', provider }
		)).rejects.toThrow(/not valid for this session/i);
	});

	it('refuses to create an unbound challenge without a device reference', async () => {
		const h = harness();
		await expect(beginProvisioningAuthHandoff(h.c, 'admin@hengmao.org', {
			domain: 'hengmao.org', provider: 'cloudmail', deviceReference: ''
		})).rejects.toThrow(/device reference is required/i);
	});

	it('rejects a different authenticated session', async () => {
		const h = harness();
		const { continuation, deviceReference, provider } = await challengeAndContinuation(h);
		h.setSession('session-b');
		await expect(consumeProvisioningContinuation(
			h.c, continuation.continuationToken, 'admin@hengmao.org', { deviceReference, provider }
		)).rejects.toThrow(/not valid for this session/i);
	});

	it('rejects provider substitution during minting', async () => {
		const h = harness();
		const challenge = await beginProvisioningAuthHandoff(h.c, 'admin@hengmao.org', {
			domain: 'hengmao.org', provider: 'cloudmail', deviceReference: 'device-a'
		});
		await expect(createProvisioningContinuation(h.c, 'admin@hengmao.org', {
			challengeReference: challenge.challengeReference,
			provider: 'google_workspace',
			deviceReference: 'device-a'
		})).rejects.toThrow(/does not match/i);
		expect(auditEvents(h.statements).at(-1)).toMatchObject({ event: 'auth_failed', outcome: 'binding_mismatch' });
	});

	it('rejects an authenticated principal that does not own the target', async () => {
		const h = harness({ user: { userId: 8, email: 'other@example.net' } });
		const challenge = await beginProvisioningAuthHandoff(h.c, 'admin@hengmao.org', {
			domain: 'hengmao.org', provider: 'cloudmail', deviceReference: 'device-a'
		});
		await expect(createProvisioningContinuation(h.c, 'admin@hengmao.org', {
			challengeReference: challenge.challengeReference,
			provider: 'cloudmail', deviceReference: 'device-a'
		})).rejects.toThrow(/cannot provision/i);
		expect(auditEvents(h.statements).at(-1)).toMatchObject({ event: 'auth_failed', outcome: 'target_not_authorized' });
	});

	it('rejects an expired challenge without minting a continuation', async () => {
		const h = harness();
		const challenge = await beginProvisioningAuthHandoff(h.c, 'admin@hengmao.org', {
			domain: 'hengmao.org', provider: 'cloudmail', deviceReference: 'device-a'
		});
		const row = [...h.handoffs.values()][0];
		row.expires_at = Date.now() - 1;
		await expect(createProvisioningContinuation(h.c, 'admin@hengmao.org', {
			challengeReference: challenge.challengeReference,
			provider: 'cloudmail', deviceReference: 'device-a'
		})).rejects.toThrow(/expired/i);
		expect([...h.handoffs.values()].some(item => item.state === 'CONTINUATION')).toBe(false);
	});

	it('rejects tampered persisted continuation state with a fixed safe error', async () => {
		const h = harness();
		const { continuation, deviceReference, provider } = await challengeAndContinuation(h);
		const row = [...h.handoffs.values()][0];
		row.nonce = '';
		await expect(consumeProvisioningContinuation(
			h.c, continuation.continuationToken, 'admin@hengmao.org', { deviceReference, provider }
		)).rejects.toThrow(/not valid/i);
		expect(row.state).toBe('CONTINUATION');
	});
});
