// Unit tests for the durable-send state machine (WF-4 / WP-A).
// Pure-function tests, no I/O.
import { describe, expect, it } from 'vitest';
import {
	OutboundStatus, MAX_ATTEMPTS, backoffMs, isRetryable,
	planAfterFailure, canTransition, deriveIdempotencyKey
} from '../../src/service/outbound-state.js';

describe('outbound state machine', () => {
	it('backoff grows', () => {
		expect(backoffMs(1, { jitter: false })).toBeLessThan(backoffMs(3, { jitter: false }));
	});

	it('backoff capped', () => {
		expect(backoffMs(50, { jitter: false })).toBeLessThanOrEqual(15 * 60 * 1000);
	});

	it('backoff jitter within bound', () => {
		const orig = Math.random;
		Math.random = () => 0.999;
		const v = backoffMs(2);
		Math.random = orig;
		expect(v).toBeLessThanOrEqual(4000);
	});

	it('429 retryable', () => {
		expect(isRetryable({ status: 429 })).toBe(true);
	});

	it('503 retryable', () => {
		expect(isRetryable({ status: 503 })).toBe(true);
	});

	it('400 permanent', () => {
		expect(isRetryable({ status: 400 })).toBe(false);
	});

	it('401 permanent', () => {
		expect(isRetryable({ status: 401 })).toBe(false);
	});

	it('timeout msg retryable', () => {
		expect(isRetryable(new Error('socket timed out'))).toBe(true);
	});

	it('ECONNRESET retryable', () => {
		expect(isRetryable(new Error('read ECONNRESET'))).toBe(true);
	});

	it('retryable → RETRY', () => {
		expect(planAfterFailure(1, { status: 503 }).status).toBe(OutboundStatus.RETRY);
	});

	it('permanent → DEAD', () => {
		expect(planAfterFailure(1, { status: 400 }).status).toBe(OutboundStatus.DEAD);
	});

	it('attempts exhausted → DEAD', () => {
		expect(planAfterFailure(MAX_ATTEMPTS, { status: 503 }).status).toBe(OutboundStatus.DEAD);
	});

	it('retry has delay', () => {
		expect(planAfterFailure(2, { status: 500 }).delayMs).toBeGreaterThanOrEqual(0);
	});

	it('queued→sending ok', () => {
		expect(canTransition('queued', 'sending')).toBe(true);
	});

	it('sending→sent ok', () => {
		expect(canTransition('sending', 'sent')).toBe(true);
	});

	it('sending→retry ok', () => {
		expect(canTransition('sending', 'retry')).toBe(true);
	});

	it('retry→sending ok', () => {
		expect(canTransition('retry', 'sending')).toBe(true);
	});

	it('sent→sending blocked', () => {
		expect(canTransition('sent', 'sending')).toBe(false);
	});

	it('dead→sending blocked', () => {
		expect(canTransition('dead', 'sending')).toBe(false);
	});

	it('idempotency deterministic', () => {
		const base = { accountId: 5, receiveEmail: ['a@x.com'], subject: 'Hi', text: 'hello' };
		expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey({ ...base }));
	});

	it('idempotency varies on recipient', () => {
		const base = { accountId: 5, receiveEmail: ['a@x.com'], subject: 'Hi', text: 'hello' };
		expect(deriveIdempotencyKey(base)).not.toBe(deriveIdempotencyKey({ ...base, receiveEmail: ['b@x.com'] }));
	});

	it('idempotency case-insensitive recipient', () => {
		const base = { accountId: 5, receiveEmail: ['a@x.com'], subject: 'Hi', text: 'hello' };
		expect(deriveIdempotencyKey({ ...base, receiveEmail: ['A@X.com'] })).toBe(deriveIdempotencyKey(base));
	});
});
