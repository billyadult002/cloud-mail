// NEXORA Zero-Touch onboarding: provider-neutral OAuth/authorization-session contract,
// Google + Microsoft Authorization Code + PKCE adapters, minimum-scope planning, incremental
// consent, identity/tenant validation, and capability-discovery mapping. See
// NEXORA_ZERO_TOUCH_ONBOARDING_MANUAL_TOUCH_INVENTORY.md and
// docs/ADR-NEXORA-ZERO-TOUCH-ONBOARDING.md for the design rationale.
//
// This module never performs a network call and never stores a raw authorization code,
// access token, refresh token, client secret, PKCE verifier, or provider password -- it only
// constructs deterministic request/session data and validates provider RESPONSES that the
// caller supplies (a real HTTP adapter, not built here, is what talks to Google/Microsoft).
// This keeps every function in this file unit-testable without live provider credentials,
// per this mission's explicit instruction not to let missing production OAuth credentials
// block logic-complete implementation and verification.
import { decide as decideProviderAction } from './provider-capability-contract-service';

const uuid = () => crypto.randomUUID();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(text) {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
async function hexHash(text) {
	return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// -- Provider-neutral endpoint/scope contracts -------------------------------------------
// client_id is read from env at call time (never hardcoded, never committed); an absent
// client_id means "not yet registered" -- callers must treat that as PROVIDER_APPLICATION_MISSING,
// not attempt a broken redirect. See the admin bootstrap packages for the registration steps
// that produce these values.
const PROVIDERS = Object.freeze({
	google: {
		authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
		tokenEndpoint: 'https://oauth2.googleapis.com/token',
		clientIdEnv: 'NEXORA_GOOGLE_OAUTH_CLIENT_ID',
		// Google's PKCE-capable public/native flow does not require a client_secret; the
		// confidential server-side exchange (if used) reads NEXORA_GOOGLE_OAUTH_CLIENT_SECRET
		// at token-exchange time only -- never referenced from this contract-construction module.
		supportsIncrementalConsent: true,
		defaultClientType: 'confidential', // Workers-hosted first-party app exchanges the code server-side
	},
	microsoft: {
		authorizationEndpoint: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
		tokenEndpoint: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
		clientIdEnv: 'NEXORA_MICROSOFT_OAUTH_CLIENT_ID',
		supportsIncrementalConsent: true,
		defaultClientType: 'confidential',
	},
});

// Minimum-scope planning: only the scopes a specific NEXORA capability genuinely needs.
// Read-only mail visibility never implies send, calendar, contacts, or directory access.
const CAPABILITY_SCOPES = Object.freeze({
	google: {
		mail_read: ['https://www.googleapis.com/auth/gmail.readonly'],
		mail_send: ['https://www.googleapis.com/auth/gmail.send'],
		calendar_read: ['https://www.googleapis.com/auth/calendar.readonly'],
		identity: ['openid', 'email'],
	},
	microsoft: {
		mail_read: ['Mail.Read'],
		mail_send: ['Mail.Send'],
		calendar_read: ['Calendars.Read'],
		identity: ['openid', 'profile', 'email'],
	},
});

const CAPABILITY_STATES = new Set(['SUPPORTED', 'UNSUPPORTED', 'CONSENT_REQUIRED', 'ADMIN_APPROVAL_REQUIRED', 'POLICY_DENIED', 'TEMPORARILY_UNAVAILABLE', 'DEGRADED']);

function planScopes(provider, capabilities) {
	const table = CAPABILITY_SCOPES[provider];
	if (!table) throw new Error('nexora_onboarding_unsupported_provider');
	const scopes = new Set(table.identity);
	const justification = {};
	for (const capability of capabilities) {
		const required = table[capability];
		if (!required) throw new Error(`nexora_onboarding_unknown_capability:${capability}`);
		for (const scope of required) scopes.add(scope);
		justification[capability] = required;
	}
	return { scopes: [...scopes].sort(), justification };
}

// Incremental consent: never discards previously granted scopes; only adds what a later
// Mission genuinely needs beyond what is already usable.
function planIncrementalScopes(provider, existingGrantedScopes, newlyRequiredCapabilities) {
	const { scopes: required } = planScopes(provider, newlyRequiredCapabilities);
	const granted = new Set(existingGrantedScopes || []);
	const additional = required.filter((scope) => !granted.has(scope));
	return { additionalScopes: additional, allScopesAfterGrant: [...new Set([...granted, ...additional])].sort() };
}

// -- PKCE (RFC 7636) ------------------------------------------------------------------------
function randomVerifier() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return b64url(bytes.buffer); // 43-char base64url string, within the 43-128 char RFC bound
}
async function pkceChallengeFor(verifier) {
	const digestBytes = await sha256(verifier);
	return b64url(digestBytes.buffer);
}

// -- Durable authorization session -----------------------------------------------------
// Returns { session row to insert, verifier } -- the verifier must be handed to the caller
// (e.g. placed in a short-lived signed cookie or the client's own session) and is NEVER
// written to nexora_onboarding_authorization_sessions; only its hash is persisted, so a
// stolen database row alone cannot complete the PKCE exchange.
async function createAuthorizationSession(env, { onboardingMissionId, tenantId, workspaceId, provider, clientRegistrationMode = 'first_party', capabilities, existingGrantedScopes = [], tenantHint = null, loginHint = null, ttlSeconds = 600 }) {
	if (!PROVIDERS[provider]) throw new Error('nexora_onboarding_unsupported_provider');
	const clientId = env?.[PROVIDERS[provider].clientIdEnv];
	if (!clientId) {
		// Explicit, honest failure -- never construct a redirect to a provider with no
		// registered application. This is the exact signal the operational-visibility
		// surface (Required Output #26/#31) must show as "provider application missing".
		return { ok: false, reason: 'PROVIDER_APPLICATION_MISSING', provider, requiredEnv: PROVIDERS[provider].clientIdEnv };
	}
	const { scopes, justification } = planScopes(provider, capabilities);
	const { additionalScopes } = existingGrantedScopes.length ? planIncrementalScopes(provider, existingGrantedScopes, capabilities) : { additionalScopes: scopes };
	const verifier = randomVerifier();
	const challenge = await pkceChallengeFor(verifier);
	const state = uuid();
	const nonce = provider === 'google' ? uuid() : null; // OIDC nonce is meaningful for google's id_token; microsoft flow here uses state only
	const id = uuid();
	const expiresAt = new Date(Date.now() + Math.max(60, Math.min(3600, ttlSeconds)) * 1000).toISOString();
	const row = {
		id, onboarding_mission_id: onboardingMissionId, tenant_id: tenantId, workspace_id: workspaceId, provider, client_registration_mode: clientRegistrationMode,
		redirect_uri_id: `nexora_${provider}_redirect_v1`, scopes_json: JSON.stringify(scopes), incremental_scopes_json: JSON.stringify(additionalScopes),
		state_hash: await hexHash(state), nonce_hash: nonce ? await hexHash(nonce) : null, pkce_challenge: challenge, pkce_challenge_method: 'S256',
		pkce_verifier_hash: await hexHash(verifier), tenant_hint: tenantHint, login_hint_hash: loginHint ? await hexHash(loginHint) : null, expires_at: expiresAt,
	};
	return { ok: true, row, verifier, state, nonce, scopeJustification: justification, authorizationUrl: buildAuthorizationUrl(provider, { clientId, state, nonce, challenge, scopes, tenantHint, loginHint }) };
}

function buildAuthorizationUrl(provider, { clientId, state, nonce, challenge, scopes, tenantHint, loginHint }) {
	const spec = PROVIDERS[provider];
	const base = spec.authorizationEndpoint.replace('{tenant}', tenantHint || 'organizations');
	const params = new URLSearchParams({
		client_id: clientId,
		response_type: 'code',
		redirect_uri: `https://REDACTED_REDIRECT_URI/${provider}`, // real value injected at deploy time by the redirect_uri_id -> config mapping, never invented here
		scope: scopes.join(' '),
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		access_type: provider === 'google' ? 'offline' : undefined,
		prompt: provider === 'google' ? 'consent' : undefined,
	});
	if (provider === 'google' && nonce) params.set('nonce', nonce);
	if (loginHint) params.set('login_hint', loginHint);
	for (const [key, value] of [...params.entries()]) if (value === undefined || value === 'undefined') params.delete(key);
	return `${base}?${params.toString()}`;
}

async function insertAuthorizationSession(c, row) {
	await c.env.db
		.prepare(`INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,client_registration_mode,redirect_uri_id,scopes_json,incremental_scopes_json,state_hash,nonce_hash,pkce_challenge,pkce_challenge_method,pkce_verifier_hash,tenant_hint,login_hint_hash,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`)
		.bind(row.id, row.onboarding_mission_id, row.tenant_id, row.workspace_id, row.provider, row.client_registration_mode, row.redirect_uri_id, row.scopes_json, row.incremental_scopes_json, row.state_hash, row.nonce_hash, row.pkce_challenge, row.pkce_challenge_method, row.pkce_verifier_hash, row.tenant_hint, row.login_hint_hash, row.expires_at)
		.run();
}

// Single-use, replay-safe callback consumption. A duplicate callback (same state delivered
// twice, e.g. a provider or browser retry) must be idempotent-safe: the SECOND attempt must
// never re-trigger token exchange or double-advance the Mission, but must also not be treated
// as an error the caller needs to surface -- it is harmless by construction (status check).
async function consumeCallback(c, scope, { state, verifier, receivedCallbackFingerprint }) {
	const stateHash = await hexHash(state);
	const session = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_authorization_sessions WHERE tenant_id=?1 AND workspace_id=?2 AND state_hash=?3`).bind(scope.tenantId, scope.workspaceId, stateHash).first();
	if (!session) return { ok: false, reason: 'INVALID_STATE' }; // fails closed -- never guesses which session this belongs to
	if (session.status === 'consumed') return { ok: true, duplicate: true, alreadyConsumed: true, resumeCheckpoint: session.resume_checkpoint, onboardingMissionId: session.onboarding_mission_id, provider: session.provider };
	if (session.status !== 'pending') return { ok: false, reason: `SESSION_${session.status.toUpperCase()}` };
	if (Date.parse(session.expires_at) <= Date.now()) {
		await c.env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET status='expired' WHERE id=?1 AND status='pending'`).bind(session.id).run();
		return { ok: false, reason: 'SESSION_EXPIRED' };
	}
	const verifierHash = await hexHash(verifier);
	if (verifierHash !== session.pkce_verifier_hash) return { ok: false, reason: 'PKCE_MISMATCH' };
	const result = await c.env.db
		.prepare(`UPDATE nexora_onboarding_authorization_sessions SET status='consumed',consumed_at=CURRENT_TIMESTAMP,callback_fingerprint=?2,resume_checkpoint=?3 WHERE id=?1 AND status='pending'`)
		.bind(session.id, receivedCallbackFingerprint || null, `resume:${session.onboarding_mission_id}`)
		.run();
	if (!result.meta?.changes) {
		// Lost the race to a concurrent consumer (e.g. duplicate delivery arriving at the exact
		// same instant) -- treat exactly like an already-consumed duplicate, not an error.
		return { ok: true, duplicate: true, alreadyConsumed: true, resumeCheckpoint: `resume:${session.onboarding_mission_id}`, onboardingMissionId: session.onboarding_mission_id, provider: session.provider };
	}
	return { ok: true, duplicate: false, onboardingMissionId: session.onboarding_mission_id, provider: session.provider, resumeCheckpoint: `resume:${session.onboarding_mission_id}` };
}

