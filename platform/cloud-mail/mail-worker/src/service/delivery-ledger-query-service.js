const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 30;

function clampNumber(value, fallback, min, max) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

function userClause(scope = {}, alias = 'de') {
	if (scope.admin) return { sql: '', binds: [] };
	return { sql: ` AND ${alias}.user_id = ?`, binds: [scope.userId] };
}

function redactMetadata(value) {
	if (!value) return {};
	try {
		const parsed = typeof value === 'string' ? JSON.parse(value) : value;
		if (!parsed || typeof parsed !== 'object') return {};
		const out = {};
		for (const [key, raw] of Object.entries(parsed)) {
			if (/secret|token|credential|authorization|password|cookie/i.test(key)) {
				out[key] = '[redacted]';
			} else {
				out[key] = raw;
			}
		}
		return out;
	} catch {
		return {};
	}
}

function mapEvent(row = {}) {
	return {
		id: row.id,
		outboundId: row.outbound_id,
		userId: row.user_id,
		accountId: row.account_id,
		state: row.state,
		provider: row.provider,
		providerMessageId: row.provider_message_id,
		providerEventId: row.provider_event_id,
		attempt: Number(row.attempt || 0),
		errorClass: row.error_class,
		errorMessage: row.error_message,
		metadata: redactMetadata(row.metadata_json),
		occurredAt: row.occurred_at,
		createdAt: row.created_at,
		trace: {
			traceId: `outbound:${row.outbound_id}`,
			correlation: row.provider_message_id ? `${row.provider || 'provider'}:${row.provider_message_id}` : null,
			providerEventId: row.provider_event_id || null
		}
	};
}

function mapOutbound(row = {}) {
	if (!row) return null;
	return {
		outboundId: row.id,
		status: row.status,
		currentDeliveryState: row.current_delivery_state,
		providerAcceptedAt: row.provider_accepted_at,
		providerQueuedAt: row.provider_queued_at,
		deliveredAt: row.delivered_at,
		bouncedAt: row.bounced_at,
		failedAt: row.failed_at,
		emailId: row.email_id,
		externalMessageId: row.external_message_id,
		attempts: Number(row.attempts || 0),
		updatedAt: row.updated_at
	};
}

function emptyOnMissingLedger(error) {
	const message = String(error?.message || error || '');
	if (/no such table|no such column|SQLITE_ERROR/i.test(message)) {
		return true;
	}
	return false;
}

async function safeQuery(fallback, fn) {
	try {
		return await fn();
	} catch (error) {
		if (emptyOnMissingLedger(error)) {
			console.warn(`Delivery diagnostics unavailable: ${String(error?.message || error).slice(0, 160)}`);
			return fallback;
		}
		throw error;
	}
}

