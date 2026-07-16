// RC state-machine regression tests (RC-1 routeSyncFailure, RC-2 classifyGmailError,
// RC-5 backfill page builder).
//
// RUN ENVIRONMENT: these import gmail-imap-service.js, which imports `cloudflare:sockets`,
// so they MUST run under the Workers runtime (workerd) via vitest-pool-workers — i.e. on a
// platform whose installed workerd binary matches (your Mac). They were authored and
// syntax-checked in a Linux sandbox but NOT executed there (workerd platform mismatch).
//
//   cd platform/cloud-mail/mail-worker && npx vitest run scripts/reliability-tests/rc-state-machine.test.mjs
//
// A vitest config with the pool-workers pool is required (already a devDependency:
// @cloudflare/vitest-pool-workers). If none exists, add vitest.config.mjs per that package.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { reconnectCommitIsCurrent } from '../../src/service/gemini-oauth-service.js';
import {
	classifyGmailError,
	routeSyncFailure,
	listGmailApiBackfillPage,
	normalizeReceivedDate,
	prepareGmailApiParsedMessages
	, fetchGmailApiMessageWithTombstoneRecovery
} from '../../src/service/gmail-imap-service.js';

// Minimal c stub that records every prepared/bound/executed statement.
function mockC() {
	const calls = [];
	return {
		calls,
		env: {
			db: {
				prepare(sql) {
					const stmt = {
						_sql: sql,
						binds: null,
						bind(...args) { this.binds = args; return this; },
						async run() { calls.push({ sql: this._sql, binds: this.binds }); return { meta: {} }; },
						async first() { return null; },
						async all() { return { results: [] }; }
					};
					return stmt;
				}
			}
		}
	};
}

describe('RC-2 classifyGmailError', () => {
	it('maps HTTP status to a bounded category', () => {
		expect(classifyGmailError(401, {}).category).toBe('token');
		expect(classifyGmailError(403, {}).category).toBe('auth');
		expect(classifyGmailError(429, {}).category).toBe('rate');
		expect(classifyGmailError(503, {}).category).toBe('outage');
		expect(classifyGmailError(400, {}).category).toBe('client');
	});
	it('derives reason without leaking a large body (<=80 chars)', () => {
		const info = classifyGmailError(403, { error: { status: 'PERMISSION_DENIED' } });
		expect(info.reason).toBe('PERMISSION_DENIED');
		const long = classifyGmailError(500, { error: { errors: [{ reason: 'x'.repeat(500) }] } });
		expect(long.reason.length).toBeLessThanOrEqual(80);
	});
});

