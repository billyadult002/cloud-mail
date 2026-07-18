// NEXORA Zero-Touch onboarding: OAuth contract, PKCE, scope planning, incremental consent,
// identity/tenant validation, and capability discovery. Deterministic tests (no network) plus
// real pool-workers D1 tests for the durable authorization-session lifecycle (Checkpoints 3-8
// of the Zero-Touch OAuth Logic Completion mission). No live Google/Microsoft credentials are
// used or required -- this proves logic correctness only, exactly per this mission's own
// scope boundary (missing production OAuth credentials block provider ACCEPTANCE, not logic
// verification).
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import onboardingOAuth, {
	PROVIDERS,
	planScopes,
	planIncrementalScopes,
	randomVerifier,
	pkceChallengeFor,
	buildAuthorizationUrl,
	buildMicrosoftAdminConsentUrl,
	insertAuthorizationSession,
	validateIdentity,
	validateMicrosoftTenant,
	validateGrantedScopes,
	mapDecisionToCapabilityState,
} from '../../src/service/nexora-onboarding-oauth-service.js';

const TENANT_ID = 990301;
const WORKSPACE_ID = 990302;
const GOOGLE_OAUTH_ENV = { NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: 'https://nexora.example/v3/onboarding/providers/google/callback' };

const SCHEMA = [
	`CREATE TABLE nexora_onboarding_authorization_sessions (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
		client_registration_mode TEXT NOT NULL CHECK(client_registration_mode IN ('first_party','byo_app')),
		redirect_uri_id TEXT NOT NULL, scopes_json TEXT NOT NULL, incremental_scopes_json TEXT NOT NULL DEFAULT '[]',
		state_hash TEXT NOT NULL, nonce_hash TEXT, pkce_challenge TEXT NOT NULL, pkce_challenge_method TEXT NOT NULL DEFAULT 'S256',
		pkce_verifier_hash TEXT NOT NULL, tenant_hint TEXT, login_hint_hash TEXT,
		status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed','expired','cancelled','error')),
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, consumed_at TEXT,
		callback_fingerprint TEXT, resume_checkpoint TEXT,
		UNIQUE(tenant_id,workspace_id,state_hash)
	)`,
	`CREATE TABLE nexora_onboarding_capabilities (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		provider TEXT NOT NULL, capability_key TEXT NOT NULL,
		status TEXT NOT NULL CHECK(status IN ('SUPPORTED','UNSUPPORTED','CONSENT_REQUIRED','ADMIN_APPROVAL_REQUIRED','POLICY_DENIED','TEMPORARILY_UNAVAILABLE','DEGRADED')),
		reason_codes_json TEXT NOT NULL DEFAULT '[]', observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(onboarding_mission_id, capability_key)
	)`,
	`CREATE TABLE nexora_onboarding_callback_correlations (
		id TEXT PRIMARY KEY, state_hash TEXT NOT NULL UNIQUE, authorization_session_id TEXT NOT NULL UNIQUE,
		onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, provider TEXT NOT NULL,
		redirect_uri_id TEXT NOT NULL, redirect_uri_hash TEXT NOT NULL, requested_scopes_json TEXT NOT NULL, requested_capabilities_json TEXT NOT NULL DEFAULT '[]', scope_plan_reference TEXT, pkce_challenge TEXT NOT NULL, pkce_challenge_reference TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending', claim_token TEXT, claimed_at TEXT, claimed_by TEXT, claim_expires_at TEXT, claim_generation INTEGER NOT NULL DEFAULT 0,
		callback_fingerprint TEXT, resume_checkpoint TEXT, evidence_references_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, consumed_at TEXT, cancelled_at TEXT
	)`,
	`CREATE TABLE nexora_onboarding_callback_claims (id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL UNIQUE, authorization_session_id TEXT NOT NULL, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, provider TEXT NOT NULL, lease_owner TEXT, lease_acquired_at TEXT, lease_expires_at TEXT, fencing_token INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, recovery_mode TEXT NOT NULL DEFAULT 'EXECUTION', claim_status TEXT NOT NULL DEFAULT 'AVAILABLE', last_heartbeat_at TEXT, takeover_count INTEGER NOT NULL DEFAULT 0, evidence_references_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_onboarding_callback_checkpoints (id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL, claim_id TEXT NOT NULL, fencing_token INTEGER NOT NULL, step TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, started_at TEXT, observed_at TEXT, persisted_at TEXT, completed_at TEXT, provider_operation_reference TEXT, token_generation_reference INTEGER, connection_reference TEXT, sync_job_reference TEXT, mission_checkpoint_reference TEXT, evidence_references_json TEXT NOT NULL DEFAULT '[]', last_error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(correlation_id,step))`,
];

