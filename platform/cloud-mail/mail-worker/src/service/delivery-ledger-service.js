export const DeliveryLedgerState = Object.freeze({
	CREATED: 'created',
	QUEUED: 'queued',
	PROVIDER_ACCEPTED: 'provider_accepted',
	PROVIDER_QUEUED: 'provider_queued',
	DELIVERED: 'delivered',
	RETRY: 'retry',
	BOUNCE: 'bounce',
	FAILED: 'failed'
});

const timelineColumnByState = {
	provider_accepted: 'provider_accepted_at',
	provider_queued: 'provider_queued_at',
	delivered: 'delivered_at',
	bounce: 'bounced_at',
	failed: 'failed_at'
};

function safeJson(value) {
	try {
		return JSON.stringify(value || {});
	} catch {
		return '{}';
	}
}

async function bestEffort(c, fn) {
	try {
		return await fn();
	} catch (error) {
		const message = String(error?.message || error || '');
		if (/no such table|no such column|SQLITE_ERROR/i.test(message)) {
			console.warn(`Delivery ledger unavailable: ${message.slice(0, 160)}`);
			return null;
		}
		throw error;
	}
}

const deliveryLedgerService = {
	async record(c, event = {}) {
		if (!event.outboundId || !event.userId || !event.accountId || !event.state) return null;
		return bestEffort(c, async () => {
			const inserted = await c.env.db.prepare(
				`INSERT INTO delivery_events
				 (outbound_id, user_id, account_id, state, provider, provider_message_id,
				  provider_event_id, attempt, error_class, error_message, metadata_json)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
			).bind(
				event.outboundId,
				event.userId,
				event.accountId,
				event.state,
				event.provider || null,
				event.providerMessageId || null,
				event.providerEventId || null,
				Number(event.attempt || 0),
				event.errorClass || null,
				event.errorMessage ? String(event.errorMessage).slice(0, 300) : null,
				safeJson(event.metadata)
			).run();

			const timelineColumn = timelineColumnByState[event.state];
			if (timelineColumn) {
				await c.env.db.prepare(
					`UPDATE outbound_messages
					    SET current_delivery_state = ?2,
					        ${timelineColumn} = COALESCE(${timelineColumn}, CURRENT_TIMESTAMP),
					        updated_at = CURRENT_TIMESTAMP
					  WHERE id = ?1`
				).bind(event.outboundId, event.state).run();
			} else {
				await c.env.db.prepare(
					`UPDATE outbound_messages
					    SET current_delivery_state = ?2,
					        updated_at = CURRENT_TIMESTAMP
					  WHERE id = ?1`
				).bind(event.outboundId, event.state).run();
			}
			return inserted?.meta?.last_row_id || null;
		});
	}
};

export default deliveryLedgerService;
