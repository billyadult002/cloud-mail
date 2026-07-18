// NEXORA Zero-Touch onboarding: token lifecycle / revocation / outage recovery — deterministic
// classification logic plus one real-D1 repair-attempt audit test.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import tokenLifecycle, { classifyTokenHealth, classifyRefreshFailure, planBackoff, planRevocationRepair } from '../../src/service/nexora-onboarding-token-lifecycle-service.js';

describe('Token health classification — deterministic', () => {
	it('reports healthy, expiring_soon, expired_refreshable, expired_unrefreshable precisely', () => {
		expect(classifyTokenHealth({ expiresAt: new Date(Date.now() + 3600000).toISOString(), hasRefreshToken: true }).health).toBe('healthy');
		expect(classifyTokenHealth({ expiresAt: new Date(Date.now() + 60000).toISOString(), hasRefreshToken: true }).health).toBe('expiring_soon');
		expect(classifyTokenHealth({ expiresAt: new Date(Date.now() - 1000).toISOString(), hasRefreshToken: true }).health).toBe('expired_refreshable');
		expect(classifyTokenHealth({ expiresAt: new Date(Date.now() - 1000).toISOString(), hasRefreshToken: false }).health).toBe('expired_unrefreshable');
	});
});

describe('Refresh-failure classification — maps real OAuth error codes to precise repair actions', () => {
	it('V12: revoked consent (invalid_grant) produces REQUEST_REAUTHORIZATION, not a generic failure', () => {
		const result = classifyRefreshFailure({ errorCode: 'invalid_grant', httpStatus: 400 });
		expect(result.classification).toBe('REVOKED');
		expect(result.repairAction).toBe('REQUEST_REAUTHORIZATION');
		expect(result.destructive).toBe(false);
	});

	it('V19: a provider outage (5xx / temporarily_unavailable) is a recoverable state, not a permanent failure', () => {
		expect(classifyRefreshFailure({ errorCode: 'temporarily_unavailable', httpStatus: 503 }).classification).toBe('PROVIDER_OUTAGE');
		expect(classifyRefreshFailure({ errorCode: null, httpStatus: 502 }).classification).toBe('PROVIDER_OUTAGE');
		expect(classifyRefreshFailure({ errorCode: null, httpStatus: 502 }).repairAction).toBe('RETRY_WITH_BACKOFF');
	});

	it('classifies provider throttling and missing-scope distinctly from a generic outage', () => {
		expect(classifyRefreshFailure({ errorCode: null, httpStatus: 429 }).classification).toBe('PROVIDER_THROTTLING');
		expect(classifyRefreshFailure({ errorCode: 'insufficient_scope', httpStatus: 403 }).classification).toBe('MISSING_SCOPE');
		expect(classifyRefreshFailure({ errorCode: 'insufficient_scope', httpStatus: 403 }).repairAction).toBe('REQUEST_INCREMENTAL_CONSENT');
	});

	it('fails closed to ESCALATE_TO_BLOCKED for an unrecognized error, never a silent infinite retry', () => {
		const result = classifyRefreshFailure({ errorCode: 'some_never_seen_provider_error', httpStatus: 418 });
		expect(result.classification).toBe('UNKNOWN');
		expect(result.repairAction).toBe('ESCALATE_TO_BLOCKED');
	});
});

describe('Backoff planning — bounded, never an unbounded retry storm', () => {
	it('grows exponentially and caps at maxSeconds', () => {
		expect(planBackoff({ attempt: 1, baseSeconds: 30, maxSeconds: 3600 }).nextAttemptInSeconds).toBe(30);
		expect(planBackoff({ attempt: 2, baseSeconds: 30, maxSeconds: 3600 }).nextAttemptInSeconds).toBe(60);
		expect(planBackoff({ attempt: 10, baseSeconds: 30, maxSeconds: 3600 }).nextAttemptInSeconds).toBe(3600);
		expect(planBackoff({ attempt: 10, baseSeconds: 30, maxSeconds: 3600 }).capped).toBe(true);
	});
});

describe('Revoked-consent repair — precise minimal reauthorization, not a broad re-request', () => {
	it('requests exactly the previously granted scopes, sorted, deterministic', () => {
		const result = planRevocationRepair({ previouslyGrantedScopes: ['openid', 'https://www.googleapis.com/auth/gmail.readonly', 'email'] });
		expect(result.requiredScopes).toEqual(['email', 'https://www.googleapis.com/auth/gmail.readonly', 'openid']);
		expect(result.reason).toBe('REVOKED_CONSENT_REPAIR');
	});

	it('refuses to plan a repair with no scope history rather than guessing a scope set', () => {
		expect(() => planRevocationRepair({ previouslyGrantedScopes: [] })).toThrow('nexora_onboarding_revocation_repair_missing_prior_scopes');
	});
});

describe('Repair-attempt audit trail — real D1', () => {
	const SCHEMA = `CREATE TABLE mission_runtime_events (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT, step_id TEXT, action_id TEXT,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, event_type TEXT NOT NULL,
		from_state TEXT, to_state TEXT, expected_version INTEGER, fencing_token INTEGER,
		detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`;
	const c = { env };
	const scope = { tenantId: 990501, workspaceId: 990502 };

	beforeEach(async () => {
		await env.db.prepare(`DROP TABLE IF EXISTS mission_runtime_events`).run();
		await env.db.prepare(SCHEMA).run();
	});

	it('records a repair attempt tied to the onboarding mission, queryable after the call', async () => {
		await tokenLifecycle.recordRepairAttempt(c, scope, { onboardingMissionId: 'ob-tok-1', runId: 'run-1', classification: 'REVOKED', repairAction: 'REQUEST_REAUTHORIZATION', attempt: 1 });
		const row = await env.db.prepare(`SELECT event_type,detail_json FROM mission_runtime_events WHERE mission_id='ob-tok-1'`).first();
		expect(row.event_type).toBe('TOKEN_LIFECYCLE_REPAIR_ATTEMPT');
		const detail = JSON.parse(row.detail_json);
		expect(detail.classification).toBe('REVOKED');
		expect(detail.repair_action).toBe('REQUEST_REAUTHORIZATION');
	});
});
