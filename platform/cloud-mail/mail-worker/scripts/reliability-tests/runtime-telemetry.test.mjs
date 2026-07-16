import { describe, expect, it } from 'vitest';
import runtimeTelemetryService from '../../src/service/runtime-telemetry-service.js';

describe('runtime telemetry foundation', () => {
	it('builds threshold-aware events and redacts sensitive metadata', () => {
		const event = runtimeTelemetryService.event({
			CLOUDMAIL_TELEMETRY_OUTBOUND_RETRY_BACKLOG: '200'
		}, {
			step: 'outboundDrain',
			elapsedMs: 123,
			budgetMaxMs: 20000,
			budgetExhausted: true,
			processed: 10,
			metadata: {
				token: 'secret',
				result: 'ok'
			}
		});

		expect(event.step).toBe('outboundDrain');
		expect(event.thresholds.outboundRetryBacklog).toBe(200);
		expect(event.metadata.token).toBe('[redacted]');
		expect(event.metadata.result).toBe('ok');
	});

	it('wraps successful scheduled steps and records processed counts', async () => {
		const recorded = [];
		const original = runtimeTelemetryService.record;
		runtimeTelemetryService.record = async (_c, params) => {
			recorded.push(params);
			return params;
		};
		try {
			const result = await runtimeTelemetryService.wrapStep({ env: {} }, 'gmailSync', async () => ({ syncedAccounts: 3 }));
			expect(result.ok).toBe(true);
			expect(recorded[0].step).toBe('gmailSync');
			expect(recorded[0].processed).toBe(3);
		} finally {
			runtimeTelemetryService.record = original;
		}
	});

	it('wraps failed scheduled steps without throwing', async () => {
		const recorded = [];
		const original = runtimeTelemetryService.record;
		runtimeTelemetryService.record = async (_c, params) => {
			recorded.push(params);
			return params;
		};
		try {
			const result = await runtimeTelemetryService.wrapStep({ env: {} }, 'outboundDrain', async () => {
				throw new Error('boom');
			});
			expect(result.ok).toBe(false);
			expect(recorded[0].ok).toBe(false);
			expect(recorded[0].errorClass).toBe('Error');
		} finally {
			runtimeTelemetryService.record = original;
		}
	});
});