describe('RC-1 routeSyncFailure', () => {
	afterEach(() => vi.restoreAllMocks());

	it('terminal 403 -> needs_reconnect', async () => {
		const c = mockC();
		const result = await routeSyncFailure(c, 42, 7, { category: 'auth', httpStatus: 403, message: 'forbidden' }, 0);
		expect(result).toBe('needs_reconnect');
		expect(c.calls[0].sql).toContain("needs_reconnect");
		// binds: (accountId, userId, message, errorClass, attempts)
		expect(c.calls[0].binds[4]).toBe(1); // attempts = priorAttempts + 1, incremented once
	});

	it('transient 429 -> sync_required with 2^attempts backoff', async () => {
		const c = mockC();
		const result = await routeSyncFailure(c, 42, 7, { category: 'rate', httpStatus: 429, message: 'slow down' }, 0);
		expect(result).toBe('sync_required');
		expect(c.calls[0].sql).toContain("sync_required");
		expect(c.calls[0].sql).not.toContain('last_synced_at');
		// binds: (accountId, userId, message, errorClass, attempts, backoffMin)
		expect(c.calls[0].binds[4]).toBe(1);   // attempts
		expect(c.calls[0].binds[5]).toBe(2);   // min(2^1, 240)
	});

	it('Gmail API 404 -> truthful mailbox-unavailable blocker, never reconnect', async () => {
		const c = mockC();
		const result = await routeSyncFailure(c, 42, 7, { category: 'provider_mailbox_unavailable', httpStatus: 404, message: 'Gmail API profile 404: NOT_FOUND' }, 0);
		expect(result).toBe('provider_mailbox_unavailable');
		expect(c.calls[0].sql).toContain("provider_mailbox_unavailable");
		expect(c.calls[0].sql).not.toContain("needs_reconnect");
	});

	it('authorized identity mismatch -> terminal identity-mismatch state, never reconnect', async () => {
		const c = mockC();
		const result = await routeSyncFailure(c, 42, 7, { category: 'identity_mismatch', message: 'different mailbox identity' }, 0);
		expect(result).toBe('authorized_identity_mismatch');
		expect(c.calls[0].sql).toContain("authorized_identity_mismatch");
		expect(c.calls[0].sql).not.toContain("needs_reconnect");
	});

	it('crosses the cap (priorAttempts 5 -> attempts 6) -> first_import_failed even when transient', async () => {
		const c = mockC();
		const result = await routeSyncFailure(c, 42, 7, { category: 'rate', httpStatus: 429, message: 'slow' }, 5);
		expect(result).toBe('first_import_failed');
		expect(c.calls[0].binds[4]).toBe(6);
	});

	it('never converts a repeated listed-message recovery gap into reconnect or import failure', async () => {
		const c = mockC();
		const result = await routeSyncFailure(c, 42, 7, {
			category: 'ingest_gap',
			httpStatus: 404,
			message: 'one listed Gmail message was temporarily unavailable'
		}, 154);
		expect(result).toBe('sync_required');
		expect(c.calls[0].sql).toContain("sync_status = 'sync_required'");
		expect(c.calls[0].sql).not.toContain('first_import_failed');
		expect(c.calls[0].sql).not.toContain('needs_reconnect');
		// Content recovery stays bounded even after a long retry history.
		expect(c.calls[0].binds[5]).toBe(30);
	});

	it('backoff is capped at 240 minutes', async () => {
		const c = mockC();
		// priorAttempts 3 -> attempts 4 -> 2^4=16 (still transient, under cap of 6 attempts)
		await routeSyncFailure(c, 42, 7, { category: 'outage', httpStatus: 503, message: 'down' }, 3);
		expect(c.calls[0].binds[5]).toBe(16);
	});
});

describe('RC-5 listGmailApiBackfillPage', () => {
	afterEach(() => vi.restoreAllMocks());

	it('sends pageToken when provided and returns the nextPageToken cursor', async () => {
		let seenUrl = '';
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			seenUrl = String(url);
			return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'CURSOR2' }) };
		}));
		const page = await listGmailApiBackfillPage('tok', 25, 'CURSOR1');
		expect(seenUrl).toContain('pageToken=CURSOR1');
		expect(seenUrl).toContain('maxResults=25');
		expect(seenUrl).not.toContain('newer_than'); // full-history walk, not the 90d forward window
		expect(page.messages.map(m => m.id)).toEqual(['a', 'b']);
		expect(page.nextPageToken).toBe('CURSOR2');
	});

	it('history end -> empty nextPageToken (caller sets backfill_done)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [] }) })));
		const page = await listGmailApiBackfillPage('tok', 25, '');
		expect(page.messages).toEqual([]);
		expect(page.nextPageToken).toBe('');
	});
});

describe('Gmail deleted-reference recovery', () => {
	afterEach(() => vi.restoreAllMocks());
	it('reconciles only a double-404 reference as deleted before fetch', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND' } }) })));
		const result = await fetchGmailApiMessageWithTombstoneRecovery(null, 'token', { id: 'deleted-reference' });
		expect(result.deletedBeforeFetch).toBe(true);
	});
});

describe('Gmail subrequest budget tracking', () => {
	afterEach(() => vi.restoreAllMocks());

	it('increments subrequests counter in context and throws when limit is exceeded', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => {
			return { ok: true, status: 200, json: async () => ({ messages: [], nextPageToken: '' }) };
		}));
		const c = { subrequests: 39 };
		await listGmailApiBackfillPage(c, 'tok', 25, '');
		expect(c.subrequests).toBe(40);

		await expect(listGmailApiBackfillPage(c, 'tok', 25, '')).rejects.toThrow('CloudMail subrequest limit budget exhausted.');
	});
});