async function resetSchema() {
	await env.db.batch([env.db.prepare(`DROP TABLE IF EXISTS nexora_onboarding_callback_checkpoints`), env.db.prepare(`DROP TABLE IF EXISTS nexora_onboarding_callback_claims`), env.db.prepare(`DROP TABLE IF EXISTS nexora_onboarding_callback_correlations`), env.db.prepare(`DROP TABLE IF EXISTS nexora_onboarding_authorization_sessions`), env.db.prepare(`DROP TABLE IF EXISTS nexora_onboarding_capabilities`)]);
	for (const sql of SCHEMA) await env.db.prepare(sql).run();
}

const c = { env };
const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };

beforeEach(async () => {
	await resetSchema();
});

describe('PKCE (RFC 7636) — deterministic, no network', () => {
	it('generates a verifier within the RFC length bound and a matching S256 challenge', async () => {
		const verifier = randomVerifier();
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(verifier.length).toBeLessThanOrEqual(128);
		expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
		const challenge = await pkceChallengeFor(verifier);
		expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		// deterministic: same verifier always yields the same challenge
		expect(await pkceChallengeFor(verifier)).toBe(challenge);
	});

	it('produces distinct verifiers across calls (not fixed/fabricated)', () => {
		const values = new Set(Array.from({ length: 20 }, () => randomVerifier()));
		expect(values.size).toBe(20);
	});
});

describe('Minimum-scope planning and incremental consent — deterministic', () => {
	it('requests only the scopes a specific capability requires, plus identity scopes, never more', () => {
		const { scopes, justification } = planScopes('google', ['mail_read']);
		expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
		expect(scopes).not.toContain('https://www.googleapis.com/auth/gmail.send');
		expect(scopes).not.toContain('https://www.googleapis.com/auth/calendar.readonly');
		expect(justification.mail_read).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
	});

	it('incremental consent adds only the newly-required scope, keeps existing usable authority', () => {
		const { scopes: readScopes } = planScopes('microsoft', ['mail_read']);
		const { additionalScopes, allScopesAfterGrant } = planIncrementalScopes('microsoft', readScopes, ['mail_send']);
		expect(additionalScopes).toEqual(['Mail.Send']);
		expect(allScopesAfterGrant).toEqual(expect.arrayContaining([...readScopes, 'Mail.Send']));
		expect(allScopesAfterGrant.length).toBe(new Set(allScopesAfterGrant).size); // no duplicates
	});

	it('rejects an unknown capability rather than silently granting broad access', () => {
		expect(() => planScopes('google', ['send_everything_hypothetical_future_feature'])).toThrow(/unknown_capability/);
	});
});

