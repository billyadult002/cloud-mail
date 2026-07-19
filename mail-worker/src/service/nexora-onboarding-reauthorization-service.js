// NEXORA-owned reauthorization work. Provider mechanics remain in the normal OAuth service;
// this module owns only durable replacement-session lineage, leasing, and fencing.
import onboardingOAuth, { insertAuthorizationSession } from './nexora-onboarding-oauth-service.js';
import callbackRecovery from './nexora-onboarding-callback-recovery-service.js';

const uuid = () => crypto.randomUUID();
const stableKey = ({ correlationId, provider, reasonCode }) => `reauth:${correlationId}:${provider}:${reasonCode}`;

async function ensureWork(c, claim, { reasonCode = 'REAUTHORIZATION_REQUIRED', expectedTokenGeneration = null } = {}) {
	const checked = await callbackRecovery.assertCurrentClaim(c, claim, { allowedModes: ['REAUTHORIZATION'] });
	if (!checked.ok) return { ok: false, reason: checked.reason };
	const current = checked.claim;
	const correlation = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_correlations WHERE id=?1 AND authorization_session_id=?2 AND onboarding_mission_id=?3 AND tenant_id=?4 AND workspace_id=?5 AND provider=?6`).bind(current.correlation_id, current.authorization_session_id, current.onboarding_mission_id, current.tenant_id, current.workspace_id, current.provider).first();
	if (!correlation) return { ok: false, reason: 'REAUTHORIZATION_CORRELATION_CONFLICT' };
	const token = await c.env.db.prepare(`SELECT rotation_generation FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4`).bind(current.onboarding_mission_id, current.tenant_id, current.workspace_id, current.provider).first();
	const expectedGeneration = expectedTokenGeneration ?? token?.rotation_generation ?? null;
	const key = stableKey({ correlationId: current.correlation_id, provider: current.provider, reasonCode });
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_reauthorization_work(id,original_correlation_id,original_authorization_session_id,onboarding_mission_id,tenant_id,workspace_id,provider,requested_capabilities_json,scope_plan_reference,reason_code,idempotency_key,expected_token_generation) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`).bind(uuid(), current.correlation_id, current.authorization_session_id, current.onboarding_mission_id, current.tenant_id, current.workspace_id, current.provider, correlation.requested_capabilities_json, correlation.scope_plan_reference, reasonCode, key, expectedGeneration).run();
	return { ok: true, work: await c.env.db.prepare(`SELECT * FROM nexora_onboarding_reauthorization_work WHERE original_correlation_id=?1`).bind(current.correlation_id).first() };
}

async function claimWork(c, scope, work, { owner = uuid(), leaseSeconds = 120 } = {}) {
	const seconds = Math.max(30, Math.min(300, Number(leaseSeconds)));
	const result = await c.env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='CLAIMED',lease_owner=?2,lease_acquired_at=CURRENT_TIMESTAMP,lease_expires_at=datetime('now','+' || ?3 || ' seconds'),fencing_token=fencing_token+1,attempt=attempt+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?4 AND workspace_id=?5 AND (status='PENDING' OR (status IN ('CLAIMED','CREATING_SESSION') AND lease_expires_at<CURRENT_TIMESTAMP))`).bind(work.id, owner, seconds, scope.tenantId, scope.workspaceId).run();
	if (!result.meta?.changes) return { ok: false, reason: 'REAUTHORIZATION_IN_PROGRESS', work: await c.env.db.prepare(`SELECT * FROM nexora_onboarding_reauthorization_work WHERE id=?1`).bind(work.id).first() };
	return { ok: true, work: await c.env.db.prepare(`SELECT * FROM nexora_onboarding_reauthorization_work WHERE id=?1`).bind(work.id).first() };
}

async function createReplacementSession(c, scope, work) {
	const current = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_reauthorization_work WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND lease_owner=?4 AND fencing_token=?5 AND status='CLAIMED' AND lease_expires_at>CURRENT_TIMESTAMP`).bind(work.id, scope.tenantId, scope.workspaceId, work.lease_owner, work.fencing_token).first();
	if (!current) return { ok: false, reason: 'STALE_REAUTHORIZATION_WORKER' };
	if (current.replacement_authorization_session_id) return { ok: true, existing: true, sessionId: current.replacement_authorization_session_id };
	const original = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_authorization_sessions WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5`).bind(current.original_authorization_session_id, current.onboarding_mission_id, scope.tenantId, scope.workspaceId, current.provider).first();
	if (!original) return { ok: false, reason: 'REAUTHORIZATION_SESSION_LINEAGE_CONFLICT' };
	const capabilities = JSON.parse(current.requested_capabilities_json || '[]');
	const session = await onboardingOAuth.createAuthorizationSession(c.env, { onboardingMissionId: current.onboarding_mission_id, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider: current.provider, capabilities, tenantHint: original.tenant_hint });
	if (!session.ok) return session;
	await c.env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='CREATING_SESSION',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND lease_owner=?2 AND fencing_token=?3 AND status='CLAIMED' AND lease_expires_at>CURRENT_TIMESTAMP`).bind(current.id, current.lease_owner, current.fencing_token).run();
	await insertAuthorizationSession(c, session.row);
	const replacementCorrelation = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_callback_correlations WHERE authorization_session_id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5`).bind(session.row.id, current.onboarding_mission_id, scope.tenantId, scope.workspaceId, current.provider).first();
	if (!replacementCorrelation) return { ok: false, reason: 'REAUTHORIZATION_REPLACEMENT_CORRELATION_MISSING' };
	const committed = await c.env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET replacement_authorization_session_id=?2,replacement_correlation_id=?3,status='WAITING_FOR_USER',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?4 AND workspace_id=?5 AND lease_owner=?6 AND fencing_token=?7 AND status='CREATING_SESSION' AND lease_expires_at>CURRENT_TIMESTAMP AND replacement_authorization_session_id IS NULL`).bind(current.id, session.row.id, replacementCorrelation.id, scope.tenantId, scope.workspaceId, current.lease_owner, current.fencing_token).run();
	if (!committed.meta?.changes) return { ok: false, reason: 'REAUTHORIZATION_COMMIT_CONFLICT' };
	return { ok: true, sessionId: session.row.id, authorizationUrl: session.authorizationUrl, expiresAt: session.row.expires_at, state: session.state, verifier: session.verifier };
}

export { ensureWork, claimWork, createReplacementSession };
export default { ensureWork, claimWork, createReplacementSession };
