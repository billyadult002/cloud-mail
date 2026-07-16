import { describe, expect, it } from 'vitest';
import outboundService from '../../src/service/outbound-service.js';
import { OutboundStatus } from '../../src/service/outbound-state.js';
import { permissionAllowsRoute, requiredPermForRoute } from '../../src/security/security.js';
import emailMsgTemplate from '../../src/template/email-msg.js';
import emailService from '../../src/service/email-service.js';
import { buildFtsQuery } from '../../src/utils/fts-utils.js';

function fakeClaimContext(initialRow) {
	const state = { row: { ...initialRow }, updates: 0 };
	return {
		state,
		env: {
			db: {
				prepare(sql) {
					return {
						bind() {
							return {
								async run() {
									if (/INSERT INTO outbound_messages/.test(sql)) {
										return { meta: { changes: 0 } };
									}
									if (/attempts = attempts \+ 1/.test(sql)) {
										state.updates += 1;
										state.row = {
											...state.row,
											status: OutboundStatus.SENDING,
											attempts: Number(state.row.attempts || 0) + 1
										};
									}
									if (/SET status = 'dead'/.test(sql)) {
										state.updates += 1;
										state.row = { ...state.row, status: OutboundStatus.DEAD };
									}
									return { meta: { changes: 1 } };
								},
								async first() {
									return { ...state.row };
								}
							};
						}
					};
				}
			}
		}
	};
}

describe('final production hardening', () => {
	it('reclaim returns the incremented attempts row', async () => {
		const c = fakeClaimContext({
			id: 7,
			user_id: 10,
			account_id: 20,
			idempotency_key: 'same-key',
			status: OutboundStatus.RETRY,
			attempts: 2
		});

		const claim = await outboundService.claim(c, 10, 20, 'same-key');
		expect(claim.claimed).toBe(true);
		expect(claim.reclaimed).toBe(true);
		expect(claim.row.attempts).toBe(3);
		expect(c.state.updates).toBe(1);
	});

	it('max attempts is terminal and does not reclaim for another provider call', async () => {
		const c = fakeClaimContext({
			id: 8,
			user_id: 10,
			account_id: 20,
			idempotency_key: 'maxed-key',
			status: OutboundStatus.RETRY,
			attempts: 5
		});

		const claim = await outboundService.claim(c, 10, 20, 'maxed-key');
		expect(claim.claimed).toBe(false);
		expect(claim.dead).toBe(true);
		expect(claim.row.status).toBe(OutboundStatus.DEAD);
		expect(c.state.updates).toBe(1);
	});

	it('duplicate idempotency key already sent returns replay, not a new claim', async () => {
		const c = fakeClaimContext({
			id: 9,
			user_id: 10,
			account_id: 20,
			idempotency_key: 'sent-key',
			status: OutboundStatus.SENT,
			attempts: 1,
			email_id: 123
		});

		const claim = await outboundService.claim(c, 10, 20, 'sent-key');
		expect(claim.claimed).toBe(false);
		expect(claim.replay).toBe(true);
		expect(c.state.updates).toBe(0);
	});

	it('admin write routes require write permission and unknown routes deny by default', () => {
		expect(requiredPermForRoute('POST', '/v2/admin/google-test-user-requests/approve-all')).toBe('google-test-users:write');
		expect(permissionAllowsRoute(['google-test-users:query'], 'POST', '/v2/admin/google-test-user-requests/approve-all')).toBe(false);
		expect(permissionAllowsRoute(['google-test-users:query'], 'GET', '/v2/admin/google-test-user-requests')).toBe(true);
		expect(permissionAllowsRoute(['google-test-users:write'], 'POST', '/v2/admin/google-test-user-requests/approve-all')).toBe(true);
		expect(requiredPermForRoute('POST', '/v2/admin/google-test-user-requests/approve-all/extra')).toBe('google-test-users:write');
		expect(permissionAllowsRoute(['google-test-users:write'], 'POST', '/v2/admin/google-test-user-requests/unknown')).toBe(false);
		expect(permissionAllowsRoute(['email:delete'], 'DELETE', '/email/delete')).toBe(true);
		expect(permissionAllowsRoute(['setting:set'], 'PUT', '/setting/set')).toBe(true);
		expect(requiredPermForRoute('POST', '/v2/admin/google-test-user-requests-evil/approve-all')).toBe(null);
	});

	it('FTS search uses one bounded MATCH expression instead of a large candidate ID list', async () => {
		let probeCount = 0;
		const c = {
			env: {
				db: {
					prepare(statement) {
						expect(statement).toBe('SELECT rowid FROM email_fts LIMIT 1');
						return {
							async first() {
								probeCount += 1;
								return { rowid: 1 };
							}
						};
					}
				}
			}
		};
		const noisyKeyword = Array.from({ length: 1000 }, (_, i) => `token${i}`).join(' ');
		const condition = await emailService.ftsSearchCondition(c, noisyKeyword);
		expect(condition).toBeTruthy();
		expect(probeCount).toBe(1);
		expect(buildFtsQuery(noisyKeyword).split(' AND ')).toHaveLength(16);
	});

	it('Telegram HTML mode escapes subject, sender, recipient, and preview entities', () => {
		const payload = emailMsgTemplate({
			subject: 'A & <tag> "quote" \'single\'',
			name: 'Sender & <bad>',
			sendEmail: 'sender&bad@example.com',
			toEmail: 'to<tag>@example.com',
			text: 'Preview & <b>bold</b> "x" \'y\''
		}, 'show', 'show', 'show');

		expect(payload).toContain('A &amp; &lt;tag&gt; &quot;quote&quot; &#39;single&#39;');
		expect(payload).toContain('Sender &amp; &lt;bad&gt;');
		expect(payload).toContain('sender&amp;bad@example.com');
		expect(payload).toContain('to&lt;tag&gt;@example.com');
		expect(payload).toContain('Preview &amp; &lt;b&gt;bold&lt;/b&gt; &quot;x&quot; &#39;y&#39;');
	});
});