describe('Authorization URL construction — deterministic, contains no client secret', () => {
	it('builds a Google URL with PKCE, state, and no client secret', () => {
		const url = buildAuthorizationUrl('google', { clientId: 'test-client-id.apps.googleusercontent.com', redirectUri: GOOGLE_OAUTH_ENV.NEXORA_GOOGLE_OAUTH_REDIRECT_URI, state: 'state-abc', nonce: 'nonce-abc', challenge: 'challenge-abc', scopes: ['openid', 'email'], tenantHint: null, loginHint: null });
		expect(url).toContain('accounts.google.com');
		expect(url).toContain('code_challenge=challenge-abc');
		expect(url).toContain('code_challenge_method=S256');
		expect(url).toContain('state=state-abc');
		expect(url).not.toContain('client_secret');
	});

	it('builds a Microsoft URL scoped to the given tenant hint', () => {
		const url = buildAuthorizationUrl('microsoft', { clientId: 'ms-client-id', redirectUri: 'https://nexora.example/v3/onboarding/providers/microsoft/callback', state: 'state-xyz', nonce: null, challenge: 'challenge-xyz', scopes: ['Mail.Read'], tenantHint: 'contoso-tenant-id', loginHint: null });
		expect(url).toContain('login.microsoftonline.com/contoso-tenant-id/');
		expect(url).not.toContain('client_secret');
	});

	it('builds an administrator-consent URL without exposing a client secret', () => {
		const url = buildMicrosoftAdminConsentUrl({ tenantId: 'tenant-a', clientId: 'client-a', redirectUri: 'https://nexora.example/callback' });
		expect(url).toContain('/tenant-a/adminconsent');
		expect(url).toContain('client_id=client-a');
		expect(url).not.toContain('client_secret');
	});
});

describe('Identity, tenant, and granted-scope validation — deterministic', () => {
	it('flags an identity conflict when the callback returns a different account than the one the user started with', () => {
		expect(validateIdentity({ expectedLoginHint: 'user@example.com', providerSubject: 'sub-1', providerEmail: 'user@example.com' }).valid).toBe(true);
		const conflict = validateIdentity({ expectedLoginHint: 'user@example.com', providerSubject: 'sub-1', providerEmail: 'other@example.com' });
		expect(conflict.valid).toBe(false);
		expect(conflict.reason).toBe('IDENTITY_CONFLICT');
	});

	it('enforces Microsoft tenant restrictions when a policy allow-list is configured', () => {
		expect(validateMicrosoftTenant({ allowedTenantIds: ['tenant-a'], observedTenantId: 'tenant-a' }).valid).toBe(true);
		expect(validateMicrosoftTenant({ allowedTenantIds: ['tenant-a'], observedTenantId: 'tenant-b' }).valid).toBe(false);
		expect(validateMicrosoftTenant({ allowedTenantIds: [], observedTenantId: 'tenant-anything' }).valid).toBe(true); // no restriction configured
	});

	it('detects missing granted scopes precisely', () => {
		const result = validateGrantedScopes({ requiredScopes: ['Mail.Read', 'Mail.Send'], grantedScopes: ['Mail.Read'] });
		expect(result.valid).toBe(false);
		expect(result.missingScopes).toEqual(['Mail.Send']);
	});
});

describe('Capability discovery — maps the already-verified decide() output to the 7-state enum', () => {
	it('maps a fully-supported decision to SUPPORTED and persists it', async () => {
		const decisionInput = { scopeValid: true, identityValid: true, credentialStatus: 'active', credentialGenerationValid: true, authorityStatus: 'active', capabilities: [{ key: 'mail_read', status: 'supported', expiresAt: new Date(Date.now() + 900000).toISOString() }], requirement: { requiredCapabilities: ['mail_read'], approvalRequired: false, allowDegraded: false }, paramsValid: true, fencingValid: true };
		const result = await onboardingOAuth.discoverCapability(c, scope, { onboardingMissionId: 'ob-1', provider: 'google', capabilityKey: 'mail_read', decisionInput });
		expect(result.status).toBe('SUPPORTED');
		const row = await env.db.prepare(`SELECT status FROM nexora_onboarding_capabilities WHERE onboarding_mission_id='ob-1' AND capability_key='mail_read'`).first();
		expect(row.status).toBe('SUPPORTED');
	});

	it('maps a missing-authority decision to ADMIN_APPROVAL_REQUIRED, and a stale-credential decision to CONSENT_REQUIRED', () => {
		expect(mapDecisionToCapabilityState({ providerToolPermitted: false, result: 'authorization_missing' })).toBe('ADMIN_APPROVAL_REQUIRED');
		expect(mapDecisionToCapabilityState({ providerToolPermitted: false, result: 'authorization_stale' })).toBe('CONSENT_REQUIRED');
		expect(mapDecisionToCapabilityState({ providerToolPermitted: false, result: 'temporarily_unavailable' })).toBe('TEMPORARILY_UNAVAILABLE');
	});
});

