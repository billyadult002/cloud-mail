// Durable-send delivery state machine (WF-4 / WP-A).
// Pure functions only — no I/O — so the transition logic is unit-testable in
// plain Node. The outbound-service persists these states to `outbound_messages`
// and drains retries from `send_queue`.

export const OutboundStatus = Object.freeze({
	QUEUED: 'queued',     // accepted, not yet handed to a provider
	SENDING: 'sending',   // provider call in flight (claim)
	SENT: 'sent',         // provider accepted; terminal success
	RETRY: 'retry',       // transient failure; will be retried after backoff
	DEAD: 'dead',         // permanent failure or attempts exhausted; terminal
	CANCELLED: 'cancelled'
});

export const MAX_ATTEMPTS = 5;

// Exponential backoff with full jitter, capped. attempts is the number of
// attempts already made (1 after the first failure).
export function backoffMs(attempts, { base = 2000, cap = 15 * 60 * 1000, jitter = true } = {}) {
	const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempts - 1)));
	if (!jitter) return exp;
	// Full jitter: random in [0, exp]. Deterministic-friendly when Math.random
	// is stubbed in tests.
	return Math.floor(Math.random() * exp);
}

// Classify a provider/transport error into retryable vs permanent.
// Accepts an Error, a {status|code} object, or a string.
export function isRetryable(error) {
	if (!error) return false;
	const status = Number(error.status || error.code || 0);
	if (status) {
		if (status === 408 || status === 425 || status === 429) return true; // timeout/too-early/rate-limit
		if (status >= 500 && status <= 599) return true;                       // provider 5xx
		if (status >= 400 && status <= 499) return false;                      // client error → permanent
	}
	const msg = String(error.message || error || '').toLowerCase();
	if (/(timeout|timed out|econnreset|econnrefused|network|socket|temporarily|throttl|rate limit|503|502|504)/.test(msg)) {
		return true;
	}
	// Unknown → treat as retryable once (safer than dropping a send), but
	// attempts cap still bounds it.
	return true;
}

// Given current attempts and an error, decide the next state + scheduling.
export function planAfterFailure(attempts, error) {
	const retryable = isRetryable(error);
	if (!retryable || attempts >= MAX_ATTEMPTS) {
		return { status: OutboundStatus.DEAD, attempts, delayMs: 0 };
	}
	return { status: OutboundStatus.RETRY, attempts, delayMs: backoffMs(attempts) };
}

// Validate a state transition (guards against illegal moves).
const ALLOWED = {
	queued: ['sending', 'cancelled'],
	sending: ['sent', 'retry', 'dead'],
	retry: ['sending', 'cancelled', 'dead'],
	sent: [],
	dead: [],
	cancelled: []
};
export function canTransition(from, to) {
	return Array.isArray(ALLOWED[from]) && ALLOWED[from].includes(to);
}

// A stable idempotency key when the client did not supply one: derived from the
// semantic content of the send so accidental double-submits collapse.
export function deriveIdempotencyKey({ accountId, receiveEmail = [], cc = [], bcc = [], subject = '', text = '', content = '' }) {
	const norm = v => (Array.isArray(v) ? v.join(',') : String(v || '')).trim().toLowerCase();
	const basis = [
		accountId,
		norm(receiveEmail),
		norm(cc),
		norm(bcc),
		String(subject || '').trim(),
		String(text || content || '').slice(0, 512)
	].join('|');
	return basis;
}

export default {
	OutboundStatus,
	MAX_ATTEMPTS,
	backoffMs,
	isRetryable,
	planAfterFailure,
	canTransition,
	deriveIdempotencyKey
};