const deliveryLedgerQueryService = {
	limit(params = {}) {
		return clampNumber(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
	},

	windowHours(params = {}) {
		return clampNumber(params.windowHours || params.window || DEFAULT_WINDOW_HOURS, DEFAULT_WINDOW_HOURS, 1, MAX_WINDOW_HOURS);
	},

	async timelineByOutboundId(c, outboundId, scope = {}, params = {}) {
		const id = Number(outboundId);
		if (!Number.isFinite(id) || id <= 0) return { outboundId: null, current: null, events: [] };
		const limit = this.limit(params);
		const scopeFilter = userClause(scope, 'de');
		return safeQuery({ outboundId: id, current: null, events: [] }, async () => {
			const events = await c.env.db.prepare(
				`SELECT de.*
				   FROM delivery_events de
				  WHERE de.outbound_id = ?1${scopeFilter.sql}
				  ORDER BY datetime(de.occurred_at) ASC, de.id ASC
				  LIMIT ?${scopeFilter.binds.length + 2}`
			).bind(id, ...scopeFilter.binds, limit).all();
			const outboundScope = userClause(scope, 'om');
			const current = await c.env.db.prepare(
				`SELECT om.*
				   FROM outbound_messages om
				  WHERE om.id = ?1${outboundScope.sql}
				  LIMIT 1`
			).bind(id, ...outboundScope.binds).first();
			return {
				outboundId: id,
				current: mapOutbound(current),
				events: (events?.results || []).map(mapEvent)
			};
		});
	},

	async timelineByProviderMessage(c, provider, providerMessageId, scope = {}, params = {}) {
		const cleanProvider = String(provider || '').trim();
		const cleanMessageId = String(providerMessageId || '').trim();
		if (!cleanProvider || !cleanMessageId) return { provider: cleanProvider, providerMessageId: cleanMessageId, events: [] };
		const limit = this.limit(params);
		const scopeFilter = userClause(scope, 'de');
		return safeQuery({ provider: cleanProvider, providerMessageId: cleanMessageId, events: [] }, async () => {
			const events = await c.env.db.prepare(
				`SELECT de.*
				   FROM delivery_events de
				  WHERE de.provider = ?1
				    AND de.provider_message_id = ?2${scopeFilter.sql}
				  ORDER BY datetime(de.occurred_at) ASC, de.id ASC
				  LIMIT ?${scopeFilter.binds.length + 3}`
			).bind(cleanProvider, cleanMessageId, ...scopeFilter.binds, limit).all();
			return {
				provider: cleanProvider,
				providerMessageId: cleanMessageId,
				events: (events?.results || []).map(mapEvent)
			};
		});
	},

	async summaryByWindow(c, scope = {}, params = {}) {
		const hours = this.windowHours(params);
		const scopeFilter = userClause(scope, 'de');
		return safeQuery({ windowHours: hours, states: [] }, async () => {
			const rows = await c.env.db.prepare(
				`SELECT de.state, de.provider, COUNT(*) AS count
				   FROM delivery_events de
				  WHERE datetime(de.occurred_at) >= datetime('now', ?1)${scopeFilter.sql}
				  GROUP BY de.state, de.provider
				  ORDER BY count DESC, de.state ASC`
			).bind(`-${hours} hours`, ...scopeFilter.binds).all();
			return { windowHours: hours, states: rows?.results || [] };
		});
	},

	async retryBacklog(c, scope = {}, params = {}) {
		const limit = this.limit(params);
		const scopeFilter = userClause(scope, 'om');
		return safeQuery({ rows: [] }, async () => {
			const rows = await c.env.db.prepare(
				`SELECT om.id AS outbound_id, om.user_id, om.account_id, om.status,
				        om.current_delivery_state, om.attempts, om.next_attempt_at,
				        om.last_error, om.updated_at
				   FROM outbound_messages om
				  WHERE (om.status IN ('retry', 'dead')
				     OR om.current_delivery_state IN ('retry', 'failed', 'bounce'))${scopeFilter.sql}
				  ORDER BY om.next_attempt_at ASC, datetime(om.updated_at) ASC
				  LIMIT ?${scopeFilter.binds.length + 1}`
			).bind(...scopeFilter.binds, limit).all();
			return { rows: rows?.results || [] };
		});
	},

	async failureRollup(c, scope = {}, params = {}) {
		const hours = this.windowHours(params);
		const scopeFilter = userClause(scope, 'de');
		return safeQuery({ windowHours: hours, failures: [] }, async () => {
			const rows = await c.env.db.prepare(
				`SELECT de.state, de.provider, de.error_class, COUNT(*) AS count
				   FROM delivery_events de
				  WHERE de.state IN ('retry', 'bounce', 'failed')
				    AND datetime(de.occurred_at) >= datetime('now', ?1)${scopeFilter.sql}
				  GROUP BY de.state, de.provider, de.error_class
				  ORDER BY count DESC, de.state ASC`
			).bind(`-${hours} hours`, ...scopeFilter.binds).all();
			return { windowHours: hours, failures: rows?.results || [] };
		});
	}
};

export default deliveryLedgerQueryService;