describe('Durable authorization session — real D1 persistence, restart-safe, replay-safe', () => {
	it('E9/V5: without a configured client_id, session creation fails honestly with PROVIDER_APPLICATION_MISSING (no fabricated redirect)', async () => {
		const result = await onboardingOAuth.createAuthorizationSession({}, { onboardingMissionId: 'ob-2', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, provider: 'google', capabilities: ['mail_read'] });
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('PROVIDER_APPLICATION_MISSING');
		expect(result.requiredEnv).toBe('NEXORA_GOOGLE_OAUTH_CLIENT_ID');
	});

	it('E14/V17: a created session survives being re-read after a simulated restart (fresh read from D1, not in-memory)', async () => {
		const fakeEnv = GOOGLE_OAUTH_ENV;
		const created = await onboardingOAuth.createAuthorizationSession(fakeEnv, { onboardingMissionId: 'ob-3', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, provider: 'google', capabilities: ['mail_read'] });
		expect(created.ok).toBe(true);
		await insertAuthorizationSession(c, created.row);
		// Simulate "restart": re-fetch from D1 with a brand-new lookup, no reference to `created`.
		const reread = await env.db.prepare(`SELECT * FROM nexora_onboarding_authorization_sessions WHERE id=?1`).bind(created.row.id).first();
		expect(reread.status).toBe('pending');
		expect(reread.onboarding_mission_id).toBe('ob-3');
	});

	it('V8/V11: a valid callback consumes the session exactly once (state + PKCE verifier must both match)', async () => {
		const fakeEnv = GOOGLE_OAUTH_ENV;
		const created = await onboardingOAuth.createAuthorizationSession(fakeEnv, { onboardingMissionId: 'ob-4', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, provider: 'google', capabilities: ['mail_read'] });
		await insertAuthorizationSession(c, created.row);

		// PKCE mismatch: wrong verifier must be rejected, session stays pending.
		const mismatch = await onboardingOAuth.consumeCallback(c, scope, { state: created.state, verifier: 'wrong-verifier-value-not-matching-the-real-one', receivedCallbackFingerprint: 'fp-1' });
		expect(mismatch.ok).toBe(false);
		expect(mismatch.reason).toBe('PKCE_MISMATCH');
		const stillPending = await env.db.prepare(`SELECT status FROM nexora_onboarding_authorization_sessions WHERE id=?1`).bind(created.row.id).first();
		expect(stillPending.status).toBe('pending');

		const correct = await onboardingOAuth.consumeCallback(c, scope, { state: created.state, verifier: created.verifier, receivedCallbackFingerprint: 'fp-1' });
		expect(correct.ok).toBe(true);
		expect(correct.duplicate).toBe(false);
		expect(correct.onboardingMissionId).toBe('ob-4');

		// V9: a duplicate delivery of the exact same callback must be idempotent-safe, not an error.
		const duplicate = await onboardingOAuth.consumeCallback(c, scope, { state: created.state, verifier: created.verifier, receivedCallbackFingerprint: 'fp-1' });
		expect(duplicate.ok).toBe(true);
		expect(duplicate.duplicate).toBe(true);
		expect(duplicate.inProgress).toBe(true);
		expect(duplicate.alreadyConsumed).toBe(false);

		const consumedCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_authorization_sessions WHERE id=?1 AND status='consumed'`).bind(created.row.id).first();
		expect(Number(consumedCount.n)).toBe(1); // exactly one consumption, no duplicate side effect
	});

	it('V7: state cannot be replayed across a different authorization session (INVALID_STATE, fails closed)', async () => {
		const fakeEnv = GOOGLE_OAUTH_ENV;
		const created = await onboardingOAuth.createAuthorizationSession(fakeEnv, { onboardingMissionId: 'ob-5', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, provider: 'google', capabilities: ['mail_read'] });
		await insertAuthorizationSession(c, created.row);
		const result = await onboardingOAuth.consumeCallback(c, scope, { state: 'a-state-that-was-never-issued', verifier: created.verifier, receivedCallbackFingerprint: 'fp-x' });
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('INVALID_STATE');
	});

	it('correlates a provider callback from durable state, never an asserted workspace', async () => {
		const created = await onboardingOAuth.createAuthorizationSession(GOOGLE_OAUTH_ENV, { onboardingMissionId: 'ob-correlation', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, provider: 'google', capabilities: ['mail_read'] });
		await insertAuthorizationSession(c, created.row);
		const consumed = await onboardingOAuth.consumeCallback(c, null, { state: created.state, verifier: created.verifier, expectedProvider: 'google' });
		expect(consumed.ok).toBe(true);
		expect(consumed.scope).toEqual(scope);
		const wrongScope = await onboardingOAuth.consumeCallback(c, { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID + 1 }, { state: created.state, verifier: created.verifier, expectedProvider: 'google' });
		expect(wrongScope.ok).toBe(false);
		expect(wrongScope.reason).toBe('INVALID_STATE');
	});

	it('V10: an expired authorization session does not exchange codes, even with a correct verifier', async () => {
		const fakeEnv = GOOGLE_OAUTH_ENV;
		const created = await onboardingOAuth.createAuthorizationSession(fakeEnv, { onboardingMissionId: 'ob-6', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, provider: 'google', capabilities: ['mail_read'], ttlSeconds: 60 });
		await insertAuthorizationSession(c, created.row);
		await env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET expires_at=datetime('now','-1 minutes') WHERE id=?1`).bind(created.row.id).run();
		const result = await onboardingOAuth.consumeCallback(c, scope, { state: created.state, verifier: created.verifier, receivedCallbackFingerprint: 'fp-y' });
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('SESSION_EXPIRED');
		const row = await env.db.prepare(`SELECT status FROM nexora_onboarding_authorization_sessions WHERE id=?1`).bind(created.row.id).first();
		expect(row.status).toBe('expired');
	});

	it('cancellation before callback: a pending session can be cancelled and can never later be consumed', async () => {
		const fakeEnv = GOOGLE_OAUTH_ENV;
		const created = await onboardingOAuth.createAuthorizationSession(fakeEnv, { onboardingMissionId: 'ob-7', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, provider: 'google', capabilities: ['mail_read'] });
		await insertAuthorizationSession(c, created.row);
		const cancelled = await onboardingOAuth.cancelAuthorizationSession(c, scope, created.row.id);
		expect(cancelled).toBe(true);
		const result = await onboardingOAuth.consumeCallback(c, scope, { state: created.state, verifier: created.verifier, receivedCallbackFingerprint: 'fp-z' });
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('SESSION_CANCELLED');
	});

	it('scope guard: real query row never contains a raw client secret, access token, refresh token, or PKCE verifier', async () => {
		const fakeEnv = GOOGLE_OAUTH_ENV;
		const created = await onboardingOAuth.createAuthorizationSession(fakeEnv, { onboardingMissionId: 'ob-8', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, provider: 'google', capabilities: ['mail_read'] });
		await insertAuthorizationSession(c, created.row);
		const row = await env.db.prepare(`SELECT * FROM nexora_onboarding_authorization_sessions WHERE id=?1`).bind(created.row.id).first();
		const serialized = JSON.stringify(row);
		expect(serialized).not.toContain(created.verifier); // only pkce_verifier_hash is stored
		expect(row.pkce_verifier_hash).not.toBe(created.verifier);
		expect(Object.keys(row)).not.toContain('client_secret');
		expect(Object.keys(row)).not.toContain('access_token');
		expect(Object.keys(row)).not.toContain('refresh_token');
	});
});
