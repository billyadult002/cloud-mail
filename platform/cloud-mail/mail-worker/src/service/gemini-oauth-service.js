import BizError from '../error/biz-error';
import { encryptSecret, decryptSecret } from '../utils/secret-crypto';
import emailUtils from '../utils/email-utils';
import googleTestUserRequestService from './google-test-user-request-service';

const encoder = new TextEncoder();
const STATE_PREFIX = 'gemini-oauth-state:';
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/generative-language.retriever';
const DEFAULT_GOOGLE_MAILBOX_SCOPES = [
	'openid',
	'email',
	'profile',
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/gmail.send'
];
const MAILBOX_CREDENTIAL_PREFIX = 'oauth-json:';
const GOOGLE_OAUTH_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, options = {}, timeoutMs = GOOGLE_OAUTH_TIMEOUT_MS) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort('google_oauth_timeout'), timeoutMs);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} catch (error) {
		if (error?.name === 'AbortError' || String(error?.message || error).toLowerCase().includes('abort')) {
			const err = new BizError('Google OAuth request timed out.', 504);
			err.reason = 'google_oauth_timeout';
			throw err;
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

function base64Url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function configured(c) {
	return Boolean(c.env.GOOGLE_OAUTH_CLIENT_ID && c.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function redirectUri(c) {
	return c.env.GOOGLE_OAUTH_REDIRECT_URI || `${new URL(c.req.url).origin}/api/ai/oauth/gemini/callback`;
}

function scopes(c) {
	return String(c.env.GEMINI_OAUTH_SCOPES || DEFAULT_SCOPE).split(/[\s,]+/).filter(Boolean);
}

function mailboxScopes(c) {
	return String(c.env.GOOGLE_MAILBOX_OAUTH_SCOPES || DEFAULT_GOOGLE_MAILBOX_SCOPES.join(' '))
		.split(/[\s,]+/)
		.filter(Boolean);
}

function googleMailboxProvider(email) {
	const normalized = String(email || '').trim().toLowerCase();
	return normalized.endsWith('@gmail.com') || normalized.endsWith('@googlemail.com') ? 'gmail' : 'google_workspace';
}

async function codeChallenge(verifier) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
	return base64Url(new Uint8Array(digest));
}

async function randomUrlToken(byteLength = 32) {
	const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
	return base64Url(bytes);
}

async function identityHash(value) {
	const normalized = String(value || '').trim().toLowerCase();
	if (!normalized) return '';
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(normalized));
	return base64Url(new Uint8Array(digest));
}

export function reconnectCommitIsCurrent({ expectedIdentityHash = '', actualIdentityHash = '', expectedGeneration = 0, currentGeneration = 0 } = {}) {
	return Boolean(expectedIdentityHash)
		&& expectedIdentityHash === actualIdentityHash
		&& Number(expectedGeneration) === Number(currentGeneration);
}

async function tokenRequest(params) {
	const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(params)
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const reason = body.error || `http_${response.status}`;
		const message = body.error_description || body.error || 'Google OAuth token exchange failed.';
		const err = new BizError(`Google OAuth token exchange failed: ${reason}`, response.status || 502);
		err.reason = reason;
		err.providerMessage = message;
		throw err;
	}
	return body;
}

async function userInfo(accessToken) {
	const response = await fetchWithTimeout('https://openidconnect.googleapis.com/v1/userinfo', {
		headers: { authorization: `Bearer ${accessToken}` }
	});
	if (!response.ok) return {};
	return response.json().catch(() => ({}));
}

async function upsertGeminiToken(c, userId, token, info, scopeText) {
	const accessCiphertext = token.access_token ? await encryptSecret(c, token.access_token) : null;
	const refreshCiphertext = token.refresh_token ? await encryptSecret(c, token.refresh_token) : null;
	const expiresAt = token.expires_in ? Math.floor(Date.now() / 1000) + Number(token.expires_in) : null;
	await c.env.db.prepare(
		`INSERT INTO ai_provider_tokens
		 (user_id, provider, provider_account_email, provider_account_id, access_token_ciphertext,
		  refresh_token_ciphertext, scope, token_type, expires_at, status)
		 VALUES (?1, 'google_gemini', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'connected')
		 ON CONFLICT(user_id, provider) DO UPDATE SET
		   provider_account_email = excluded.provider_account_email,
		   provider_account_id = excluded.provider_account_id,
		   access_token_ciphertext = excluded.access_token_ciphertext,
		   refresh_token_ciphertext = COALESCE(excluded.refresh_token_ciphertext, ai_provider_tokens.refresh_token_ciphertext),
		   scope = excluded.scope,
		   token_type = excluded.token_type,
		   expires_at = excluded.expires_at,
		   status = 'connected',
		   disconnected_at = NULL,
		   updated_at = CURRENT_TIMESTAMP`
	).bind(
		userId,
		info.email || null,
		info.sub || null,
		accessCiphertext,
		refreshCiphertext,
		scopeText,
		token.token_type || null,
		expiresAt
	).run();
	return { expiresAt };
}

async function archiveDuplicateGoogleMailboxes(c, userId, keepAccountId, email, googleSubjectId) {
	await c.env.db.prepare(
		`UPDATE account
		    SET is_del = 1,
		        sync_status = 'archived',
		        sync_error = 'Archived duplicate Gmail identity after OAuth reconnect preserved mailbox history on the retained account.',
		        sync_error_class = 'duplicate_mailbox_identity_archived'
		  WHERE user_id = ?1
		    AND account_id != ?2
		    AND is_del = 0
		    AND (
		      email = ?3 COLLATE NOCASE
		      OR (COALESCE(external_account_id, '') != '' AND external_account_id = ?4)
		    )`
	).bind(userId, keepAccountId, email, googleSubjectId || '').run();
}

async function upsertGoogleMailbox(c, userId, token, info, scopeText, options = {}) {
	const email = String(info.email || '').trim().toLowerCase();
	const googleSubjectId = info.sub || null;
	if (!email || !googleSubjectId) throw new BizError('Google account identity was not returned by OAuth.', 502);
	const provider = googleMailboxProvider(email);
	const domain = emailUtils.getDomain(email);
	const requestedAccountId = Number(options.accountId || 0);
	const expectedIdentityHash = String(options.expectedIdentityHash || '');
	const actualIdentityHash = await identityHash(email);
	if (expectedIdentityHash && expectedIdentityHash !== actualIdentityHash) {
		throw new BizError('Google account identity does not match the mailbox being reconnected.', 409);
	}
	let accountId = 0;
	let reconnectGeneration = 0;
	if (requestedAccountId > 0) {
		const requested = await c.env.db.prepare(
			`SELECT account_id, email, provider, oauth_authorization_generation
			   FROM account
			  WHERE user_id = ?1
			    AND account_id = ?2
			    AND is_del = 0
			  LIMIT 1`
		).bind(userId, requestedAccountId).first();
		if (!requested) throw new BizError('Reconnect target mailbox was not found.', 404);
		if (String(requested.email || '').trim().toLowerCase() !== email) {
			throw new BizError('Reconnect must use the same Google mailbox identity.', 409);
		}
		if (!['gmail', 'google_workspace'].includes(String(requested.provider || '').toLowerCase())) {
			throw new BizError('Reconnect target is not a Google mailbox.', 409);
		}
		if (!reconnectCommitIsCurrent({
			expectedIdentityHash,
			actualIdentityHash,
			expectedGeneration: options.expectedAuthorizationGeneration,
			currentGeneration: requested.oauth_authorization_generation
		})) {
			throw new BizError('This Google reconnect was superseded. Start it again from the mailbox.', 409);
		}
		accountId = requestedAccountId;
		reconnectGeneration = Number(requested.oauth_authorization_generation || 0);
	}
	if (!accountId) {
		accountId = (await c.env.db.prepare(
			`SELECT account_id FROM account
			  WHERE user_id = ?1
			    AND is_del = 0
			    AND (
			      email = ?2 COLLATE NOCASE
			      OR (COALESCE(external_account_id, '') != '' AND external_account_id = ?3)
			    )
			  ORDER BY
			    CASE 
			      WHEN provider IN ('gmail', 'google_workspace') THEN 0
			      WHEN provider = 'imap' THEN 1
			      WHEN provider = 'cloudflare_native' THEN 2
			      ELSE 3
			    END,
			    CASE WHEN sync_status IN ('legacy_imap_unsupported', 'needs_reconnect', 'first_import_pending') THEN 0 ELSE 1 END,
			    account_id ASC
			  LIMIT 1`
		).bind(userId, email, googleSubjectId).first())?.account_id;
	}
	if (!accountId) {
		const inserted = await c.env.db.prepare(
			`INSERT INTO account
			 (email, name, user_id, provider, domain, external_account_id, sync_status, all_receive, sort, is_del)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'first_import_pending', 1, 0, 0)`
		).bind(email, emailUtils.getName(email), userId, provider, domain, googleSubjectId).run();
		accountId = inserted.meta?.last_row_id;
	}

	const expiresAt = token.expires_in ? Math.floor(Date.now() / 1000) + Number(token.expires_in) : null;
	const credentialPayload = {
		type: 'google_oauth_mailbox',
		google_subject_id: googleSubjectId,
		google_account_email: email,
		access_token: token.access_token || null,
		refresh_token: token.refresh_token || null,
		scope: scopeText,
		token_type: token.token_type || null,
		expires_at: expiresAt
	};
	const credentialCiphertext = MAILBOX_CREDENTIAL_PREFIX + await encryptSecret(c, JSON.stringify(credentialPayload));
	const writes = [];
	if (requestedAccountId > 0) {
		// This conditional write is the stale-callback gate. D1 batch is atomic:
		// if the generation has advanced, no account or credential mutation commits.
		writes.push(c.env.db.prepare(
			`UPDATE account
			    SET provider = ?3, domain = ?4, external_account_id = ?5,
		        sync_status = 'first_import_pending', sync_error = NULL, sync_error_class = NULL,
		        next_attempt_at = datetime('now'),
		        oauth_authorization_generation = oauth_authorization_generation + 1
		  WHERE account_id = ?1 AND user_id = ?2 AND oauth_authorization_generation = ?6`
		).bind(accountId, userId, provider, domain, googleSubjectId, reconnectGeneration));
	} else {
		writes.push(c.env.db.prepare(
			`UPDATE account
			    SET provider = ?3, domain = ?4, external_account_id = ?5,
		        sync_status = 'first_import_pending', sync_error = NULL, sync_error_class = NULL,
		        next_attempt_at = datetime('now')
		  WHERE account_id = ?1 AND user_id = ?2`
		).bind(accountId, userId, provider, domain, googleSubjectId));
	}
	// Credentials are unique per identity. For reconnects, both statements are
	// conditional on the generation *after* the guarded update. That means a
	// stale callback cannot delete or replace a newer credential even if its
	// update affected zero rows.
	if (requestedAccountId > 0) {
		writes.push(c.env.db.prepare(
			`DELETE FROM mail_provider_credentials
			  WHERE user_id = ?1 AND provider = ?2 AND email = ?3 COLLATE NOCASE
			    AND EXISTS (SELECT 1 FROM account WHERE account_id = ?4 AND user_id = ?1 AND oauth_authorization_generation = ?5)`
		).bind(userId, provider, email, accountId, reconnectGeneration + 1));
		writes.push(c.env.db.prepare(
			`INSERT INTO mail_provider_credentials (user_id, account_id, provider, email, credential_ciphertext)
			 SELECT ?1, ?2, ?3, ?4, ?5
			  WHERE EXISTS (SELECT 1 FROM account WHERE account_id = ?2 AND user_id = ?1 AND oauth_authorization_generation = ?6)`
		).bind(userId, accountId, provider, email, credentialCiphertext, reconnectGeneration + 1));
	} else {
		writes.push(c.env.db.prepare(
			`DELETE FROM mail_provider_credentials WHERE user_id = ?1 AND provider = ?2 AND email = ?3 COLLATE NOCASE`
		).bind(userId, provider, email));
		writes.push(c.env.db.prepare(
			`INSERT INTO mail_provider_credentials (user_id, account_id, provider, email, credential_ciphertext)
			 VALUES (?1, ?2, ?3, ?4, ?5)`
		).bind(userId, accountId, provider, email, credentialCiphertext));
	}
	const writeResults = await c.env.db.batch(writes);
	if (requestedAccountId > 0 && Number(writeResults?.[0]?.meta?.changes || 0) !== 1) {
		throw new BizError('This Google reconnect was superseded. Start it again from the mailbox.', 409);
	}
	await archiveDuplicateGoogleMailboxes(c, userId, accountId, email, googleSubjectId);

	return {
		accountId,
		email,
		provider,
		googleSubjectId,
		expiresAt,
		lifecycleState: 'first_import_pending',
		reconnectMode: requestedAccountId > 0 ? 'reconnect_current_mailbox' : 'connect_or_merge_identity'
	};
}

const geminiOAuthService = {
	async status(c, userId) {
		const row = await c.env.db.prepare(
			`SELECT provider_account_email, provider_account_id, scope, expires_at, status, updated_at
			   FROM ai_provider_tokens
			  WHERE user_id = ?1 AND provider = 'google_gemini' AND status = 'connected'
			  LIMIT 1`
		).bind(userId).first();
		return {
			provider: 'google_gemini',
			configured: configured(c),
			authorized: Boolean(row),
			status: row ? 'connected' : (configured(c) ? 'ready_to_authorize' : 'blocked_real_external_dependency'),
			reason: row ? null : (configured(c) ? 'authorization_required' : 'google_oauth_client_not_configured'),
			accountEmail: row?.provider_account_email || null,
			accountId: row?.provider_account_id || null,
			scope: row?.scope || scopes(c).join(' '),
			expiresAt: row?.expires_at || null,
			updatedAt: row?.updated_at || null
		};
	},

	async mailboxAuthorizationStatus(c, userId, mailbox = {}) {
		const email = String(mailbox.email || '').trim().toLowerCase();
		const provider = String(mailbox.provider || '').trim().toLowerCase();
		const isGoogleMailbox = provider === 'gmail' || provider === 'google_workspace';
		const status = await this.status(c, userId);
		const geminiEmail = String(status.accountEmail || '').trim().toLowerCase();
		const emailMatches = Boolean(email && geminiEmail && email === geminiEmail);
		return {
			provider: 'google_gemini',
			available: Boolean(isGoogleMailbox && status.authorized && emailMatches),
			status: isGoogleMailbox && status.authorized && emailMatches ? 'available' : 'not_available',
			reason: !isGoogleMailbox
				? 'non_google_mailbox'
				: !status.authorized
					? 'google_mailbox_does_not_include_gemini_oauth_reference'
					: !emailMatches
						? 'google_mailbox_identity_mismatch'
						: 'connected_via_google_account',
			mailboxProvider: provider || null,
			mailboxEmail: email || null,
			accountEmail: status.accountEmail || null,
			accountId: status.accountId || null,
			secondLoginRequired: !(isGoogleMailbox && status.authorized && emailMatches),
			crossAccountAccess: false,
			billingOwner: 'user',
			providerOwnership: 'user_owned',
			sharedPlatformApiKey: false,
			mailboxDataSent: false,
			customerDataSent: false,
			contactsSent: false,
			calendarDataSent: false,
			attachmentsSent: false
		};
	},

	async start(c, userId) {
		const stateStatus = await this.status(c, userId);
		if (!stateStatus.configured) return { ...stateStatus, authorizationUrl: null };

		const state = await randomUrlToken();
		const verifier = await randomUrlToken(48);
		const challenge = await codeChallenge(verifier);
		await c.env.kv.put(
			STATE_PREFIX + state,
			JSON.stringify({ userId, verifier, redirectUri: redirectUri(c), flow: 'gemini_oauth', createdAt: Date.now() }),
			{ expirationTtl: 600 }
		);

		const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
		url.searchParams.set('client_id', c.env.GOOGLE_OAUTH_CLIENT_ID);
		url.searchParams.set('redirect_uri', redirectUri(c));
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('scope', scopes(c).join(' '));
		url.searchParams.set('state', state);
		url.searchParams.set('access_type', 'offline');
		url.searchParams.set('prompt', 'consent');
		url.searchParams.set('include_granted_scopes', 'true');
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');

		return { ...stateStatus, status: 'authorization_url_ready', authorizationUrl: url.toString() };
	},

	async startGoogleMailbox(c, userId, params = {}) {
		const stateStatus = await this.status(c, userId);
		if (!stateStatus.configured) return { ...stateStatus, provider: 'google_mailbox', authorizationUrl: null };

		const state = await randomUrlToken();
		const verifier = await randomUrlToken(48);
		const challenge = await codeChallenge(verifier);
		const activeScopes = mailboxScopes(c);
		const requestedGmail = String(params.gmail || params.email || '').trim().toLowerCase();
		const requestedAccountId = Number(params.accountId || params.account_id || 0);
		const device = String(params.device || '').trim().slice(0, 160);
		let expectedIdentityHash = requestedGmail ? await identityHash(requestedGmail) : '';
		let expectedAuthorizationGeneration = 0;
		if (requestedAccountId > 0) {
			const target = await c.env.db.prepare(
				`SELECT email, provider, oauth_authorization_generation FROM account
				  WHERE account_id = ?1 AND user_id = ?2 AND is_del = 0 LIMIT 1`
			).bind(requestedAccountId, userId).first();
			if (!target || !['gmail', 'google_workspace'].includes(String(target.provider || '').toLowerCase())) {
				throw new BizError('Reconnect target mailbox was not found.', 404);
			}
			const targetHash = await identityHash(target.email);
			if (expectedIdentityHash && targetHash !== expectedIdentityHash) {
				throw new BizError('Reconnect target does not match this mailbox.', 409);
			}
			expectedIdentityHash = targetHash;
			expectedAuthorizationGeneration = Number(target.oauth_authorization_generation || 0);
		}
		if (requestedGmail) {
			await googleTestUserRequestService.recordAutoApproved(c, {
				gmail: requestedGmail,
				userId,
				device,
				notes: requestedAccountId > 0
					? `OAuth reconnect started for accountId ${requestedAccountId}.`
					: 'Direct OAuth connect started after CloudMail auto approval.'
			}).catch(error => {
				console.warn('Google OAuth auto-approval recording failed:', String(error?.message || error).slice(0, 160));
			});
		}
		await c.env.kv.put(
			STATE_PREFIX + state,
			JSON.stringify({
				userId,
				verifier,
				redirectUri: redirectUri(c),
				flow: 'google_mailbox_unified',
				expectedIdentityHash,
				requestedAccountId,
				expectedAuthorizationGeneration,
				tenantId: userId,
				device,
				createdAt: Date.now()
			}),
			{ expirationTtl: 600 }
		);

		const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
		url.searchParams.set('client_id', c.env.GOOGLE_OAUTH_CLIENT_ID);
		url.searchParams.set('redirect_uri', redirectUri(c));
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('scope', activeScopes.join(' '));
		url.searchParams.set('state', state);
		url.searchParams.set('access_type', 'offline');
		url.searchParams.set('prompt', 'consent');
		url.searchParams.set('include_granted_scopes', 'true');
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');

		return {
			provider: 'google_mailbox',
			configured: true,
			authorized: false,
			status: 'authorization_url_ready',
			reason: 'google_oauth_mailbox_unified_authorization',
			cloudmailGovernance: 'auto_approved',
			googleOAuthState: 'oauth_launch_ready',
			mailboxState: 'not_ready',
			scope: activeScopes.join(' '),
			authorizationUrl: url.toString(),
			requestedAccountId: requestedAccountId || null,
			secondLoginRequired: false
		};
	},

	async callback(c, params = {}) {
		if (!configured(c)) throw new BizError('Google OAuth client is not configured.', 503);
		const code = String(params.code || '');
		const state = String(params.state || '');
		if (!code || !state) throw new BizError('Gemini OAuth callback is missing code or state.', 400);

		const stored = await c.env.kv.get(STATE_PREFIX + state, { type: 'json' });
		if (!stored?.userId || !stored?.verifier) throw new BizError('Gemini OAuth state expired. Start authorization again.', 400);
		await c.env.kv.delete(STATE_PREFIX + state);

		const token = await tokenRequest({
			client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
			client_secret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
			code,
			code_verifier: stored.verifier,
			grant_type: 'authorization_code',
			redirect_uri: stored.redirectUri || redirectUri(c)
		});
		const info = token.access_token ? await userInfo(token.access_token) : {};
		const activeScopeText = token.scope || (stored.flow === 'google_mailbox_unified' ? mailboxScopes(c) : scopes(c)).join(' ');
		if (stored.flow === 'google_mailbox_unified') {
			const mailbox = await upsertGoogleMailbox(c, stored.userId, token, info, activeScopeText, {
				expectedIdentityHash: stored.expectedIdentityHash,
				accountId: stored.requestedAccountId,
				expectedAuthorizationGeneration: stored.expectedAuthorizationGeneration
			});
			await upsertGeminiToken(c, stored.userId, token, info, activeScopeText);
			return {
				provider: 'google_mailbox',
				status: 'first_import_pending',
				authorized: true,
				userId: stored.userId,
				accountId: mailbox.accountId,
				accountEmail: mailbox.email,
				accountIdGoogle: mailbox.googleSubjectId,
				mailboxProvider: mailbox.provider,
				lifecycleState: mailbox.lifecycleState,
				reconnectMode: mailbox.reconnectMode,
				gemini: {
					provider: 'google_gemini',
					status: 'connected',
					authorized: true,
					secondLoginRequired: false
				},
				mailboxDataSent: false,
				customerDataSent: false,
				contactsSent: false,
				calendarDataSent: false,
				attachmentsSent: false
			};
		}
		await upsertGeminiToken(c, stored.userId, token, info, activeScopeText);

		return { provider: 'google_gemini', status: 'connected', authorized: true, accountEmail: info.email || null };
	},

	async getValidMailboxAccessToken(c, userId, accountId) {
		const credential = await c.env.db.prepare(
			`SELECT * FROM mail_provider_credentials WHERE user_id = ?1 AND account_id = ?2 LIMIT 1`
		).bind(userId, accountId).first();
		if (!credential?.credential_ciphertext) {
			throw new Error('Credential not found for account');
		}
		const encrypted = credential.credential_ciphertext.slice(MAILBOX_CREDENTIAL_PREFIX.length);
		const decrypted = JSON.parse(await decryptSecret(c, encrypted));

		const now = Math.floor(Date.now() / 1000);
		if (decrypted.access_token && decrypted.expires_at && decrypted.expires_at > now + 60) {
			return decrypted.access_token;
		}

		if (!decrypted.refresh_token) {
			throw new Error('No refresh token available');
		}

		// Token expired, refresh it
		const tokenBody = await tokenRequest({
			client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
			client_secret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
			refresh_token: decrypted.refresh_token,
			grant_type: 'refresh_token'
		});

		const access_token = tokenBody.access_token;
		const expires_in = tokenBody.expires_in;
		const expiresAt = expires_in ? Math.floor(Date.now() / 1000) + Number(expires_in) : null;

		const updatedPayload = {
			...decrypted,
			access_token,
			expires_at: expiresAt
		};

		const credentialCiphertext = MAILBOX_CREDENTIAL_PREFIX + await encryptSecret(c, JSON.stringify(updatedPayload));
		await c.env.db.prepare(
			`UPDATE mail_provider_credentials
			    SET credential_ciphertext = ?3,
			        updated_at = CURRENT_TIMESTAMP
			  WHERE user_id = ?1 AND account_id = ?2`
		).bind(userId, accountId, credentialCiphertext).run();

		return access_token;
	},

	async disconnect(c, userId) {
		await c.env.db.batch([
		c.env.db.prepare(
			`UPDATE ai_provider_tokens
			    SET status = 'disconnected',
			        access_token_ciphertext = NULL,
			        refresh_token_ciphertext = NULL,
			        disconnected_at = CURRENT_TIMESTAMP,
			        updated_at = CURRENT_TIMESTAMP
			  WHERE user_id = ?1 AND provider = 'google_gemini'`
			).bind(userId),
		c.env.db.prepare(
			`DELETE FROM mail_provider_credentials WHERE user_id = ?1`
		).bind(userId),
		c.env.db.prepare(
			`UPDATE account SET sync_status = 'needs_reconnect', sync_error = 'Google authorization disconnected', sync_error_class = 'oauth_disconnected'
			 WHERE user_id = ?1 AND provider IN ('gmail', 'google_workspace') AND is_del = 0`
		).bind(userId)
		]);
		return this.status(c, userId);
	}
};

export default geminiOAuthService;