async function cancelAuthorizationSession(c, scope, sessionId) {
	const result = await c.env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET status='cancelled' WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status='pending'`).bind(sessionId, scope.tenantId, scope.workspaceId).run();
	return Boolean(result.meta?.changes);
}

// -- Identity / tenant validation (pure predicates over a caller-supplied provider response)
function validateIdentity({ expectedLoginHint, providerSubject, providerEmail }) {
	if (!providerSubject) return { valid: false, reason: 'IDENTITY_SUBJECT_MISSING' };
	if (expectedLoginHint && providerEmail && expectedLoginHint.toLowerCase() !== String(providerEmail).toLowerCase()) {
		return { valid: false, reason: 'IDENTITY_CONFLICT', expected: expectedLoginHint, observed: providerEmail };
	}
	return { valid: true };
}
function validateMicrosoftTenant({ allowedTenantIds, observedTenantId }) {
	if (!observedTenantId) return { valid: false, reason: 'TENANT_ID_MISSING' };
	if (Array.isArray(allowedTenantIds) && allowedTenantIds.length && !allowedTenantIds.includes(observedTenantId)) {
		return { valid: false, reason: 'TENANT_POLICY_DENIED', observedTenantId };
	}
	return { valid: true, observedTenantId };
}
function validateGrantedScopes({ requiredScopes, grantedScopes }) {
	const granted = new Set(grantedScopes || []);
	const missing = (requiredScopes || []).filter((scope) => !granted.has(scope));
	return { valid: missing.length === 0, missingScopes: missing };
}

// -- Capability discovery: reuses the already-verified provider-capability-contract-service
// decide() function (NEXORA kernel audit) rather than re-implementing decision logic, mapped
// into the exact 7-state enum this mission requires.
function mapDecisionToCapabilityState(decision) {
	const map = {
		authorization_missing: 'ADMIN_APPROVAL_REQUIRED', needs_reconnect: 'CONSENT_REQUIRED', approval_required: 'CONSENT_REQUIRED',
		authorization_stale: 'CONSENT_REQUIRED', temporarily_unavailable: 'TEMPORARILY_UNAVAILABLE', capability_unavailable: 'UNSUPPORTED', policy_denied: 'POLICY_DENIED',
	};
	if (decision.providerToolPermitted) return 'SUPPORTED';
	return map[decision.result] || 'DEGRADED';
}
async function discoverCapability(c, scope, { onboardingMissionId, provider, capabilityKey, decisionInput }) {
	const decision = decideProviderAction(decisionInput);
	const status = mapDecisionToCapabilityState(decision);
	if (!CAPABILITY_STATES.has(status)) throw new Error('nexora_onboarding_capability_state_invalid');
	await c.env.db
		.prepare(`INSERT INTO nexora_onboarding_capabilities(id,onboarding_mission_id,tenant_id,workspace_id,provider,capability_key,status,reason_codes_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(onboarding_mission_id,capability_key) DO UPDATE SET status=excluded.status,reason_codes_json=excluded.reason_codes_json,observed_at=CURRENT_TIMESTAMP`)
		.bind(uuid(), onboardingMissionId, scope.tenantId, scope.workspaceId, provider, capabilityKey, status, JSON.stringify(decision.reasonCodes || []))
		.run();
	return { status, reasonCodes: decision.reasonCodes || [] };
}

export { PROVIDERS, CAPABILITY_SCOPES, CAPABILITY_STATES, planScopes, planIncrementalScopes, randomVerifier, pkceChallengeFor, buildAuthorizationUrl, insertAuthorizationSession, cancelAuthorizationSession, validateIdentity, validateMicrosoftTenant, validateGrantedScopes, mapDecisionToCapabilityState };
export default { createAuthorizationSession, consumeCallback, cancelAuthorizationSession, discoverCapability, planScopes, planIncrementalScopes, validateIdentity, validateMicrosoftTenant, validateGrantedScopes };
