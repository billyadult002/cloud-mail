import { connect } from 'cloudflare:sockets';
import PostalMime from 'postal-mime';
import emailUtils from '../utils/email-utils';
import { emailConst, isDel } from '../const/entity-const';
import attService from './att-service';
import fileUtils from '../utils/file-utils';
import constant from '../const/constant';
import geminiOAuthService from './gemini-oauth-service';
import { decryptSecret, encryptSecret } from '../utils/secret-crypto';
import { createWorkerBudget } from './worker-budget';
import syncPolicyService from './sync-policy-service';
import googleTestUserRequestService from './google-test-user-request-service';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const OAUTH_CREDENTIAL_PREFIX = 'oauth-json:';
const IMAP_CONNECT_TIMEOUT_MS = 10000;
const IMAP_READ_TIMEOUT_MS = 15000;
const IMAP_FETCH_TIMEOUT_MS = 20000;
const AUTO_SYNC_ACCOUNT_TIMEOUT_MS = 12000;
const GMAIL_API_CACHE_MAILBOX = 'GMAIL_API';
const GMAIL_API_UID_VALIDITY = 0;
const MAX_FUTURE_MESSAGE_SKEW_MS = 2 * 60 * 1000;
// WF-10 / WP-F: cap the raw bytes we will parse/store per message so a single
// very large message can't exhaust the Worker isolate memory or stall a batch.
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const LEGACY_IMAP_UNSUPPORTED_MESSAGE = 'Legacy Gmail IMAP credential is not receive-verifiable on Cloudflare Workers; reconnect current mailbox with Google OAuth to enable Gmail API receive.';

function rawByteLength(raw) {
	if (!raw) return 0;
	if (raw instanceof Uint8Array) return raw.length;
	if (raw instanceof ArrayBuffer) return raw.byteLength;
	return String(raw).length;
}

function stableCacheUid(value) {
	const text = String(value || '');
	let hash = 2166136261;
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 1) || 1;
}

async function withTimeout(promise, timeoutMs, message) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function readWithDeadline(client, label, timeoutMs = IMAP_READ_TIMEOUT_MS) {
	return withTimeout(
		client.reader.read(),
		timeoutMs,
		`Gmail IMAP read timed out during ${label}.`
	);
}

function normalizeEmail(value) {
	return String(value || '').trim().toLowerCase();
}

function quote(value) {
	return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function base64Encode(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64Decode(value) {
	const binary = atob(value);
	return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function base64UrlDecode(value) {
	let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
	while (normalized.length % 4) normalized += '=';
	return base64Decode(normalized);
}

async function keyFor(c) {
	const secret = c.env.GMAIL_CREDENTIAL_SECRET || c.env.jwt_secret || c.env.JWT_SECRET;
	if (!secret || String(secret).length < 16) {
		throw new Error('Gmail credential encryption secret is not configured.');
	}
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
	return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(c, value) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await keyFor(c);
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value));
	return `${base64Encode(iv)}.${base64Encode(new Uint8Array(cipher))}`;
}

async function decrypt(c, value) {
	const [ivRaw, cipherRaw] = String(value || '').split('.');
	if (!ivRaw || !cipherRaw) throw new Error('Stored Gmail credential is invalid.');
	const key = await keyFor(c);
	const plain = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: base64Decode(ivRaw) },
		key,
		base64Decode(cipherRaw)
	);
	return decoder.decode(plain);
}

async function sha256Hex(value) {
	let bytes = value;
	if (typeof value === 'string') {
		bytes = encoder.encode(value);
	} else if (value instanceof ArrayBuffer) {
		bytes = new Uint8Array(value);
	} else if (!(value instanceof Uint8Array)) {
		bytes = encoder.encode(String(value || ''));
	}
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function concatBytes(chunks) {
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

async function readUntil(client, tag) {
	while (!client.buffer.includes(`\r\n${tag} OK`) && !client.buffer.includes(`${tag} OK`) &&
	       !client.buffer.includes(`\r\n${tag} NO`) && !client.buffer.includes(`${tag} NO`) &&
	       !client.buffer.includes(`\r\n${tag} BAD`) && !client.buffer.includes(`${tag} BAD`)) {
		const { value, done } = await readWithDeadline(client, tag);
		if (done) break;
		client.buffer += decoder.decode(value, { stream: true });
	}
	const marker = `${tag} `;
	const idx = client.buffer.lastIndexOf(marker);
	if (idx === -1) return '';
	const end = client.buffer.indexOf('\r\n', idx);
	if (end === -1) return client.buffer;
	const out = client.buffer.slice(0, end + 2);
	client.buffer = client.buffer.slice(end + 2);
	return out;
}

async function readGreeting(client) {
	while (!client.buffer.includes('* OK') && !client.buffer.includes('* PREAUTH') &&
	       !client.buffer.includes('* BYE')) {
		const { value, done } = await readWithDeadline(client, 'greeting');
		if (done) break;
		client.buffer += decoder.decode(value, { stream: true });
	}
	if (client.buffer.includes('* BYE')) {
		throw new Error('Gmail IMAP connection was rejected.');
	}
}

async function command(client, text) {
	client.seq += 1;
	const tag = `A${String(client.seq).padStart(4, '0')}`;
	await client.writer.write(encoder.encode(`${tag} ${text}\r\n`));
	const response = await readUntil(client, tag);
	if (!response.includes(`${tag} OK`)) {
		throw new Error(response.split('\r\n').find(line => line.startsWith(tag)) || `IMAP command failed: ${text}`);
	}
	return response;
}

async function commandBytes(client, text) {
	client.seq += 1;
	const tag = `A${String(client.seq).padStart(4, '0')}`;
	await client.writer.write(encoder.encode(`${tag} ${text}\r\n`));
	const chunks = client.buffer ? [encoder.encode(client.buffer)] : [];
	client.buffer = '';
	let decoded = chunks.length ? decoder.decode(chunks[0], { stream: true }) : '';
	while (!decoded.includes(`\r\n${tag} OK`) && !decoded.includes(`${tag} OK`) &&
	       !decoded.includes(`\r\n${tag} NO`) && !decoded.includes(`${tag} NO`) &&
	       !decoded.includes(`\r\n${tag} BAD`) && !decoded.includes(`${tag} BAD`)) {
		const { value, done } = await readWithDeadline(client, tag, IMAP_FETCH_TIMEOUT_MS);
		if (done) break;
		chunks.push(value);
		decoded += decoder.decode(value, { stream: true });
	}
	decoded += decoder.decode();
	if (!decoded.includes(`${tag} OK`)) {
		throw new Error(decoded.split('\r\n').find(line => line.startsWith(tag)) || `IMAP command failed: ${text}`);
	}
	return concatBytes(chunks);
}

async function withGmail(email, appPassword, fn) {
	const socket = connect({ hostname: 'imap.gmail.com', port: 993 }, { secureTransport: 'on' });
	socket.closed.catch(err => {
		console.error("IMAP socket closed with error:", err);
	});
	const client = {
		reader: socket.readable.getReader(),
		writer: socket.writable.getWriter(),
		buffer: '',
		seq: 0
	};
	try {
		if (socket.opened) {
			await withTimeout(socket.opened, IMAP_CONNECT_TIMEOUT_MS, 'Gmail IMAP socket open timed out.');
		}
		await readGreeting(client);
		await command(client, `LOGIN ${quote(email)} ${quote(appPassword)}`);
		const result = await fn(client);
		await command(client, 'LOGOUT').catch(() => null);
		return result;
	} finally {
		try { client.reader.releaseLock(); } catch {}
		try { client.writer.releaseLock(); } catch {}
		try { socket.close(); } catch {}
		try {
			if (socket.closed) await Promise.race([
				socket.closed.catch(() => null),
				new Promise(resolve => setTimeout(resolve, 250))
			]);
		} catch {}
	}
}

async function gmailSocketDiagnostic() {
	const socket = connect({ hostname: 'imap.gmail.com', port: 993 }, { secureTransport: 'on' });
	const client = {
		reader: socket.readable.getReader(),
		writer: socket.writable.getWriter(),
		buffer: '',
		seq: 0
	};
	try {
		if (socket.opened) {
			await withTimeout(socket.opened, IMAP_CONNECT_TIMEOUT_MS, 'Gmail IMAP socket open timed out.');
		}
		await readGreeting(client);
		return { provider: 'gmail', host: 'imap.gmail.com', port: 993, socket: 'opened', greeting: 'accepted' };
	} finally {
		try { client.reader.releaseLock(); } catch {}
		try { client.writer.releaseLock(); } catch {}
		try { socket.close(); } catch {}
		try {
			if (socket.closed) await Promise.race([
				socket.closed.catch(() => null),
				new Promise(resolve => setTimeout(resolve, 250))
			]);
		} catch {}
	}
}

function literalMessages(fetchResponse) {
	const messages = [];
	const bytes = fetchResponse instanceof Uint8Array ? fetchResponse : encoder.encode(String(fetchResponse || ''));
	let index = 0;
	while (index < bytes.length) {
		if (bytes[index] !== 123) {
			index += 1;
			continue;
		}
		let end = index + 1;
		while (end < bytes.length && bytes[end] >= 48 && bytes[end] <= 57) end += 1;
		if (end === index + 1 || bytes[end] !== 125 || bytes[end + 1] !== 13 || bytes[end + 2] !== 10) {
			index += 1;
			continue;
		}
		const len = Number(decoder.decode(bytes.slice(index + 1, end)));
		const start = end + 3;
		const raw = bytes.slice(start, start + len);
		if (raw.length === len) messages.push(raw);
		index = start + len;
	}
	return messages;
}

function uidValidity(selectResponse) {
	const match = String(selectResponse || '').match(/\[UIDVALIDITY\s+(\d+)\]/i);
	return match ? Number(match[1]) : 0;
}

function literalFetchedMessages(fetchResponse) {
	const messages = [];
	const bytes = fetchResponse instanceof Uint8Array ? fetchResponse : encoder.encode(String(fetchResponse || ''));
	let index = 0;
	while (index < bytes.length) {
		if (bytes[index] !== 123) {
			index += 1;
			continue;
		}
		let end = index + 1;
		while (end < bytes.length && bytes[end] >= 48 && bytes[end] <= 57) end += 1;
		if (end === index + 1 || bytes[end] !== 125 || bytes[end + 1] !== 13 || bytes[end + 2] !== 10) {
			index += 1;
			continue;
		}
		const len = Number(decoder.decode(bytes.slice(index + 1, end)));
		const start = end + 3;
		const raw = bytes.slice(start, start + len);
		if (raw.length === len) {
			const preambleStart = Math.max(0, decoder.decode(bytes.slice(0, index)).lastIndexOf('\r\n* '));
			const preamble = decoder.decode(bytes.slice(preambleStart, index));
			const uid = Number(preamble.match(/\bUID\s+(\d+)\b/i)?.[1] || 0);
			messages.push({ uid, raw });
		}
		index = start + len;
	}
	return messages;
}

function normalizeReceivedDate(raw, now = new Date()) {
	const fallback = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
	if (!raw) return fallback.toISOString();
	const date = raw instanceof Date ? raw : new Date(raw);
	if (Number.isNaN(date.getTime())) return fallback.toISOString();
	return (date > fallback ? fallback : date).toISOString();
}

function gmailInternalDate(value) {
	const millis = Number(value || 0);
	if (!Number.isFinite(millis) || millis <= 0) return null;
	return new Date(millis);
}

function receivedDate(parsed, source = {}) {
	const raw = gmailInternalDate(source.internalDate) || parsed.date;
	return normalizeReceivedDate(raw);
}

function headerValue(parsed, key) {
	return parsed.headers?.find(header => header.key === key)?.value || '';
}

function addressOf(value) {
	if (Array.isArray(value)) {
		for (const item of value) {
			const address = addressOf(item);
			if (address) return address;
		}
		return '';
	}
	if (Array.isArray(value?.group)) return addressOf(value.group);
	return value?.address || '';
}

function nameOf(value) {
	if (Array.isArray(value)) {
		for (const item of value) {
			const name = nameOf(item);
			if (name) return name;
		}
		return '';
	}
	if (Array.isArray(value?.group)) return nameOf(value.group);
	return value?.name || '';
}

function referencesOf(parsed) {
	const references = parsed.references || headerValue(parsed, 'references');
	if (Array.isArray(references)) return references.join(' ');
	return references || '';
}

async function externalMessageId(parsed, raw) {
	const messageId = normalizeEmail(parsed.messageId || headerValue(parsed, 'message-id'));
	if (messageId) return messageId;
	return `gmail-sha256:${await sha256Hex(raw)}`;
}

function oauthTokenExpired(payload, skewSeconds = 90) {
	const expiresAt = Number(payload?.expires_at || 0);
	return !expiresAt || expiresAt <= Math.floor(Date.now() / 1000) + skewSeconds;
}

function boundedNumber(value, fallback, min, max) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

function isOAuthCredential(credentialCiphertext) {
	return String(credentialCiphertext || '').startsWith(OAUTH_CREDENTIAL_PREFIX);
}

async function markLegacyImapNeedsReconnect(c, accountId, userId, message = LEGACY_IMAP_UNSUPPORTED_MESSAGE) {
	await c.env.db.prepare(
		`UPDATE account
		    SET sync_status = 'legacy_imap_unsupported',
		        sync_error = ?3,
		        sync_error_class = 'legacy_imap_unsupported',
		        next_attempt_at = NULL,
		        last_progress_at = CURRENT_TIMESTAMP
		  WHERE account_id = ?1 AND user_id = ?2`
	).bind(accountId, userId, message).run();
}

async function mailboxLifecycleAfterImport(c, userId, accountId) {
	const credential = await c.env.db.prepare(
		`SELECT id FROM mail_provider_credentials
		  WHERE user_id = ?1 AND account_id = ?2 AND provider IN ('gmail', 'google_workspace')
		  LIMIT 1`
	).bind(userId, accountId).first();
	if (!credential) return 'first_import_pending';

	const row = await latestGmailLedgerEvidence(c, userId, accountId);
	return Number(row?.emailId || 0) > 0 ? 'mailbox_ready' : 'first_import_pending';
}

async function refreshOAuthCredential(c, credentialRow, payload) {
	if (c) {
		c.subrequests = (c.subrequests || 0) + 1;
		if (c.subrequests > 40) {
			throw new Error('CloudMail subrequest limit budget exhausted.');
		}
	}
	if (!payload.refresh_token) return payload;
	if (!c.env.GOOGLE_OAUTH_CLIENT_ID || !c.env.GOOGLE_OAUTH_CLIENT_SECRET) {
		throw new Error('Google OAuth client is not configured for Gmail token refresh.');
	}
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
			client_secret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
			refresh_token: payload.refresh_token,
			grant_type: 'refresh_token'
		})
	});
	const token = await response.json().catch(() => ({}));
	if (!response.ok) {
		const providerReason = String(token?.error || token?.error_description || `HTTP_${response.status}`)
			.toLowerCase()
			.slice(0, 80);
		const err = new Error(`Gmail OAuth refresh failed: ${providerReason}`);
		err.httpStatus = response.status;
		err.reason = providerReason;
		err.category = providerReason.includes('invalid_grant')
			|| providerReason.includes('unauthorized_client')
			|| response.status === 400
			? 'auth'
			: classifyGmailError(response.status, token).category;
		throw err;
	}
	const next = {
		...payload,
		access_token: token.access_token || payload.access_token,
		refresh_token: token.refresh_token || payload.refresh_token,
		scope: token.scope || payload.scope,
		token_type: token.token_type || payload.token_type,
		expires_at: token.expires_in ? Math.floor(Date.now() / 1000) + Number(token.expires_in) : payload.expires_at
	};
	await c.env.db.prepare(
		`UPDATE mail_provider_credentials
		    SET credential_ciphertext = ?1,
		        updated_at = CURRENT_TIMESTAMP
		  WHERE id = ?2`
	).bind(OAUTH_CREDENTIAL_PREFIX + await encryptSecret(c, JSON.stringify(next)), credentialRow.id).run();
	return next;
}

