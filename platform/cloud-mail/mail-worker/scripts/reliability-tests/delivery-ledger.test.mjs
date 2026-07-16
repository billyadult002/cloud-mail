import { describe, expect, it } from 'vitest';
import deliveryLedgerService, { DeliveryLedgerState } from '../../src/service/delivery-ledger-service.js';

function fakeLedgerContext() {
	const calls = [];
	const runResults = [];
	return {
		calls,
		env: {
			db: {
				prepare(sql) {
					const call = { sql, binds: [] };
					calls.push(call);
					return {
						bind(...args) {
							call.binds = args;
							return {
								async run() {
									runResults.push(call);
									return { meta: { last_row_id: runResults.length, changes: 1 } };
								}
							};
						}
					};
				}
			}
		}
	};
}

function baseEvent(state) {
	return {
		outboundId: 77,
		userId: 10,
		accountId: 20,
		state,
		provider: 'resend',
		providerMessageId: 'provider-message-1',
		providerEventId: 'provider-event-1',
		attempt: 2,
		metadata: { source: 'reliability-test' }
	};
}

describe('delivery truth ledger', () => {
	it('records each P0 delivery state without collapsing provider acceptance into delivery', async () => {
		const states = [
			DeliveryLedgerState.CREATED,
			DeliveryLedgerState.QUEUED,
			DeliveryLedgerState.PROVIDER_ACCEPTED,
			DeliveryLedgerState.DELIVERED,
			DeliveryLedgerState.RETRY,
			DeliveryLedgerState.BOUNCE,
			DeliveryLedgerState.FAILED
		];

		for (const state of states) {
			const c = fakeLedgerContext();
			const id = await deliveryLedgerService.record(c, baseEvent(state));

			expect(id).toBe(1);
			expect(c.calls).toHaveLength(2);
			expect(c.calls[0].sql).toContain('INSERT INTO delivery_events');
			expect(c.calls[0].binds[3]).toBe(state);
			expect(c.calls[1].sql).toContain('UPDATE outbound_messages');
			expect(c.calls[1].binds).toEqual([77, state]);
		}
	});

	it('sets only provider_accepted_at for provider acceptance and only delivered_at for delivery', async () => {
		const accepted = fakeLedgerContext();
		await deliveryLedgerService.record(accepted, baseEvent(DeliveryLedgerState.PROVIDER_ACCEPTED));
		const acceptedUpdate = accepted.calls[1].sql;

		expect(acceptedUpdate).toContain('current_delivery_state = ?2');
		expect(acceptedUpdate).toContain('provider_accepted_at = COALESCE(provider_accepted_at, CURRENT_TIMESTAMP)');
		expect(acceptedUpdate).not.toContain('delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)');

		const delivered = fakeLedgerContext();
		await deliveryLedgerService.record(delivered, baseEvent(DeliveryLedgerState.DELIVERED));
		const deliveredUpdate = delivered.calls[1].sql;

		expect(deliveredUpdate).toContain('current_delivery_state = ?2');
		expect(deliveredUpdate).toContain('delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)');
		expect(deliveredUpdate).not.toContain('provider_accepted_at = COALESCE(provider_accepted_at, CURRENT_TIMESTAMP)');
	});

	it('bounds error messages and serializes unsafe metadata as an empty object', async () => {
		const c = fakeLedgerContext();
		const circular = {};
		circular.self = circular;
		await deliveryLedgerService.record(c, {
			...baseEvent(DeliveryLedgerState.FAILED),
			errorClass: 'provider_error',
			errorMessage: 'x'.repeat(350),
			metadata: circular
		});

		expect(c.calls[0].binds[8]).toBe('provider_error');
		expect(c.calls[0].binds[9]).toHaveLength(300);
		expect(c.calls[0].binds[10]).toBe('{}');
	});

	it('fails closed for incomplete events before writing ledger rows', async () => {
		const c = fakeLedgerContext();
		const id = await deliveryLedgerService.record(c, {
			outboundId: 77,
			userId: 10,
			accountId: 20
		});

		expect(id).toBeNull();
		expect(c.calls).toHaveLength(0);
	});
});