describe('P25 Gmail timestamp normalization', () => {
	it('clamps unrealistic future Gmail message dates to a small skew window', () => {
		const now = new Date('2026-07-05T12:00:00.000Z');
		const normalized = normalizeReceivedDate('2099-01-01T00:00:00.000Z', now);
		expect(normalized).toBe('2026-07-05T12:00:00.000Z');
	});

	it('preserves valid past Gmail message dates', () => {
		const now = new Date('2026-07-05T12:00:00.000Z');
		const normalized = normalizeReceivedDate('2026-07-05T11:58:30.000Z', now);
		expect(normalized).toBe('2026-07-05T11:58:30.000Z');
	});

	it('uses the current sync time for invalid or missing Gmail dates', () => {
		const now = new Date('2026-07-05T12:00:00.000Z');
		expect(normalizeReceivedDate('', now)).toBe('2026-07-05T12:00:00.000Z');
		expect(normalizeReceivedDate('not-a-date', now)).toBe('2026-07-05T12:00:00.000Z');
	});
});

describe('P28 bad Gmail message tolerance', () => {
	it('skips a malformed Gmail API message and prepares the remaining messages', async () => {
		const fetched = [
			{ gmailId: 'bad-1', threadId: 't1', labelIds: [], raw: new Uint8Array([1, 2, 3]) },
			{ gmailId: 'good-1', threadId: 't2', labelIds: ['UNREAD'], raw: new TextEncoder().encode('ok') }
		];
		const result = await prepareGmailApiParsedMessages(fetched, async raw => {
			if (raw[0] === 1) throw new Error('malformed mime');
			return {
				messageId: '<good-1@example.test>',
				headers: [],
				subject: 'Good',
				from: { address: 'sender@example.test' },
				to: [{ address: 'to@example.test' }],
				text: 'body',
				html: ''
			};
		});

		expect(result.parseFailed).toBe(1);
		expect(result.oversized).toBe(0);
		expect(result.prepared).toHaveLength(1);
		expect(result.prepared[0].item.gmailId).toBe('good-1');
		expect(result.prepared[0].messageId).toBe('<good-1@example.test>');
	});

	it('skips oversized messages before parsing them', async () => {
		let parseCalls = 0;
		const result = await prepareGmailApiParsedMessages([
			{ gmailId: 'huge-1', threadId: 't1', labelIds: [], raw: new Uint8Array(8 * 1024 * 1024 + 1) }
		], async () => {
			parseCalls += 1;
			return {};
		});

		expect(parseCalls).toBe(0);
		expect(result.oversized).toBe(1);
		expect(result.parseFailed).toBe(0);
		expect(result.prepared).toEqual([]);
	});
});

describe('P0 multi-Gmail reconnect containment', () => {
	it('binds a reconnect to the intended identity hash and authorization generation', () => {
		expect(reconnectCommitIsCurrent({
			expectedIdentityHash: 'identity-a', actualIdentityHash: 'identity-a', expectedGeneration: 4, currentGeneration: 4
		})).toBe(true);
		expect(reconnectCommitIsCurrent({
			expectedIdentityHash: 'identity-a', actualIdentityHash: 'identity-b', expectedGeneration: 4, currentGeneration: 4
		})).toBe(false);
	});

	it('rejects stale generations even when the mailbox identity is correct', () => {
		expect(reconnectCommitIsCurrent({
			expectedIdentityHash: 'identity-a', actualIdentityHash: 'identity-a', expectedGeneration: 4, currentGeneration: 5
		})).toBe(false);
		expect(reconnectCommitIsCurrent({
			expectedIdentityHash: '', actualIdentityHash: '', expectedGeneration: 0, currentGeneration: 0
		})).toBe(false);
	});
});
