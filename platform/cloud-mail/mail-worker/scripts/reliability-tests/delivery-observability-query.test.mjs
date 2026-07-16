import { describe, expect, it } from 'vitest';
import deliveryLedgerQueryService from '../../src/service/delivery-ledger-query-service.js';

function fakeDb(rowsByKind = {}) {
	const calls = [];
	return {
		calls,
		prepare(sql) {
			const call = { sql, binds: [] };
			calls.push(call);
			return {
				bind(...args) {
					call.binds = args;
					return {
						async all() {
							if (/FROM delivery_events de/.test(sql) && /provider_message_id/.test(sql)) return { results: rowsByKind.provider || [] };
							if (/FROM delivery_events de/.test(sql) && /GROUP BY de.state, de.provider, de.error_class/.test(sql)) return { results: rowsByKind.failures || [] };
							if (/FROM delivery_events de/.test(sql) && /GROUP BY de.state, de.provider/.test(sql)) return { results: rowsByKind.summary || [] };
							if (/FROM delivery_events de/.test(sql)) return { results: rowsByKind.events || [] };
							if (/FROM outbound_messages om/.test(sql)) return { results: rowsByKind.backlog || [] };
							return { results: [] };
						},
						async first() {
							return rowsByKind.current || null;
						}
					};
				}
			};
		}
	};
}

function context(rowsByKind) {
	const db = fakeDb(rowsByKind);
	return { env: { db }, db };
}

describe('delivery observability query service', () => {
	it('returns a redacted outbound timeline with trace correlation', async () => {
		const c = context({
			current: {
				id: 77,
				status: 'sent',
				current_delivery_state: 'provider_accepted',
				provider_accepted_at: '2026-07-05 00:00:00',
				delivered_at: null,
				attempts: 1
			},
			events: [{
				id: 1,
				outbound_id: 77,
				user_id: 10,
				account_id: 20,
				state: 'provider_accepted',
				provider: 'resend',
				provider_message_id: 'msg_1',
				provider_event_id: 'evt_1',
				attempt: 1,
				metadata_json: JSON.stringify({ token: 'secret', safe: 'ok' }),
				occurred_at: '2026-07-05 00:00:00',
				created_at: '2026-07-05 00:00:00'
			}]
		});

		const timeline = await deliveryLedgerQueryService.timelineByOutboundId(c, 77, { admin: false, userId: 10 }, { limit: 10 });
		expect(timeline.current.currentDeliveryState).toBe('provider_accepted');
		expect(timeline.events[0].metadata.token).toBe('[redacted]');
		expect(timeline.events[0].metadata.safe).toBe('ok');
		expect(timeline.events[0].trace.traceId).toBe('outbound:77');
		expect(timeline.events[0].trace.correlation).toBe('resend:msg_1');
		expect(c.db.calls[0].sql).toContain('de.user_id = ?');
		expect(c.db.calls[0].binds).toEqual([77, 10, 10]);
	});

	it('supports provider message lookup for incident correlation', async () => {
		const c = context({
			provider: [{
				id: 2,
				outbound_id: 88,
				user_id: 10,
				account_id: 20,
				state: 'delivered',
				provider: 'resend',
				provider_message_id: 'msg_2',
				attempt: 1,
				metadata_json: '{}'
			}]
		});

		const result = await deliveryLedgerQueryService.timelineByProviderMessage(c, 'resend', 'msg_2', { admin: true }, {});
		expect(result.events).toHaveLength(1);
		expect(result.events[0].state).toBe('delivered');
		expect(c.db.calls[0].binds).toEqual(['resend', 'msg_2', 100]);
	});

	it('returns empty diagnostics when the ledger migration has not been applied', async () => {
		const c = {
			env: {
				db: {
					prepare() {
						return {
							bind() {
								return {
									async all() {
										throw new Error('SQLITE_ERROR: no such table: delivery_events');
									}
								};
							}
						};
					}
				}
			}
		};

		const summary = await deliveryLedgerQueryService.summaryByWindow(c, { admin: true }, {});
		expect(summary.states).toEqual([]);
	});
});
