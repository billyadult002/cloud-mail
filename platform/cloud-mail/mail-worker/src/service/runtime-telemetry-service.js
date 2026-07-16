import { boundedNumber } from './worker-budget';

const DEFAULT_THRESHOLDS = Object.freeze({
	cpuP95WarningRatio: 0.7,
	budgetExhaustedRate: 0.1,
	outboundRetryBacklog: 100,
	oldestRetryMinutes: 120,
	gmailFailureRate: 0.2,
	gmailNoSuccessMinutes: 60,
	d1ErrorsPerFiveMinutes: 5,
	worker1102ErrorsPerFifteenMinutes: 0
});

function bool(value, fallback = false) {
	if (value === undefined || value === null || value === '') return fallback;
	return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function thresholds(env = {}) {
	return {
		cpuP95WarningRatio: boundedNumber(env.CLOUDMAIL_TELEMETRY_CPU_P95_WARNING_RATIO, DEFAULT_THRESHOLDS.cpuP95WarningRatio, 0.1, 1),
		budgetExhaustedRate: boundedNumber(env.CLOUDMAIL_TELEMETRY_BUDGET_EXHAUSTED_RATE, DEFAULT_THRESHOLDS.budgetExhaustedRate, 0, 1),
		outboundRetryBacklog: boundedNumber(env.CLOUDMAIL_TELEMETRY_OUTBOUND_RETRY_BACKLOG, DEFAULT_THRESHOLDS.outboundRetryBacklog, 1, 10000),
		oldestRetryMinutes: boundedNumber(env.CLOUDMAIL_TELEMETRY_OLDEST_RETRY_MINUTES, DEFAULT_THRESHOLDS.oldestRetryMinutes, 1, 10080),
		gmailFailureRate: boundedNumber(env.CLOUDMAIL_TELEMETRY_GMAIL_FAILURE_RATE, DEFAULT_THRESHOLDS.gmailFailureRate, 0, 1),
		gmailNoSuccessMinutes: boundedNumber(env.CLOUDMAIL_TELEMETRY_GMAIL_NO_SUCCESS_MINUTES, DEFAULT_THRESHOLDS.gmailNoSuccessMinutes, 1, 1440),
		d1ErrorsPerFiveMinutes: boundedNumber(env.CLOUDMAIL_TELEMETRY_D1_ERRORS_PER_5M, DEFAULT_THRESHOLDS.d1ErrorsPerFiveMinutes, 1, 1000),
		worker1102ErrorsPerFifteenMinutes: boundedNumber(env.CLOUDMAIL_TELEMETRY_1102_ERRORS_PER_15M, DEFAULT_THRESHOLDS.worker1102ErrorsPerFifteenMinutes, 0, 1000)
	};
}

function enabled(env = {}) {
	return bool(env.CLOUDMAIL_RUNTIME_TELEMETRY_ENABLED, true);
}

function redactedPayload(payload = {}) {
	const out = {};
	for (const [key, value] of Object.entries(payload || {})) {
		if (/secret|token|credential|authorization|password|cookie|messageBody|content/i.test(key)) {
			out[key] = '[redacted]';
		} else {
			out[key] = value;
		}
	}
	return out;
}

async function audit(c, action, outcome, metadata) {
	try {
		await c.env.db.prepare(
			`INSERT INTO audit_logs (actor_role, action, resource_type, outcome, metadata_json)
			 VALUES ('system', ?1, 'runtime_telemetry', ?2, ?3)`
		).bind(action, outcome, JSON.stringify(metadata).slice(0, 4000)).run();
	} catch (error) {
		const message = String(error?.message || error || '');
		if (/no such table|no such column|SQLITE_ERROR/i.test(message)) {
			console.warn(`Runtime telemetry audit unavailable: ${message.slice(0, 160)}`);
			return;
		}
		throw error;
	}
}

const runtimeTelemetryService = {
	thresholds,
	enabled,

	event(env, params = {}) {
		const elapsedMs = Number(params.elapsedMs || 0);
		const budgetMaxMs = Number(params.budgetMaxMs || 0);
		return {
			type: params.type || 'runtime_step',
			step: params.step || 'unknown',
			invocationType: params.invocationType || 'scheduled',
			ok: params.ok !== false,
			elapsedMs,
			budgetMaxMs: budgetMaxMs || null,
			budgetExhausted: Boolean(params.budgetExhausted),
			processed: Number(params.processed || 0),
			errorClass: params.errorClass || null,
			subrequests: params.subrequests || {},
			thresholds: thresholds(env),
			metadata: redactedPayload(params.metadata || {})
		};
	},

	async record(c, params = {}) {
		if (!enabled(c.env)) return null;
		const event = this.event(c.env, params);
		console.log('[runtime-telemetry]', JSON.stringify(event));
		if (bool(c.env.CLOUDMAIL_RUNTIME_TELEMETRY_AUDIT_ENABLED, false)) {
			await audit(c, 'runtime_telemetry_recorded', event.ok ? 'success' : 'failed', event);
		}
		return event;
	},

	async wrapStep(c, step, fn, options = {}) {
		const startedAt = Date.now();
		try {
			const value = await fn();
			await this.record(c, {
				step,
				invocationType: options.invocationType || 'scheduled',
				ok: true,
				elapsedMs: Date.now() - startedAt,
				budgetMaxMs: value?.budget?.maxMs || value?.maxMs || options.budgetMaxMs || null,
				budgetExhausted: Boolean(value?.budget?.budgetExhausted || value?.budgetExhausted),
				processed: value?.budget?.processed || value?.processed || value?.syncedAccounts || value?.sent || 0,
				metadata: value && typeof value === 'object' ? value : {}
			});
			return { name: step, ok: true, value };
		} catch (error) {
			await this.record(c, {
				step,
				invocationType: options.invocationType || 'scheduled',
				ok: false,
				elapsedMs: Date.now() - startedAt,
				errorClass: error?.name || 'Error',
				metadata: { message: String(error?.message || error).slice(0, 200) }
			});
			console.error(`cron step failed: ${step}:`, String(error?.message || error).slice(0, 200));
			return { name: step, ok: false };
		}
	}
};

export default runtimeTelemetryService;
