const SYNC_POLICY_KV_KEY = 'cloudmail:sync-policy:v1';

const DEFAULT_SYNC_POLICY = Object.freeze({
	global_default_poll_interval_seconds: 120,
	gmail_poll_fallback_interval_seconds: 60,
	gmail_partial_sync_min_interval_seconds: 60,
	imap_poll_interval_seconds: 300,
	imap_idle_reissue_seconds: 1740,
	account_override_poll_interval_seconds: {},
	min_poll_interval_seconds: 60,
	max_poll_interval_seconds: 1800,
	backoff_base_seconds: 60,
	backoff_max_seconds: 1800,
	jitter_percent: 10,
	battery_saver_multiplier: 2,
	active_foreground_multiplier: 0.5,
	server_config_version: 1
});

function numberOrDefault(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function clampSeconds(value, policy) {
	const min = numberOrDefault(policy.min_poll_interval_seconds, DEFAULT_SYNC_POLICY.min_poll_interval_seconds);
	const max = numberOrDefault(policy.max_poll_interval_seconds, DEFAULT_SYNC_POLICY.max_poll_interval_seconds);
	return Math.min(Math.max(Math.round(numberOrDefault(value, min)), min), max);
}

function sanitizePolicy(input = {}) {
	const merged = {
		...DEFAULT_SYNC_POLICY,
		...(input || {}),
		account_override_poll_interval_seconds:
			typeof input.account_override_poll_interval_seconds === 'object' && input.account_override_poll_interval_seconds
				? input.account_override_poll_interval_seconds
				: {}
	};
	for (const key of [
		'global_default_poll_interval_seconds',
		'gmail_poll_fallback_interval_seconds',
		'gmail_partial_sync_min_interval_seconds',
		'imap_poll_interval_seconds',
		'imap_idle_reissue_seconds',
		'backoff_base_seconds',
		'backoff_max_seconds'
	]) {
		merged[key] = clampSeconds(merged[key], merged);
	}
	merged.jitter_percent = Math.min(Math.max(numberOrDefault(merged.jitter_percent, 10), 0), 30);
	merged.battery_saver_multiplier = Math.min(Math.max(numberOrDefault(merged.battery_saver_multiplier, 2), 1), 5);
	merged.active_foreground_multiplier = Math.min(Math.max(numberOrDefault(merged.active_foreground_multiplier, 0.5), 0.25), 1);
	merged.server_config_version = Number.parseInt(merged.server_config_version || 1, 10) || 1;
	merged.last_sync_policy_refresh_at = new Date().toISOString();
	return merged;
}

function jitteredSeconds(seconds, policy, seed = '') {
	const jitter = numberOrDefault(policy.jitter_percent, 0) / 100;
	if (jitter <= 0) return seconds;
	let hash = 0;
	for (const char of String(seed || 'cloudmail')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	const unit = (hash % 1000) / 1000;
	const factor = 1 + ((unit * 2) - 1) * jitter;
	return clampSeconds(seconds * factor, policy);
}

function backoffSeconds(attempts, policy) {
	const base = clampSeconds(policy.backoff_base_seconds, policy);
	const max = clampSeconds(policy.backoff_max_seconds, policy);
	const exponent = Math.min(Math.max(Number(attempts || 0), 0), 8);
	return Math.min(base * Math.pow(2, exponent), max);
}

async function load(c) {
	let raw = null;
	if (c.env.SYNC_POLICY_JSON) raw = c.env.SYNC_POLICY_JSON;
	if (!raw && c.env.kv?.get) raw = await c.env.kv.get(SYNC_POLICY_KV_KEY);
	if (!raw) return sanitizePolicy(DEFAULT_SYNC_POLICY);
	try {
		return sanitizePolicy(JSON.parse(raw));
	} catch {
		return sanitizePolicy(DEFAULT_SYNC_POLICY);
	}
}

async function save(c, patch = {}) {
	const current = await load(c);
	const next = sanitizePolicy({
		...current,
		...patch,
		server_config_version: Number(current.server_config_version || 1) + 1
	});
	if (c.env.kv?.put) {
		await c.env.kv.put(SYNC_POLICY_KV_KEY, JSON.stringify(next));
	}
	return next;
}

function effectiveForAccount(policy, account = {}, options = {}) {
	const override = policy.account_override_poll_interval_seconds?.[String(account.account_id || account.accountId || '')];
	const provider = account.provider || options.provider || 'gmail';
	let base = override
		|| (provider === 'imap' ? policy.imap_poll_interval_seconds : policy.gmail_poll_fallback_interval_seconds)
		|| policy.global_default_poll_interval_seconds;
	if (options.mode === 'gmail_partial') base = policy.gmail_partial_sync_min_interval_seconds;
	if (options.mode === 'imap_idle') base = policy.imap_idle_reissue_seconds;
	if (options.batterySaver) base *= policy.battery_saver_multiplier;
	if (options.activeForeground) base *= policy.active_foreground_multiplier;
	if (Number(account.sync_attempts || 0) > 0) {
		base = Math.max(base, backoffSeconds(account.sync_attempts, policy));
	}
	return {
		provider_mode: options.mode || (provider === 'imap' ? 'idle_or_polling' : 'push_partial_or_polling_fallback'),
		effective_interval_seconds: jitteredSeconds(clampSeconds(base, policy), policy, account.account_id || account.accountId || provider),
		min_poll_interval_seconds: policy.min_poll_interval_seconds,
		max_poll_interval_seconds: policy.max_poll_interval_seconds,
		backoff_seconds: backoffSeconds(account.sync_attempts || 0, policy),
		jitter_percent: policy.jitter_percent,
		server_config_version: policy.server_config_version,
		last_sync_policy_refresh_at: policy.last_sync_policy_refresh_at
	};
}

export default {
	DEFAULT_SYNC_POLICY,
	load,
	save,
	effectiveForAccount,
	clampSeconds,
	backoffSeconds,
	jitteredSeconds
};