async function loadOAuthCredential(c, credentialRow) {
	const encrypted = String(credentialRow.credential_ciphertext || '').slice(OAUTH_CREDENTIAL_PREFIX.length);
	let payload = JSON.parse(await decryptSecret(c, encrypted));
	if (oauthTokenExpired(payload)) {
		payload = await refreshOAuthCredential(c, credentialRow, payload);
	}
	if (!payload.access_token) throw new Error('Google OAuth mailbox token is unavailable.');
	return payload;
}

// RC-2: classify a Gmail API failure into a typed, enum-bounded reason so downstream
// callers can distinguish terminal auth failures (403) from transient ones (401/429/5xx)
// and so account.sync_error records *why* it failed. Never returns raw body/PII.
function classifyGmailError(status, body) {
	const reason =
		(body && body.error && (body.error.status ||
			(Array.isArray(body.error.errors) && body.error.errors[0] && body.error.errors[0].reason)))
		|| `HTTP_${status}`;
	let category = 'unknown';
	if (status === 401) category = 'token';
	else if (status === 403) category = 'auth';
	else if (status === 429) category = 'rate';
	else if (status >= 500) category = 'outage';
	else if (status === 404) category = 'provider_mailbox_unavailable';
	else if (status >= 400) category = 'client';
	return { httpStatus: status, category, reason: String(reason).slice(0, 80) };
}

// Provider responses are useful for incident correlation, but may contain account
// identifiers or free-form text. Keep only the bounded protocol fields needed to
// distinguish a Gmail API/project/scope/service failure from an internal failure.
function safeGoogleError(body) {
	const error = body?.error || {};
	const detail = Array.isArray(error.errors) ? (error.errors[0] || {}) : {};
	const message = String(error.message || '');
	const normalized = message.toLowerCase();
	let messageClass = null;
	if (normalized.includes('gmail') && normalized.includes('disabled')) messageClass = 'gmail_service_disabled';
	else if (normalized.includes('api') && normalized.includes('enabled')) messageClass = 'api_not_enabled';
	else if (normalized.includes('not found')) messageClass = 'not_found';
	else if (normalized.includes('permission')) messageClass = 'permission_denied';
	else if (normalized.includes('scope')) messageClass = 'insufficient_scope';
	return {
		status: String(error.status || '').slice(0, 80) || null,
		domain: String(detail.domain || '').slice(0, 80) || null,
		reason: String(detail.reason || '').slice(0, 80) || null,
		locationType: String(detail.locationType || '').slice(0, 80) || null,
		location: String(detail.location || '').slice(0, 80) || null,
		messageClass
	};
}

// RC-1: route a Gmail sync failure into the recoverable state machine. Terminal auth
// failures (403) -> 'needs_reconnect' (manual OAuth state, excluded from auto-selection).
// Repeated non-auth import failures -> 'first_import_failed' so OAuth success is preserved
// and the UI can offer Import Recovery instead of sending the user through OAuth again.
// Transient failures -> 'sync_required' with capped exponential backoff via next_attempt_at.
// `priorAttempts` is account.sync_attempts BEFORE this failure; this is the ONLY place
// that increments it, so it must be called exactly once per failed attempt (from sync()).
async function routeSyncFailure(c, accountId, userId, error, priorAttempts) {
	const info = (error && error.category)
		? { category: error.category, reason: error.reason, httpStatus: error.httpStatus || 0 }
		: classifyGmailError(Number(error?.httpStatus || 0), {});
	const attempts = Number(priorAttempts || 0) + 1;
	const cap = 6;
	const authTerminal = info.category === 'auth';
	const mailboxUnavailable = info.category === 'provider_mailbox_unavailable';
	const identityMismatch = info.category === 'identity_mismatch';
	// A listed-message 404 (or a transient mail-data endpoint failure) is a
	// content recovery problem, not evidence that the OAuth grant disappeared.
	// In particular, do not let repeated retries turn a verified Gmail send grant
	// into `first_import_failed`: that state used to make Accounts ask a user to
	// reconnect even after a successful, same-identity OAuth callback.
	const recoverableContentGap = ['ingest_gap', 'gmail_mail_data_unavailable'].includes(String(info.category || ''));
	const importFailed = !authTerminal && !recoverableContentGap && attempts >= cap;
	const message = String(error?.message || error).slice(0, 300);
	const errorClass = String(info.category || 'unknown').slice(0, 32);
	const failureSet = `last_sync_failure_at = CURRENT_TIMESTAMP,
	        sync_failure_reason = ?3,`;
	if (identityMismatch) {
		const blocker = 'The authorized Google identity does not match this mailbox. Reconnect this mailbox and select its matching Google identity.';
		await c.env.db.prepare(
			`UPDATE account
			    SET sync_status = 'authorized_identity_mismatch',
			        next_attempt_at = NULL,
			        ${failureSet}
			        sync_error = ?3,
			        sync_error_class = 'identity_mismatch',
			        sync_attempts = ?5
			  WHERE account_id = ?1 AND user_id = ?2`
		).bind(accountId, userId, blocker, 'identity_mismatch', attempts).run();
		return 'authorized_identity_mismatch';
	}
	if (mailboxUnavailable) {
		const blocker = 'Gmail API could not find an available mailbox for this authorized Google identity. Check Gmail service availability or Workspace licensing, then retry the provider check.';
		await c.env.db.prepare(
			`UPDATE account
			    SET sync_status = 'provider_mailbox_unavailable',
			        next_attempt_at = NULL,
			        ${failureSet}
			        sync_error = ?3,
			        sync_error_class = 'provider_mailbox_unavailable',
			        sync_attempts = ?5
			  WHERE account_id = ?1 AND user_id = ?2`
		).bind(accountId, userId, blocker, 'provider_mailbox_unavailable', attempts).run();
		return 'provider_mailbox_unavailable';
	}
	if (authTerminal) {
		await c.env.db.prepare(
			`UPDATE account
			    SET sync_status = 'needs_reconnect',
			        ${failureSet}
			        sync_error = ?3,
			        sync_error_class = ?4,
			        sync_attempts = ?5
			  WHERE account_id = ?1 AND user_id = ?2`
		).bind(accountId, userId, message, errorClass, attempts).run();
		return 'needs_reconnect';
	}
	// A mailbox that was ready before a failed attempt is still a failed attempt.
	// Never promote it back to ready or advance `last_synced_at` from stale ledger
	// evidence; only a completed provider sync may do that.
	if (importFailed) {
		await c.env.db.prepare(
			`UPDATE account
			    SET sync_status = 'first_import_failed',
			        next_attempt_at = datetime('now'),
			        ${failureSet}
			        sync_error = ?3,
			        sync_error_class = ?4,
			        sync_attempts = ?5
			  WHERE account_id = ?1 AND user_id = ?2`
		).bind(accountId, userId, message, errorClass, attempts).run();
		return 'first_import_failed';
	}
	const backoffMin = recoverableContentGap ? Math.min(2 ** Math.min(attempts, 6), 30) : Math.min(2 ** attempts, 240);
	await c.env.db.prepare(
		`UPDATE account
		    SET sync_status = 'sync_required',
		        next_attempt_at = datetime('now', '+' || ?6 || ' minutes'),
		        ${failureSet}
		        sync_error = ?3,
		        sync_error_class = ?4,
		        sync_attempts = ?5
		  WHERE account_id = ?1 AND user_id = ?2`
	).bind(accountId, userId, message, errorClass, attempts, backoffMin).run();
	return 'sync_required';
}

async function assertCurrentOAuthAuthorizationGeneration(c, userId, accountId, expectedGeneration) {
	const current = await c.env.db.prepare(
		`SELECT oauth_authorization_generation FROM account
		  WHERE account_id = ?1 AND user_id = ?2 AND is_del = 0 LIMIT 1`
	).bind(accountId, userId).first();
	if (!current || Number(current.oauth_authorization_generation || 0) !== Number(expectedGeneration || 0)) {
		const error = new Error('Gmail sync result was superseded by a newer authorization.');
		error.category = 'stale_authorization_generation';
		error.reason = 'oauth_reconnect_superseded_sync';
		throw error;
	}
}

async function gmailApiJson(c, url, accessToken, operation = 'request') {
	let context = c;
	let targetUrl = url;
	let token = accessToken;
	if (typeof c === 'string' && typeof url === 'string') {
		context = null;
		targetUrl = c;
		token = url;
	}
	if (context) {
		context.subrequests = (context.subrequests || 0) + 1;
		if (context.subrequests > 40) {
			throw new Error('CloudMail subrequest limit budget exhausted.');
		}
	}
	const response = await fetch(targetUrl, {
		headers: { authorization: `Bearer ${token}` }
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const info = classifyGmailError(response.status, body);
		const err = new Error(`Gmail API ${operation} ${info.httpStatus}: ${info.reason}`);
		err.httpStatus = info.httpStatus;
		err.category = info.category;
		err.reason = info.reason;
		err.googleError = safeGoogleError(body);
		err.operation = operation;
		const parsedUrl = new URL(targetUrl);
		err.requestHost = parsedUrl.host;
		err.requestPathTemplate = parsedUrl.pathname
			.replace(/\/users\/[^/]+\//, '/users/me/')
			.replace(/\/messages\/[^/]+$/, '/messages/:id');
		throw err;
	}
	return body;
}

async function listGmailApiMessages(c, accessToken, limit) {
	let context = c;
	let token = accessToken;
	let lim = limit;
	if (typeof c === 'string') {
		context = null;
		token = c;
		lim = accessToken;
	}
	const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
	listUrl.searchParams.set('maxResults', String(lim));
	// The mailbox's most-recent state is already the first page. Avoid a Gmail
	// search-expression dependency: it can produce account-specific 404s and
	// silently excludes mail older than the arbitrary 90-day window.
	const list = await gmailApiJson(context, listUrl.toString(), token, 'list_messages');
	return (Array.isArray(list.messages) ? list.messages : [])
		.filter(message => message?.id)
		.slice(0, lim);
}

async function gmailProfile(c, accessToken) {
	return await gmailApiJson(c, 'https://gmail.googleapis.com/gmail/v1/users/me/profile', accessToken, 'profile');
}

async function gmailLabelsProbe(c, accessToken) {
	return await gmailApiJson(c, 'https://gmail.googleapis.com/gmail/v1/users/me/labels?maxResults=1', accessToken, 'labels_probe');
}

async function listGmailHistoryDelta(c, accessToken, historyCursor, limit) {
	if (!historyCursor) return null;
	const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
	url.searchParams.set('startHistoryId', String(historyCursor));
	url.searchParams.set('historyTypes', 'messageAdded');
	url.searchParams.set('maxResults', String(limit));
	try {
		const body = await gmailApiJson(c, url.toString(), accessToken, 'history');
		const messages = (body.history || []).flatMap(row => row.messagesAdded || []).map(row => row.message).filter(row => row?.id);
		return { messages, nextHistoryId: body.historyId || historyCursor, expired: false };
	} catch (error) {
		if (Number(error?.httpStatus) === 404) return { messages: [], nextHistoryId: null, expired: true };
		throw error;
	}
}

async function persistProviderFreshness(c, userId, accountId, patch = {}) {
	await c.env.db.prepare(
		`INSERT INTO gmail_provider_freshness (account_id, user_id, history_cursor, provider_connected, oauth_valid, token_refresh_valid, last_provider_check_at, last_delta_sync_at, last_worker_ingest_at, last_provider_message_id, last_provider_message_time, last_ledger_message_time, sync_health, provider_status, failure_reason, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, CURRENT_TIMESTAMP)
		 ON CONFLICT(account_id) DO UPDATE SET history_cursor=COALESCE(excluded.history_cursor, history_cursor), provider_connected=excluded.provider_connected, oauth_valid=excluded.oauth_valid, token_refresh_valid=excluded.token_refresh_valid, last_provider_check_at=excluded.last_provider_check_at, last_delta_sync_at=COALESCE(excluded.last_delta_sync_at,last_delta_sync_at), last_worker_ingest_at=COALESCE(excluded.last_worker_ingest_at,last_worker_ingest_at), last_provider_message_id=COALESCE(excluded.last_provider_message_id,last_provider_message_id), last_provider_message_time=COALESCE(excluded.last_provider_message_time,last_provider_message_time), last_ledger_message_time=COALESCE(excluded.last_ledger_message_time,last_ledger_message_time), sync_health=excluded.sync_health, provider_status=excluded.provider_status, failure_reason=excluded.failure_reason, updated_at=CURRENT_TIMESTAMP`
	).bind(accountId, userId, patch.historyCursor || null, patch.providerConnected ? 1 : 0, patch.oauthValid ? 1 : 0, patch.tokenRefreshValid ? 1 : 0, patch.providerCheckAt || new Date().toISOString(), patch.deltaSyncAt || null, patch.workerIngestAt || null, patch.providerMessageId || null, patch.providerMessageTime || null, patch.ledgerMessageTime || null, patch.health || 'unknown', patch.providerStatus || 'unknown', patch.failureReason || null).run();
}

async function recordGmailProvenance(c, userId, account, credential, oauth, patch = {}) {
	const intendedIdentityHash = await sha256Hex(String(account.email || '').trim().toLowerCase());
	const authorizedIdentityHash = await sha256Hex(String(oauth.google_account_email || '').trim().toLowerCase());
	const authorizedSubjectHash = await sha256Hex(String(oauth.google_subject_id || ''));
	const canonicalScopes = String(oauth.scope || '').split(/[\s,]+/).filter(Boolean).sort();
	const requestedScopes = String(c.env.GOOGLE_MAILBOX_OAUTH_SCOPES || '').split(/[\s,]+/).filter(Boolean).sort();
	const clientId = String(c.env.GOOGLE_OAUTH_CLIENT_ID || '');
	const clientProject = clientId.includes('-') ? clientId.split('-')[0] : clientId;
	const providerError = patch.googleError || {};
	const identityMatch = Boolean(
		String(account.email || '').trim().toLowerCase() === String(oauth.google_account_email || '').trim().toLowerCase()
		&& (!account.external_account_id || String(account.external_account_id) === String(oauth.google_subject_id || ''))
	);
	await c.env.db.prepare(
		`INSERT INTO gmail_provider_freshness (
			account_id, user_id, provider_operation, upstream_service, provider_http_status,
			normalized_failure_code, credential_reference_id, credential_generation,
			intended_identity_hash, authorized_identity_hash, authorized_subject_hash, identity_match,
			oauth_client_fingerprint, oauth_project_fingerprint, requested_scope_fingerprint, granted_scope_fingerprint,
			granted_gmail_readonly, granted_gmail_send, request_method, request_host, request_path_template,
			request_user_selector, request_authorization_present, google_error_status, google_error_domain,
			google_error_reason, google_error_location_type, google_error_location, google_error_message_class
		 ) VALUES (?1, ?2, ?3, 'gmail.googleapis.com', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, 'me', 1, ?21, ?22, ?23, ?24, ?25, ?26)
		 ON CONFLICT(account_id) DO UPDATE SET
			provider_operation = excluded.provider_operation,
			upstream_service = excluded.upstream_service,
			provider_http_status = excluded.provider_http_status,
			normalized_failure_code = excluded.normalized_failure_code,
			credential_reference_id = excluded.credential_reference_id,
			credential_generation = excluded.credential_generation,
			intended_identity_hash = excluded.intended_identity_hash,
			authorized_identity_hash = excluded.authorized_identity_hash,
			authorized_subject_hash = excluded.authorized_subject_hash,
			identity_match = excluded.identity_match,
			oauth_client_fingerprint = excluded.oauth_client_fingerprint,
			oauth_project_fingerprint = excluded.oauth_project_fingerprint,
			requested_scope_fingerprint = excluded.requested_scope_fingerprint,
			granted_scope_fingerprint = excluded.granted_scope_fingerprint,
			granted_gmail_readonly = excluded.granted_gmail_readonly,
			granted_gmail_send = excluded.granted_gmail_send,
			request_method = excluded.request_method,
			request_host = excluded.request_host,
			request_path_template = excluded.request_path_template,
			request_user_selector = excluded.request_user_selector,
			request_authorization_present = excluded.request_authorization_present,
			google_error_status = excluded.google_error_status,
			google_error_domain = excluded.google_error_domain,
			google_error_reason = excluded.google_error_reason,
			google_error_location_type = excluded.google_error_location_type,
			google_error_location = excluded.google_error_location,
			google_error_message_class = excluded.google_error_message_class,
			updated_at = CURRENT_TIMESTAMP`
	).bind(account.account_id, userId, patch.operation || 'profile', patch.httpStatus || null,
		patch.failureCode || null, credential.id, Number(account.oauth_authorization_generation || 0),
		intendedIdentityHash, authorizedIdentityHash, authorizedSubjectHash, identityMatch ? 1 : 0,
		await sha256Hex(clientId), await sha256Hex(clientProject), await sha256Hex(requestedScopes.join(' ')), await sha256Hex(canonicalScopes.join(' ')),
		canonicalScopes.includes('https://www.googleapis.com/auth/gmail.readonly') ? 1 : 0,
		canonicalScopes.includes('https://www.googleapis.com/auth/gmail.send') ? 1 : 0,
		patch.requestMethod || 'GET', patch.requestHost || 'gmail.googleapis.com', patch.requestPathTemplate || '/gmail/v1/users/me/profile',
		providerError.status || null, providerError.domain || null, providerError.reason || null,
		providerError.locationType || null, providerError.location || null, providerError.messageClass || null).run();
	return identityMatch;
}

async function recordGmailIndependentProbe(c, userId, accountId, probe) {
	const providerError = probe.googleError || {};
	await c.env.db.prepare(
		`UPDATE gmail_provider_freshness
		    SET independent_operation = 'labels_probe', independent_http_status = ?3,
		        independent_google_error_status = ?4, independent_google_error_domain = ?5,
		        independent_google_error_reason = ?6, independent_message_class = ?7,
		        updated_at = CURRENT_TIMESTAMP
		  WHERE account_id = ?1 AND user_id = ?2`
	).bind(accountId, userId, probe.httpStatus || 200, providerError.status || null, providerError.domain || null,
		providerError.reason || null, providerError.messageClass || null).run();
}

async function prepareGmailApiParsedMessages(fetched, parseFn = raw => PostalMime.parse(raw)) {
	const prepared = [];
	let parseFailed = 0;
	let oversized = 0;
	for (const item of Array.isArray(fetched) ? fetched : []) {
		try {
			if (rawByteLength(item.raw) > MAX_MESSAGE_BYTES) {
				oversized += 1;
				console.warn(`Gmail API message ${item.gmailId} exceeds ${MAX_MESSAGE_BYTES} bytes, skipping.`);
				continue;
			}
			const parsed = await parseFn(item.raw);
			const parsedMessageId = await externalMessageId(parsed, item.raw);
			const messageId = parsedMessageId || `gmail-api:${item.gmailId}`;
			prepared.push({ item, parsed, messageId });
		} catch (e) {
			parseFailed += 1;
			console.warn(`Gmail API message parse failed (${item.gmailId}), skipping:`, String(e?.message || e).slice(0, 160));
		}
	}
	return { prepared, parseFailed, oversized };
}

async function fetchGmailApiMetadataMessage(c, accessToken, message) {
	let context = c;
	let token = accessToken;
	let msg = message;
	if (typeof c === 'string') {
		context = null;
		token = c;
		msg = accessToken;
	}
	const getUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msg.id)}`);
	getUrl.searchParams.set('format', 'full');
	return await gmailApiJson(context, getUrl.toString(), token, 'get_message_metadata');
}

// Gmail history can legitimately contain a reference to a message that is
// deleted between the history/list response and its metadata read. Confirm the
// 404 twice before treating it as a provider tombstone. A non-404 second result
// remains a hard failure, so a live message is never silently discarded.
async function fetchGmailApiMessageWithTombstoneRecovery(c, accessToken, message) {
	try {
		return { detail: await fetchGmailApiMetadataMessage(c, accessToken, message), deletedBeforeFetch: false };
	} catch (firstError) {
		if (Number(firstError?.httpStatus || 0) !== 404) throw firstError;
		try {
			return { detail: await fetchGmailApiMetadataMessage(c, accessToken, message), deletedBeforeFetch: false };
		} catch (secondError) {
			if (Number(secondError?.httpStatus || 0) === 404) return { detail: null, deletedBeforeFetch: true };
			throw secondError;
		}
	}
}

function getHeader(headers, name) {
	const match = (headers || []).find(h => String(h.name).toLowerCase() === String(name).toLowerCase());
	return match ? match.value : '';
}

function parseEmailAndName(headerStr) {
	if (!headerStr) return { address: '', name: '' };
	const match = headerStr.match(/^(.*?)\s*<([^>]+)>/);
	if (match) {
		return {
			name: match[1].replace(/^["']|["']$/g, '').trim(),
			address: match[2].trim().toLowerCase()
		};
	}
	return { name: '', address: headerStr.trim().toLowerCase() };
}

function parseRecipientList(headerStr) {
	if (!headerStr) return [];
	const parts = headerStr.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
	return parts.map(p => {
		const parsed = parseEmailAndName(p);
		return { address: parsed.address, name: parsed.name };
	}).filter(r => r.address);
}

function extractBodies(payload) {
	let text = '';
	let html = '';
	function walk(part) {
		if (part.mimeType === 'text/plain' && part.body?.data) {
			try { text = new TextDecoder().decode(base64UrlDecode(part.body.data)); } catch {}
		} else if (part.mimeType === 'text/html' && part.body?.data) {
			try { html = new TextDecoder().decode(base64UrlDecode(part.body.data)); } catch {}
		}
		if (part.parts) {
			for (const p of part.parts) walk(p);
		}
	}
	if (payload) walk(payload);
	return { text, html };
}

function extractAttachmentsMetadata(payload) {
	const attachments = [];
	function walk(part) {
		if (part.filename && part.body?.attachmentId) {
			attachments.push({
				attachmentId: part.body.attachmentId,
				filename: part.filename,
				mimeType: part.mimeType || 'application/octet-stream',
				size: Number(part.body.size || 0)
			});
		}
		if (part.parts) {
			for (const p of part.parts) walk(p);
		}
	}
	if (payload) walk(payload);
	return attachments;
}

// RC-5: OAuth/Gmail-API historical backfill page. Unlike the forward list
// (newer_than:90d), this walks the FULL mailbox newest->older via the list API
// pageToken so it reaches history older than the forward window. Returns ONE bounded
// page plus the nextPageToken; the caller persists that token to account.backfill_cursor
// and sets account.backfill_done when the API returns no further page. Overlap with the
// forward window is deduped by external_message_id / gmail_uid_cache, so it is harmless.
async function listGmailApiBackfillPage(c, accessToken, limit, pageToken) {
	let context = c;
	let token = accessToken;
	let lim = limit;
	let page = pageToken;
	if (typeof c === 'string') {
		context = null;
		token = c;
		lim = accessToken;
		page = limit;
	}
	const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
	listUrl.searchParams.set('maxResults', String(lim));
	if (page) listUrl.searchParams.set('pageToken', page);
	const list = await gmailApiJson(context, listUrl.toString(), token, 'backfill_list');
	const messages = (Array.isArray(list.messages) ? list.messages : [])
		.filter(message => message?.id)
		.slice(0, lim);
	return { messages, nextPageToken: list.nextPageToken || '' };
}

// Ingest a list of Gmail-API {id,...} refs
async function ingestGmailApiMessages(c, userId, accountId, account, accessToken, listed) {
	const refs = Array.isArray(listed) ? listed.filter(message => message?.id) : [];
	if (refs.length === 0) return { synced: 0, skipped: 0, cacheReused: 0, fetchedCount: 0, unavailable: 0 };
	const cachedApiIds = await cachedGmailApiMessageIds(c, userId, accountId, refs.map(message => message.id));
	const fetched = [];
	let cacheReused = 0;
	let unavailable = 0;
	let deletedBeforeFetch = 0;
	for (const message of refs) {
		if (cachedApiIds.has(`gmail-api:${message.id}`)) {
			cacheReused += 1;
			continue;
		}
		if (c && c.subrequests && c.subrequests >= 38) {
			console.warn(`Gmail API ingest break early: subrequest limit reached (${c.subrequests})`);
			break;
		}
		try {
			const recovered = await fetchGmailApiMessageWithTombstoneRecovery(c, accessToken, message);
			if (recovered.deletedBeforeFetch) {
				deletedBeforeFetch += 1;
				continue;
			}
			const detail = recovered.detail;
			if (detail) fetched.push(detail);
		} catch (error) {
			if (Number(error?.httpStatus || 0) === 404) {
				unavailable += 1;
				continue;
			}
			throw error;
		}
	}

	const known = await existingMessageIdSet(c, userId, accountId, ['gmail', 'google_workspace'], fetched.map(f => getHeader(f.payload?.headers || [], 'message-id') || `gmail-api:${f.id}`));

	let synced = 0, skipped = 0;
	for (const detail of fetched) {
		const headers = detail.payload?.headers || [];
		const messageId = getHeader(headers, 'message-id') || `gmail-api:${detail.id}`;
		try {
			if (known.has(messageId)) {
				await rememberGmailApiMessage(c, userId, accountId, detail.id);
				cacheReused += 1;
				continue;
			}

			const fromHeader = getHeader(headers, 'from');
			const toHeader = getHeader(headers, 'to');
			const ccHeader = getHeader(headers, 'cc');
			const bccHeader = getHeader(headers, 'bcc');

			const parsedFrom = parseEmailAndName(fromHeader);
			const parsedTo = parseEmailAndName(toHeader);
			const parsedCc = parseRecipientList(ccHeader);
			const parsedBcc = parseRecipientList(bccHeader);
			const parsedToAll = parseRecipientList(toHeader);

			const fromAddress = parsedFrom.address || '';
			const toAddress = parsedTo.address || account.email;

			const inReplyTo = getHeader(headers, 'in-reply-to');
			const references = getHeader(headers, 'references');

			const { text, html } = extractBodies(detail.payload);
			const attachmentsMetadata = extractAttachmentsMetadata(detail.payload);

			const inserted = await c.env.db.prepare(
				`INSERT INTO email
				 (send_email, name, account_id, user_id, subject, text, content, cc, bcc,
				  recipient, to_email, to_name, in_reply_to, relation, message_id, type,
				  status, unread, provider, account_email, account_domain, thread_id,
				  external_message_id, create_time, is_del)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
				         ?10, ?11, ?12, ?13, ?14, ?15, ?16,
				         ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
				`
			).bind(
				fromAddress,
				parsedFrom.name || emailUtils.getName(fromAddress),
				accountId,
				userId,
				getHeader(headers, 'subject') || '',
				text || detail.snippet || '',
				html || '',
				JSON.stringify(parsedCc),
				JSON.stringify(parsedBcc),
				JSON.stringify(parsedToAll),
				toAddress,
				parsedTo.name || emailUtils.getName(toAddress),
				inReplyTo,
				references,
				messageId,
				emailConst.type.RECEIVE,
				emailConst.status.RECEIVE,
				(detail.labelIds || []).includes('UNREAD') ? 1 : 0,
				account.provider || 'gmail',
				account.email,
				account.domain || emailUtils.getDomain(account.email),
				detail.threadId || inReplyTo || references || messageId,
				messageId,
				normalizeReceivedDate(detail.internalDate ? new Date(Number(detail.internalDate)).toISOString() : new Date().toISOString()),
				isDel.NORMAL
			).run();

			const emailId = Number(inserted.meta?.last_row_id || 0);
			if (!emailId) throw new Error('Gmail ledger insert returned no email id.');
			known.add(messageId);
			await rememberGmailApiMessage(c, userId, accountId, detail.id, emailId);

			if (attachmentsMetadata.length > 0) {
				const attachments = attachmentsMetadata.map(att => ({
					userId,
					emailId,
					accountId,
					key: `gmail-att:${accountId}:${detail.id}:${att.attachmentId}`,
					filename: att.filename,
					mimeType: att.mimeType,
					size: att.size,
					status: '0',
					type: 0,
					disposition: 'attachment'
				}));
				await attService.addAtt(c, attachments);
			}
			synced += 1;
		} catch (e) {
			skipped += 1;
			console.warn(`Gmail API message store failed (${messageId}), continuing:`, String(e?.message || e).slice(0, 160));
		}
	}
	return { synced, skipped, cacheReused, fetchedCount: fetched.length, unavailable, deletedBeforeFetch, parseFailed: 0, oversized: 0 };
}

async function normalizeAttachments(parsed, emailId, userId, accountId) {
	const attachments = [];
	for (const item of parsed.attachments || []) {
		if (!item?.content) continue;
		const filename = item.filename || 'attachment';
		const content = item.content;
		attachments.push({
			...item,
			filename,
			content,
			key: constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(content) + fileUtils.getExtFileName(filename),
			size: content.length ?? content.byteLength ?? 0,
			emailId,
			userId,
			accountId
		});
	}
	return attachments;
}

// WF-10 / WP-F: schema for these tables now lives in migration 0016. These
// helpers are retained as no-ops so existing call sites keep working without
// issuing per-sync DDL round-trips. Safe to remove once all callers are updated.
async function ensureGmailUidCache(_c) { /* moved to migration 0016 */ }
async function ensureGmailSyncRunTables(_c) { /* moved to migration 0016 */ }

// Batched duplicate lookup (WF-10 / WP-F N+1 reduction): fetch all already-known
// external_message_ids for this account in ONE query instead of one SELECT per
// message. Returns a Set for O(1) in-memory membership checks.
async function existingMessageIdSet(c, userId, accountId, providers, messageIds) {
	const ids = [...new Set(messageIds.filter(Boolean))];
	if (ids.length === 0) return new Set();
	const found = new Set();
	// D1 only accepts numbered bind variables through ?100. Keep chunks below that
	// after user/account/provider fixed params are added.
	const CHUNK = 80;
	for (let i = 0; i < ids.length; i += CHUNK) {
		const slice = ids.slice(i, i + CHUNK);
		const providerPlaceholders = providers.map((_, idx) => `?${idx + 3}`).join(', ');
		const idPlaceholders = slice.map((_, idx) => `?${providers.length + 3 + idx}`).join(', ');
		const rows = await c.env.db.prepare(
			`SELECT external_message_id FROM email
			  WHERE user_id = ?1 AND account_id = ?2
			    AND provider IN (${providerPlaceholders})
			    AND external_message_id IN (${idPlaceholders})`
		).bind(userId, accountId, ...providers, ...slice).all();
		for (const r of rows?.results || []) found.add(r.external_message_id);
	}
	return found;
}

async function lastCachedUid(c, userId, accountId, mailbox, validity) {
	const row = await c.env.db.prepare(
		`SELECT COALESCE(MAX(uid), 0) AS uid
		   FROM gmail_uid_cache
		  WHERE user_id = ?1
		    AND account_id = ?2
		    AND mailbox = ?3
		    AND uid_validity = ?4`
	).bind(userId, accountId, mailbox, validity).first();
	return Number(row?.uid || 0);
}

// RC-5: lowest cached UID = the backfill low-water. MIN over the same key the forward
// high-water (lastCachedUid) uses, so backfill walks older history down toward UID 1.
async function lowCachedUid(c, userId, accountId, mailbox, validity) {
	const row = await c.env.db.prepare(
		`SELECT MIN(uid) AS uid
		   FROM gmail_uid_cache
		  WHERE user_id = ?1
		    AND account_id = ?2
		    AND mailbox = ?3
		    AND uid_validity = ?4
		    AND uid > 0`
	).bind(userId, accountId, mailbox, validity).first();
	return Number(row?.uid || 0);
}

async function rememberUid(c, userId, accountId, mailbox, validity, uid, messageId, emailId = null) {
	if (!uid) return;
	await c.env.db.prepare(
		`INSERT INTO gmail_uid_cache
		 (user_id, account_id, mailbox, uid_validity, uid, external_message_id, email_id)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
		 ON CONFLICT(user_id, account_id, mailbox, uid_validity, uid) DO UPDATE SET
		   external_message_id = COALESCE(NULLIF(excluded.external_message_id, ''), gmail_uid_cache.external_message_id),
		   email_id = COALESCE(excluded.email_id, gmail_uid_cache.email_id),
		   updated_at = CURRENT_TIMESTAMP`
	).bind(userId, accountId, mailbox, validity, uid, messageId || '', emailId).run();
}

async function cachedGmailApiMessageIds(c, userId, accountId, gmailIds) {
	const keys = [...new Set(gmailIds.filter(Boolean).map(id => `gmail-api:${id}`))];
	if (keys.length === 0) return new Set();
	const found = new Set();
	const CHUNK = 80;
	for (let i = 0; i < keys.length; i += CHUNK) {
		const slice = keys.slice(i, i + CHUNK);
		const placeholders = slice.map((_, idx) => `?${idx + 5}`).join(', ');
		const rows = await c.env.db.prepare(
			`SELECT external_message_id FROM gmail_uid_cache
			  WHERE user_id = ?1
			    AND account_id = ?2
			    AND mailbox = ?3
			    AND uid_validity = ?4
			    AND external_message_id IN (${placeholders})`
		).bind(userId, accountId, GMAIL_API_CACHE_MAILBOX, GMAIL_API_UID_VALIDITY, ...slice).all();
		for (const row of rows?.results || []) found.add(row.external_message_id);
	}
	return found;
}

async function rememberGmailApiMessage(c, userId, accountId, gmailId, emailId = null) {
	if (!gmailId) return;
	const key = `gmail-api:${gmailId}`;
	await rememberUid(c, userId, accountId, GMAIL_API_CACHE_MAILBOX, GMAIL_API_UID_VALIDITY, stableCacheUid(key), key, emailId);
}

async function latestGmailLedgerEvidence(c, userId, accountId) {
	const row = await c.env.db.prepare(
		`SELECT e.email_id AS emailId,
		        e.account_id AS accountId,
		        e.provider AS provider,
		        e.account_email AS accountEmail,
		        e.create_time AS newestMessageTime,
		        e.external_message_id AS externalMessageId,
		        a.sync_status AS syncStatus,
		        a.last_synced_at AS lastProviderSync,
		        a.last_progress_at AS lastProgressAt,
		        a.sync_error AS syncError
		   FROM email e
		   JOIN account a
		     ON a.account_id = e.account_id
		    AND a.user_id = e.user_id
		  WHERE e.user_id = ?1
		    AND e.account_id = ?2
		    AND e.provider IN ('gmail', 'google_workspace')
		    AND e.type = ?3
		    AND e.is_del = 0
		  ORDER BY e.email_id DESC
		  LIMIT 1`
	).bind(userId, accountId, emailConst.type.RECEIVE).first();
	if (row) return row;
	const account = await c.env.db.prepare(
		`SELECT account_id AS accountId,
		        provider,
		        email AS accountEmail,
		        sync_status AS syncStatus,
		        last_synced_at AS lastProviderSync,
		        last_progress_at AS lastProgressAt,
		        sync_error AS syncError
		   FROM account
		  WHERE user_id = ?1 AND account_id = ?2
		  LIMIT 1`
	).bind(userId, accountId).first();
	return {
		emailId: 0,
		accountId,
		provider: account?.provider || 'gmail',
		accountEmail: account?.accountEmail || '',
		newestMessageTime: null,
		externalMessageId: null,
		syncStatus: account?.syncStatus || 'unknown',
		lastProviderSync: account?.lastProviderSync || null,
		lastProgressAt: account?.lastProgressAt || null,
		syncError: account?.syncError || null
	};
}

const gmailImapService = {
	async diagnose() {
		return gmailSocketDiagnostic();
	},

	async connect(c, userId, params) {
		const email = normalizeEmail(params.email);
		const domain = emailUtils.getDomain(email);
		const appPassword = String(params.appPassword || params.password || '').replace(/\s+/g, '');
		if (!email.endsWith('@gmail.com') && !email.endsWith('@googlemail.com')) {
			throw new Error('Only Gmail IMAP accounts are supported in this milestone.');
		}
		if (appPassword.length < 12) {
			throw new Error('Gmail App Password is required.');
		}

		await withGmail(email, appPassword, async client => {
			await command(client, 'SELECT INBOX');
			return true;
		});

		const existing = await c.env.db.prepare(
			`SELECT account_id FROM account
			  WHERE user_id = ?1 AND provider = 'gmail' AND email = ?2 COLLATE NOCASE AND is_del = 0
			  LIMIT 1`
		).bind(userId, email).first();

		let accountId = existing?.account_id;
		if (!accountId) {
			const inserted = await c.env.db.prepare(
				`INSERT INTO account
				 (email, name, user_id, provider, domain, sync_status, all_receive, sort, is_del)
				 VALUES (?1, ?2, ?3, 'gmail', ?4, 'sync_required', 1, 0, 0)`
			).bind(email, emailUtils.getName(email), userId, domain).run();
			accountId = inserted.meta?.last_row_id;
		} else {
			await c.env.db.prepare(
				`UPDATE account
				    SET domain = ?3,
				        sync_status = 'sync_required',
				        sync_error = NULL,
				        sync_error_class = NULL,
				        next_attempt_at = datetime('now')
				  WHERE account_id = ?1 AND user_id = ?2`
			).bind(accountId, userId, domain).run();
		}

		const credential = await encrypt(c, appPassword);
		await c.env.db.prepare(
			`INSERT INTO mail_provider_credentials
			 (user_id, account_id, provider, email, credential_ciphertext)
			 VALUES (?1, ?2, 'gmail', ?3, ?4)
			 ON CONFLICT(user_id, provider, email) DO UPDATE SET
			   account_id = excluded.account_id,
			   credential_ciphertext = excluded.credential_ciphertext,
			   updated_at = CURRENT_TIMESTAMP`
		).bind(userId, accountId, email, credential).run();

		const geminiAuthorization = await geminiOAuthService.mailboxAuthorizationStatus(c, userId, {
			provider: 'gmail',
			email
		});
		return {
			accountId,
			email,
			provider: 'gmail',
			status: 'connected',
			syncStatus: 'sync_required',
			synced: 0,
			geminiAuthorization
		};
	},

	async sync(c, userId, params = {}) {
		const accountId = Number(params.accountId);
		// A Gmail REST import needs profile/history/list plus one request per message.
		// Keep one transaction below the Worker subrequest ceiling so later accounts
		// cannot be discovered then silently starved before persistence.
		const limit = Math.min(Math.max(Number(params.limit || 20), 1), 20);
		const mailbox = 'INBOX';
		const account = await c.env.db.prepare(
			`SELECT * FROM account
			  WHERE account_id = ?1
			    AND user_id = ?2
			    AND provider IN ('gmail', 'google_workspace')
			    AND is_del = 0`
		).bind(accountId, userId).first();
		if (!account) throw new Error('Gmail account is not connected.');
		const oauthAuthorizationGeneration = Number(account.oauth_authorization_generation || 0);
		await c.env.db.prepare(
			`UPDATE account SET last_sync_attempt_at = CURRENT_TIMESTAMP WHERE account_id = ?1 AND user_id = ?2`
		).bind(accountId, userId).run();

		const credential = await c.env.db.prepare(
			`SELECT id, credential_ciphertext FROM mail_provider_credentials
			  WHERE user_id = ?1
			    AND account_id = ?2
			    AND provider IN ('gmail', 'google_workspace')
			  LIMIT 1`
		).bind(userId, accountId).first();
		if (!credential) throw new Error('Gmail credential is missing.');

		if (isOAuthCredential(credential.credential_ciphertext)) {
			let oauth = null;
			let authorizedIdentityMatch = null;
			try {
				await assertCurrentOAuthAuthorizationGeneration(c, userId, accountId, oauthAuthorizationGeneration);
				oauth = await loadOAuthCredential(c, credential);
				authorizedIdentityMatch = await recordGmailProvenance(c, userId, account, credential, oauth, { operation: 'profile' });
				if (!authorizedIdentityMatch) {
					const mismatch = new Error('Google authorization belongs to a different mailbox identity.');
					mismatch.category = 'identity_mismatch';
					mismatch.reason = 'authorized_identity_mismatch';
					throw mismatch;
				}
				const previous = await c.env.db.prepare(`SELECT history_cursor FROM gmail_provider_freshness WHERE account_id = ?1 AND user_id = ?2`).bind(accountId, userId).first();
				let profile;
				try {
					profile = await gmailProfile(c, oauth.access_token);
					await recordGmailProvenance(c, userId, account, credential, oauth, { operation: 'profile', httpStatus: 200 });
				} catch (profileError) {
					// Some otherwise usable Gmail identities return NOT_FOUND from the profile
					// resource while the mailbox API itself remains available. A successful,
					// independent labels probe is sufficient for read-only mailbox access, but
					// cannot fabricate the profile historyId: the sync safely uses list/history
					// or a bounded list fallback instead.
					if (authorizedIdentityMatch !== true || Number(profileError?.httpStatus || 0) !== 404) throw profileError;
					await recordGmailProvenance(c, userId, account, credential, oauth, {
						operation: 'profile', httpStatus: profileError.httpStatus,
						failureCode: profileError.category || 'provider_error', googleError: profileError.googleError
					});
					try {
						await gmailLabelsProbe(c, oauth.access_token);
						await recordGmailIndependentProbe(c, userId, accountId, { httpStatus: 200 });
						profile = { historyId: null, source: 'labels_probe_fallback' };
					} catch (probeError) {
						await recordGmailIndependentProbe(c, userId, accountId, {
							httpStatus: probeError?.httpStatus || 0, googleError: probeError?.googleError
						}).catch(() => {});
						throw profileError;
					}
				}
				const delta = await listGmailHistoryDelta(c, oauth.access_token, previous?.history_cursor, limit);
				const listed = delta?.expired || !delta ? await listGmailApiMessages(c, oauth.access_token, limit) : delta.messages;
				await assertCurrentOAuthAuthorizationGeneration(c, userId, accountId, oauthAuthorizationGeneration);
				const forward = await ingestGmailApiMessages(c, userId, accountId, account, oauth.access_token, listed);
				await assertCurrentOAuthAuthorizationGeneration(c, userId, accountId, oauthAuthorizationGeneration);
				const evidence = await latestGmailLedgerEvidence(c, userId, accountId);
				const providerHasUnpersistedMessage = (listed.length > 0 && forward.synced === 0 && forward.cacheReused === 0)
					|| Number(forward.unavailable || 0) > 0;
				await persistProviderFreshness(c, userId, accountId, {
					// A partial page must never advance the history checkpoint. Preserving the
					// prior cursor forces a later recovery to revisit the incomplete interval.
					historyCursor: providerHasUnpersistedMessage ? null : (delta?.nextHistoryId || profile.historyId || null),
					providerConnected: true, oauthValid: true, tokenRefreshValid: true,
					deltaSyncAt: new Date().toISOString(), workerIngestAt: forward.synced > 0 ? new Date().toISOString() : null,
					providerMessageId: listed[0]?.id || null, ledgerMessageTime: evidence?.newestMessageTime || null,
					health: providerHasUnpersistedMessage ? 'stale' : (delta?.expired ? 'recovered_history_expired' : 'fresh'),
					providerStatus: providerHasUnpersistedMessage ? 'provider_message_not_ingested' : 'synced',
					failureReason: providerHasUnpersistedMessage ? 'Provider returned message references but no message was fetched, cached, or inserted.' : null
				});
				if (providerHasUnpersistedMessage) {
					await c.env.db.prepare(`UPDATE account SET sync_status='sync_required', sync_error=?3, next_attempt_at=datetime('now') WHERE account_id=?1 AND user_id=?2`)
						.bind(accountId, userId, 'Provider returned Gmail message references that were not fully retrievable; recovery will retry without advancing the checkpoint.').run();
					throw Object.assign(new Error('Provider returned Gmail message references that were not fully retrievable.'), { category: 'ingest_gap', reason: 'provider_message_not_ingested' });
				}

				// RC-5: bounded OAuth/API historical backfill (migration 0021 consumer).
				// Keep it in a separate heavy path from forward sync: when the forward
				// phase fetched raw messages, defer backfill to a later invocation so the
				// two per-message Gmail/D1 loops cannot exceed the Worker subrequest cap.
				let back = { synced: 0, skipped: 0, cacheReused: 0, fetchedCount: 0 };
				const backfillLimit = Math.min(Math.max(Number(params.backfillLimit || 10), 0), Math.min(limit, 25));
				if (c && c.subrequests && c.subrequests >= 35) {
					console.warn('Gmail API backfill skipped in this run: subrequest budget exhausted');
				} else if (('backfill_done' in account) && !account.backfill_done && backfillLimit > 0) {
					try {
						const page = await listGmailApiBackfillPage(c, oauth.access_token, backfillLimit, account.backfill_cursor || '');
						back = await ingestGmailApiMessages(c, userId, accountId, account, oauth.access_token, page.messages);
						const nextCursor = page.nextPageToken || '';
						await c.env.db.prepare(
							`UPDATE account
							    SET backfill_cursor = ?3, backfill_done = ?4
							  WHERE account_id = ?1 AND user_id = ?2`
						).bind(accountId, userId, nextCursor || null, nextCursor ? 0 : 1).run();
					} catch (e) {
						console.warn(`Gmail API backfill failed (account ${accountId}); forward sync unaffected:`, String(e?.message || e).slice(0, 160));
					}
				}

				const completion = await c.env.db.prepare(
					`UPDATE account
					    SET sync_status = ?3, sync_error = NULL, sync_error_class = NULL,
					        sync_attempts = 0, next_attempt_at = NULL, last_synced_at = CURRENT_TIMESTAMP,
					        last_successful_sync_at = CURRENT_TIMESTAMP,
					        last_provider_checkpoint_at = CURRENT_TIMESTAMP,
					        last_message_received_at = COALESCE(?4, last_message_received_at),
					        last_sync_failure_at = NULL, sync_failure_reason = NULL
					  WHERE account_id = ?1 AND user_id = ?2 AND oauth_authorization_generation = ?5`
				).bind(accountId, userId, await mailboxLifecycleAfterImport(c, userId, accountId), evidence?.newestMessageTime || null, oauthAuthorizationGeneration).run();
				if (Number(completion.meta?.changes || 0) !== 1) {
					const stale = new Error('Gmail sync result was superseded by a newer authorization.');
					stale.category = 'stale_authorization_generation';
					stale.reason = 'oauth_reconnect_superseded_sync';
					throw stale;
				}
				await googleTestUserRequestService.recordFirstSync(c, account.email);
				return {
					accountId,
					email: account.email,
					provider: account.provider || 'gmail',
					synced: forward.synced + back.synced,
					skipped: forward.skipped + back.skipped,
					cacheReused: forward.cacheReused + back.cacheReused,
					fetched: forward.fetchedCount + back.fetchedCount
				};
			} catch (error) {
				if (oauth && error?.httpStatus) {
					await recordGmailProvenance(c, userId, account, credential, oauth, {
						operation: error.operation || 'profile', httpStatus: error.httpStatus,
						failureCode: error.category || 'provider_error', googleError: error.googleError,
						requestMethod: 'GET', requestHost: error.requestHost, requestPathTemplate: error.requestPathTemplate
					}).catch(() => {});
					// A profile 404 is not sufficient to call a mailbox unavailable. Perform one
					// distinct, read-only Gmail API probe solely to distinguish an endpoint/path
					// defect from an account-specific Gmail service response. No mailbox content
					// is requested or persisted.
					if (authorizedIdentityMatch === true && Number(error.httpStatus) === 404) {
						try {
							await gmailLabelsProbe(c, oauth.access_token);
							await recordGmailIndependentProbe(c, userId, accountId, { httpStatus: 200 });
						} catch (probeError) {
							await recordGmailIndependentProbe(c, userId, accountId, {
								httpStatus: probeError?.httpStatus || 0,
								googleError: probeError?.googleError
							}).catch(() => {});
						}
					}
				}
				if (error?.category === 'stale_authorization_generation') throw error;
				const verifiedMailboxUnavailable = error?.category === 'provider_mailbox_unavailable'
					&& Number(error?.httpStatus || 0) === 404
					&& authorizedIdentityMatch === true
					&& String(error?.operation || '') === 'profile';
				if (error?.category === 'provider_mailbox_unavailable' && String(error?.operation || '') !== 'profile') {
					error.category = 'gmail_mail_data_unavailable';
					error.reason = 'gmail_mail_data_endpoint_not_found';
				}
				// The profile + identity proof already succeeded in this invocation. A
				// later listed-message miss must preserve that independent OAuth fact.
				// It remains a stale receive recovery, never a reconnect requirement.
				const verifiedRecoverableContentGap = authorizedIdentityMatch === true
					&& ['ingest_gap', 'gmail_mail_data_unavailable'].includes(String(error?.category || ''));
				await persistProviderFreshness(c, userId, accountId, {
					providerConnected: verifiedMailboxUnavailable || verifiedRecoverableContentGap,
					oauthValid: verifiedMailboxUnavailable || verifiedRecoverableContentGap,
					tokenRefreshValid: verifiedMailboxUnavailable || verifiedRecoverableContentGap,
					health: verifiedMailboxUnavailable ? 'blocked' : 'stale',
					providerStatus: verifiedMailboxUnavailable
						? 'mailbox_unavailable'
						: verifiedRecoverableContentGap ? 'content_recovery_required' : 'failed',
					failureReason: String(error?.reason || error?.message || error).slice(0, 160)
				}).catch(() => {});
				// RC-1: single-point failure routing (terminal -> needs_reconnect, transient ->
				// sync_required + backoff). account.sync_attempts is the pre-failure count.
				await routeSyncFailure(c, accountId, userId, error, account.sync_attempts);
				throw error;
			}
		}

		if (!params.allowLegacyImap) {
			await markLegacyImapNeedsReconnect(c, accountId, userId);
			const err = new Error(LEGACY_IMAP_UNSUPPORTED_MESSAGE);
			err.category = 'legacy_imap_unsupported';
			err.reason = 'google_oauth_required';
			throw err;
		}

		const appPassword = await decrypt(c, credential.credential_ciphertext);
		try {
			await ensureGmailUidCache(c);
			const fetched = await withGmail(account.email, appPassword, async client => {
				const selected = await command(client, `SELECT ${mailbox}`);
				const validity = uidValidity(selected);
				const lastUid = await lastCachedUid(c, userId, accountId, mailbox, validity);
				const searchText = lastUid > 0 ? `UID SEARCH UID ${lastUid + 1}:*` : 'UID SEARCH ALL';
				const search = await command(client, searchText);
				const forwardIds = (search.match(/\* SEARCH ([^\r\n]+)/)?.[1] || '')
					.trim()
					.split(/\s+/)
					.filter(Boolean)
					.slice(-limit);
				let ids = forwardIds;
				// RC-5: bounded backward backfill. When older history remains below the
				// low-water (minUid > 1), pull the newest `limit` UIDs strictly below it
				// this run; across runs minUid walks toward 1 and this yields nothing when
				// complete. UID-cache + external_message_id dedupe make overlap harmless.
				// Receive Reality V2: never mix backfill into a forward receive fetch.
				// A slow historical page must not block brand-new Gmail delivery from
				// Provider -> Import -> Global Message Ledger -> Inbox.
				const minUid = await lowCachedUid(c, userId, accountId, mailbox, validity);
				if (ids.length === 0 && minUid > 1) {
					const backfillSearch = await command(client, `UID SEARCH UID 1:${minUid - 1}`);
					ids = (backfillSearch.match(/\* SEARCH ([^\r\n]+)/)?.[1] || '')
						.trim()
						.split(/\s+/)
						.filter(Boolean)
						.slice(-Math.min(limit, 10));
				}
				if (!ids.length) return [];
				const fetch = await commandBytes(client, `UID FETCH ${ids.join(',')} (UID BODY.PEEK[])`);
				return literalFetchedMessages(fetch).map(message => ({ ...message, uidValidity: validity }));
			});

			// Parse + compute ids first (with byte cap + per-message isolation),
			// then batch the duplicate lookup (WF-10 N+1 reduction).
			const prepared = [];
			for (const item of fetched) {
				try {
					if (rawByteLength(item.raw) > MAX_MESSAGE_BYTES) {
						console.warn(`Gmail IMAP UID ${item.uid} exceeds ${MAX_MESSAGE_BYTES} bytes, skipping.`);
						// Still remember the UID so we don't re-fetch it every sync.
						await rememberUid(c, userId, accountId, mailbox, item.uidValidity, item.uid, `oversized:${item.uid}`, null);
						continue;
					}
					const parsed = await PostalMime.parse(item.raw);
					const messageId = await externalMessageId(parsed, item.raw);
					prepared.push({ item, parsed, messageId });
				} catch (e) {
					console.warn(`Gmail IMAP message parse failed (UID ${item.uid}), skipping:`, String(e?.message || e).slice(0, 160));
				}
			}
			const known = await existingMessageIdSet(c, userId, accountId, ['gmail'], prepared.map(p => p.messageId));

			let synced = 0, skipped = 0;
			for (const { item, parsed, messageId } of prepared) {
				// Per-message isolation: a single failure never aborts the batch.
				try {
					if (known.has(messageId)) {
						await rememberUid(c, userId, accountId, mailbox, item.uidValidity, item.uid, messageId, null);
						continue;
					}

					const toAddress = addressOf(parsed.to) || account.email;
					const fromAddress = addressOf(parsed.from);
					const references = referencesOf(parsed);
					const inReplyTo = parsed.inReplyTo || headerValue(parsed, 'in-reply-to') || '';
					const inserted = await c.env.db.prepare(
						`INSERT INTO email
						 (send_email, name, account_id, user_id, subject, text, content, cc, bcc,
						  recipient, to_email, to_name, in_reply_to, relation, message_id, type,
						  status, unread, provider, account_email, account_domain, thread_id,
						  external_message_id, create_time, is_del)
						 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
						         ?10, ?11, ?12, ?13, ?14, ?15, ?16,
						         ?17, ?18, 'gmail', ?19, ?20, ?21, ?22, ?23, ?24)`
					).bind(
						fromAddress,
						nameOf(parsed.from) || emailUtils.getName(fromAddress),
						accountId,
						userId,
						parsed.subject || '',
						parsed.text || '',
						parsed.html || '',
						JSON.stringify(parsed.cc || []),
						JSON.stringify(parsed.bcc || []),
						JSON.stringify(parsed.to || []),
						toAddress,
						nameOf(parsed.to) || emailUtils.getName(toAddress),
						inReplyTo,
						references,
						messageId,
						emailConst.type.RECEIVE,
						emailConst.status.RECEIVE,
						1,
						account.email,
						account.domain || emailUtils.getDomain(account.email),
						inReplyTo || references || messageId,
						messageId,
						receivedDate(parsed),
						isDel.NORMAL
					).run();
					const emailId = inserted.meta?.last_row_id;
					known.add(messageId);
					const attachments = await normalizeAttachments(parsed, emailId, userId, accountId);
					if (attachments.length > 0) {
						await attService.addAtt(c, attachments);
					}
					await rememberUid(c, userId, accountId, mailbox, item.uidValidity, item.uid, messageId, emailId);
					synced += 1;
				} catch (e) {
					skipped += 1;
					console.warn(`Gmail IMAP message store failed (UID ${item.uid}), continuing:`, String(e?.message || e).slice(0, 160));
				}
			}

			await c.env.db.prepare(
			`UPDATE account
			    SET sync_status = ?3, sync_error = NULL, sync_error_class = NULL,
			        sync_attempts = 0, next_attempt_at = NULL, last_synced_at = CURRENT_TIMESTAMP,
			        last_successful_sync_at = CURRENT_TIMESTAMP,
			        last_provider_checkpoint_at = CURRENT_TIMESTAMP,
			        last_message_received_at = (
			          SELECT e.create_time FROM email e
			           WHERE e.user_id = ?2 AND e.account_id = ?1 AND e.is_del = 0
			           ORDER BY e.email_id DESC LIMIT 1
			        ),
			        last_sync_failure_at = NULL, sync_failure_reason = NULL
			  WHERE account_id = ?1 AND user_id = ?2`
			).bind(accountId, userId, await mailboxLifecycleAfterImport(c, userId, accountId)).run();
			await googleTestUserRequestService.recordFirstSync(c, account.email);
			return { accountId, email: account.email, provider: 'gmail', synced, skipped, fetched: fetched.length };
		} catch (error) {
			// RC-1: single-point failure routing (see routeSyncFailure).
			await routeSyncFailure(c, accountId, userId, error, account.sync_attempts);
			throw error;
		}
	},

	async autoSync(c, options = {}) {
		const syncPolicy = await syncPolicyService.load(c);
		const gmailFallbackPolicy = syncPolicyService.effectiveForAccount(syncPolicy, { provider: 'gmail' }, { mode: 'gmail_poll_fallback' });
		const staleSeconds = boundedNumber(
			options.staleSeconds || c.env.GMAIL_AUTO_SYNC_STALE_SECONDS || gmailFallbackPolicy.effective_interval_seconds,
			gmailFallbackPolicy.effective_interval_seconds,
			syncPolicy.min_poll_interval_seconds,
			syncPolicy.max_poll_interval_seconds
		);
			const staleMinutes = Math.max(1, Math.ceil(staleSeconds / 60));
			const batchSize = boundedNumber(
				c.env.GMAIL_AUTO_SYNC_BATCH_SIZE || options.batchSize,
				1,
				1,
				1
			);
			const limit = boundedNumber(
				c.env.GMAIL_AUTO_SYNC_MESSAGE_LIMIT || options.limit,
				20,
				1,
				20
			);
		const runBudget = createWorkerBudget({
			maxItems: batchSize,
			maxMs: c.env.GMAIL_AUTO_SYNC_RUN_BUDGET_MS || options.maxMs || 45000
		});
			const accountTimeoutMs = boundedNumber(
				c.env.GMAIL_AUTO_SYNC_ACCOUNT_TIMEOUT_MS || options.accountTimeoutMs,
				30000,
				3000,
				30000
			);
		const staleRunningSeconds = Math.max(15, Math.ceil(accountTimeoutMs / 1000) + 5);

		await ensureGmailUidCache(c);
		await ensureGmailSyncRunTables(c);
		await c.env.db.prepare(
			`UPDATE gmail_sync_run_accounts
			    SET status = 'failed',
			        error = 'Stale running sync was requeued before completion.',
			        completed_at = CURRENT_TIMESTAMP
			  WHERE status = 'running'
			    AND (
			      started_at IS NULL
			      OR datetime(started_at) <= datetime('now', ?1)
			    )`
		).bind(`-${staleRunningSeconds} seconds`).run();
		await c.env.db.prepare(
			`UPDATE gmail_sync_runs
			    SET failed_accounts = CASE WHEN failed_accounts < checked_accounts THEN checked_accounts ELSE failed_accounts END,
			        completed_at = CURRENT_TIMESTAMP
			  WHERE completed_at IS NULL
			    AND (
			      started_at IS NULL
			      OR datetime(started_at) <= datetime('now', ?1)
			    )`
		).bind(`-${staleRunningSeconds} seconds`).run();
		await c.env.db.prepare(
			`UPDATE account
			    SET sync_status = 'sync_required',
			        next_attempt_at = datetime('now'),
			        sync_error = 'Interrupted before completion; requeued for automatic recovery.'
			  WHERE is_del = 0
			    AND provider IN ('gmail', 'google_workspace')
			    AND LOWER(COALESCE(sync_status, '')) = 'syncing'
			    -- RC-3: use the last_progress_at heartbeat (written at claim) to tell a
			    -- genuinely stuck 'syncing' account from one just claimed; fall back to
			    -- last_synced_at when no heartbeat exists yet.
			    AND (
			      COALESCE(last_progress_at, last_synced_at) IS NULL
			      OR COALESCE(last_progress_at, last_synced_at) = ''
			      OR datetime(COALESCE(last_progress_at, last_synced_at)) <= datetime('now', ?1)
			    )`
		).bind(`-${staleRunningSeconds} seconds`).run();
		const result = await c.env.db.prepare(
			`WITH sync_candidates AS (
			   SELECT a.account_id,
			          a.user_id,
			          a.email,
			          a.provider,
			          a.last_synced_at,
			          a.sync_status,
			          a.sync_attempts,
			          CASE WHEN COALESCE(mpc.credential_ciphertext, '') LIKE 'oauth-json:%'
			             THEN 'oauth'
			             ELSE 'imap_or_legacy'
			          END AS credential_kind,
			          ROW_NUMBER() OVER (
			            PARTITION BY a.user_id, LOWER(a.email)
			            ORDER BY
			              CASE WHEN LOWER(COALESCE(a.sync_status, '')) = 'mailbox_ready' THEN 0 ELSE 1 END,
			              CASE WHEN COALESCE(mpc.credential_ciphertext, '') LIKE 'oauth-json:%' THEN 0 ELSE 1 END,
			              datetime(COALESCE(a.last_synced_at, a.create_time, '1970-01-01')) DESC,
			              a.account_id DESC
			          ) AS canonical_rank
			     FROM account a
			     JOIN mail_provider_credentials mpc
			       ON mpc.user_id = a.user_id
			      AND mpc.account_id = a.account_id
			      AND mpc.provider IN ('gmail', 'google_workspace')
			    WHERE a.is_del = 0
			      AND a.provider IN ('gmail', 'google_workspace')
			      AND COALESCE(mpc.credential_ciphertext, '') != ''
			      AND LOWER(COALESCE(a.sync_status, '')) NOT IN ('syncing', 'needs_reconnect', 'legacy_imap_unsupported', 'provider_mailbox_unavailable', 'authorized_identity_mismatch', 'receive_disabled', 'archived', 'removed')
			      AND (
			        a.last_synced_at IS NULL
			        OR a.last_synced_at = ''
			        OR datetime(a.last_synced_at) <= datetime('now', ?1)
			        OR (LOWER(COALESCE(a.sync_status, '')) = 'sync_required'
			            AND (a.next_attempt_at IS NULL OR datetime(a.next_attempt_at) <= datetime('now')))
			        OR LOWER(COALESCE(a.sync_status, '')) = 'stale'
			      )
			)
			SELECT account_id, user_id, provider, last_synced_at, sync_status, sync_attempts, credential_kind
			  FROM sync_candidates
			 WHERE canonical_rank = 1
			 ORDER BY
			   CASE WHEN last_synced_at IS NULL OR last_synced_at = '' THEN 0 ELSE 1 END,
			   datetime(last_synced_at) ASC
			 LIMIT ?2`
		).bind(`-${staleSeconds} seconds`, batchSize).all();

		const accounts = result?.results || [];
		const run = await c.env.db.prepare(
			`INSERT INTO gmail_sync_runs
			 (source, cron, checked_accounts, stale_minutes, batch_size, message_limit)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
		).bind(
			options.source || 'scheduled',
			options.cron || null,
			accounts.length,
			staleMinutes,
			batchSize,
			limit
		).run();
		const runId = Number(run.meta?.last_row_id || 0);
		let syncedAccounts = 0;
		let failedAccounts = 0;
		let skippedDueToBudget = 0;
		const failures = [];

		for (const account of accounts) {
			if (!runBudget.canContinue()) {
				skippedDueToBudget += 1;
				continue;
			}
			if (c && c.subrequests && c.subrequests >= 38) {
				console.warn(`Gmail autoSync skipped remaining accounts: subrequest budget exhausted (${c.subrequests})`);
				skippedDueToBudget += 1;
				continue;
			}
			runBudget.consume();
			const accountId = Number(account.account_id);
			const userId = Number(account.user_id);
			let accountRunId = 0;
			try {
				if (runId) {
					const accountRun = await c.env.db.prepare(
						`INSERT INTO gmail_sync_run_accounts
						 (run_id, account_id, provider, status)
						 VALUES (?1, ?2, ?3, 'running')`
					).bind(runId, accountId, account.provider).run();
					accountRunId = Number(accountRun.meta?.last_row_id || 0);
				}
				if (account.credential_kind !== 'oauth') {
					await markLegacyImapNeedsReconnect(c, accountId, userId);
					failedAccounts += 1;
					failures.push({
						accountId,
						provider: account.provider,
						error: LEGACY_IMAP_UNSUPPORTED_MESSAGE
					});
					if (accountRunId) {
						await c.env.db.prepare(
							`UPDATE gmail_sync_run_accounts
							    SET status = 'failed',
							        synced_messages = 0,
							        error = ?2,
							        completed_at = CURRENT_TIMESTAMP
							  WHERE id = ?1`
						).bind(accountRunId, LEGACY_IMAP_UNSUPPORTED_MESSAGE).run();
					}
					continue;
				}
				const claim = await c.env.db.prepare(
					`UPDATE account
					    SET sync_status = 'syncing', sync_error = NULL, last_progress_at = CURRENT_TIMESTAMP
					  WHERE account_id = ?1
					    AND user_id = ?2
					    AND LOWER(COALESCE(sync_status, '')) NOT IN ('syncing', 'needs_reconnect', 'legacy_imap_unsupported', 'receive_disabled', 'archived', 'removed')`
				).bind(accountId, userId).run();
				if (Number(claim.meta?.changes || 0) === 0) {
					if (accountRunId) {
						await c.env.db.prepare(
							`UPDATE gmail_sync_run_accounts
							    SET status = 'skipped',
							        error = 'Account was already claimed or quarantined.',
							        completed_at = CURRENT_TIMESTAMP
							  WHERE id = ?1`
						).bind(accountRunId).run();
					}
					continue;
				}
				const syncResult = await withTimeout(
					this.sync(c, userId, { accountId, limit }),
					accountTimeoutMs,
					'Automatic Gmail account sync timed out.'
				);
				syncedAccounts += 1;
				if (accountRunId) {
					const cacheEvidence = syncResult?.cacheReused !== undefined
						? `cache_reused=${Number(syncResult.cacheReused || 0)};raw_fetched=${Number(syncResult.fetched || 0)}`
						: null;
					await c.env.db.prepare(
						`UPDATE gmail_sync_run_accounts
						    SET status = 'synced',
						        synced_messages = ?2,
						        error = ?3,
						        completed_at = CURRENT_TIMESTAMP
						  WHERE id = ?1`
					).bind(accountRunId, Number(syncResult?.synced || 0), cacheEvidence).run();
				} else if (runId) {
					await c.env.db.prepare(
						`INSERT INTO gmail_sync_run_accounts
						 (run_id, account_id, provider, status, synced_messages, error, completed_at)
						 VALUES (?1, ?2, ?3, 'synced', ?4, ?5, CURRENT_TIMESTAMP)`
					).bind(
						runId,
						accountId,
						account.provider,
						Number(syncResult?.synced || 0),
						syncResult?.cacheReused !== undefined
							? `cache_reused=${Number(syncResult.cacheReused || 0)};raw_fetched=${Number(syncResult.fetched || 0)}`
							: null
					).run();
				}
			} catch (error) {
				failedAccounts += 1;
				const safeError = String(error?.message || error).slice(0, 120);
				failures.push({
					accountId,
					provider: account.provider,
					error: safeError
				});
				if (safeError.toLowerCase().includes('timed out')) {
					await routeSyncFailure(
						c,
						accountId,
						userId,
						Object.assign(new Error(safeError), { category: 'timeout', reason: 'account_sync_timeout' }),
						account.sync_attempts
					);
				}
				if (accountRunId) {
					await c.env.db.prepare(
						`UPDATE gmail_sync_run_accounts
						    SET status = 'failed',
						        synced_messages = 0,
						        error = ?2,
						        completed_at = CURRENT_TIMESTAMP
						  WHERE id = ?1`
					).bind(accountRunId, safeError).run();
				} else if (runId) {
					await c.env.db.prepare(
						`INSERT INTO gmail_sync_run_accounts
						 (run_id, account_id, provider, status, synced_messages, error, completed_at)
						 VALUES (?1, ?2, ?3, 'failed', 0, ?4, CURRENT_TIMESTAMP)`
					).bind(runId, accountId, account.provider, safeError).run();
				}
			}
		}
		if (runId) {
			await c.env.db.prepare(
				`UPDATE gmail_sync_runs
				    SET synced_accounts = ?2,
				        failed_accounts = ?3,
				        completed_at = CURRENT_TIMESTAMP
				  WHERE id = ?1`
			).bind(runId, syncedAccounts, failedAccounts).run();
		}

		return {
			runId,
			checked: accounts.length,
			syncedAccounts,
			failedAccounts,
			skippedDueToBudget,
			budget: runBudget.snapshot(),
			failures,
			staleMinutes,
			effectiveIntervalSeconds: staleSeconds,
			syncPolicy: {
				provider_mode: gmailFallbackPolicy.provider_mode,
				effective_interval_seconds: gmailFallbackPolicy.effective_interval_seconds,
				gmail_poll_fallback_interval_seconds: syncPolicy.gmail_poll_fallback_interval_seconds,
				gmail_partial_sync_min_interval_seconds: syncPolicy.gmail_partial_sync_min_interval_seconds,
				imap_poll_interval_seconds: syncPolicy.imap_poll_interval_seconds,
				imap_idle_reissue_seconds: syncPolicy.imap_idle_reissue_seconds,
				backoff_base_seconds: syncPolicy.backoff_base_seconds,
				backoff_max_seconds: syncPolicy.backoff_max_seconds,
				jitter_percent: syncPolicy.jitter_percent,
				server_config_version: syncPolicy.server_config_version,
				last_sync_policy_refresh_at: syncPolicy.last_sync_policy_refresh_at
			},
			batchSize,
			accountTimeoutMs,
			limit,
			cron: options.cron || null
		};
	},

	async receiveRealityProbe(c, userId, params = {}) {
		const accountId = Number(params.accountId || 0);
		const email = normalizeEmail(params.email || '');
		const account = await c.env.db.prepare(
			`SELECT account_id, user_id, email, provider, sync_status, last_synced_at, sync_error, last_progress_at
			   FROM account
			  WHERE user_id = ?1
			    AND provider IN ('gmail', 'google_workspace')
			    AND is_del = 0
			    AND (?2 = 0 OR account_id = ?2)
			    AND (?3 = '' OR email = ?3 COLLATE NOCASE)
			  ORDER BY CASE WHEN ?2 != 0 THEN 0 ELSE 1 END, account_id
			  LIMIT 1`
		).bind(userId, accountId, email).first();
		if (!account) throw new Error('Gmail account is not connected.');
		const before = await latestGmailLedgerEvidence(c, userId, account.account_id);
		let syncResult;
		try {
			syncResult = await this.sync(c, userId, {
				accountId: account.account_id,
				limit: boundedNumber(params.limit, 25, 1, 50)
			});
		} catch (error) {
			const afterFailure = await latestGmailLedgerEvidence(c, userId, account.account_id);
			return {
				accountId: account.account_id,
				email: account.email,
				provider: account.provider,
				status: 'failed',
				failureReason: String(error?.message || error).slice(0, 160),
				before,
				after: afterFailure,
				receiveCapability: 'FAIL',
				truthSource: 'gmail_receive_reality_probe'
			};
		}
		const after = await latestGmailLedgerEvidence(c, userId, account.account_id);
		const imported = Number(syncResult?.synced || 0);
		const providerObserved = Number(syncResult?.fetched || 0) + Number(syncResult?.cacheReused || 0) + imported;
		return {
			accountId: account.account_id,
			email: account.email,
			provider: account.provider,
			status: imported > 0 ? 'imported_new_messages' : 'no_new_provider_messages_imported',
			providerObserved: providerObserved > 0,
			imported,
			fetched: Number(syncResult?.fetched || 0),
			cacheReused: Number(syncResult?.cacheReused || 0),
			skipped: Number(syncResult?.skipped || 0),
			before,
			after,
			ledgerUpdated: Number(after?.emailId || 0) > Number(before?.emailId || 0),
			allMailVisible: Number(after?.emailId || 0) > 0,
			inboxVisible: Number(after?.emailId || 0) > 0,
			freshness: imported > 0 || providerObserved > 0 ? 'Fresh' : 'Stale',
			receiveCapability: imported > 0 || Number(after?.emailId || 0) > 0 ? 'PASS_WITH_LEDGER_EVIDENCE' : 'STALE',
			truthSource: 'gmail_receive_reality_probe'
		};
	},

	async freshnessTrace(c, userId, params = {}) {
		const accountId = Number(params.accountId || 0);
		const rows = await c.env.db.prepare(
			`SELECT a.account_id AS accountId, a.email, a.provider, a.sync_status AS syncStatus, a.last_synced_at AS lastWorkerSync, a.sync_error AS syncError,
			        f.history_cursor AS historyCursor, f.provider_connected AS providerConnected, f.oauth_valid AS oauthValid, f.token_refresh_valid AS tokenRefreshValid,
			        f.last_provider_check_at AS lastProviderCheck, f.last_delta_sync_at AS lastDeltaSync, f.last_worker_ingest_at AS lastWorkerIngest,
			        f.last_provider_message_id AS lastProviderMessageId, f.last_provider_message_time AS lastProviderMessageTime,
			        f.last_ledger_message_time AS lastLedgerMessageTime, f.last_visible_message_time AS lastVisibleMessageTime,
			        f.sync_health AS syncHealth, f.provider_status AS providerStatus, f.failure_reason AS failureReason
			   FROM account a LEFT JOIN gmail_provider_freshness f ON f.account_id = a.account_id AND f.user_id = a.user_id
			  WHERE a.user_id = ?1 AND a.provider IN ('gmail','google_workspace') AND a.is_del = 0 AND (?2 = 0 OR a.account_id = ?2)
			  ORDER BY a.account_id`
		).bind(userId, accountId).all();
		return (rows?.results || []).map(row => ({
			...row,
			awaitingSync: String(row.syncStatus || '').toLowerCase() === 'sync_required',
			truthSource: 'gmail_provider_freshness'
		}));
	}
};

export default gmailImapService;

// Named exports for unit testing the recoverable-sync state machine (RC-1/RC-2) and the
// RC-5 backfill page builder. Additive only; does not affect the default service export.
export { classifyGmailError, routeSyncFailure, listGmailApiBackfillPage, normalizeReceivedDate, prepareGmailApiParsedMessages, fetchGmailApiMessageWithTombstoneRecovery };
