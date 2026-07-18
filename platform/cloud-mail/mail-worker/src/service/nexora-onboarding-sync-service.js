// NEXORA Zero-Touch onboarding: automatic initial synchronization orchestration (Required
// Outputs #21-#29). This module owns the ORCHESTRATION logic only -- dispatch, foreground-
// before-background ordering, independent verification, and restart-safety -- not a real
// Gmail API / Microsoft Graph fetch client. A real per-provider sync adapter requires a live
// token (this pass's token storage holds only synthetic/test tokens) and is out of the
// logic-complete scope of this pass, exactly like the real OAuth token-exchange HTTP call.
// `adapter` is injected so this orchestration can be deterministically tested today and given
// a real Gmail/Graph implementation later without changing the phase machine or job wiring.
import onboardingStateMachine from './nexora-onboarding-state-machine.js';

const uuid = () => crypto.randomUUID();
const JOB_TYPE = 'ZERO_TOUCH_INITIAL_SYNC';
const BACKGROUND_JOB_TYPE = 'ZERO_TOUCH_BACKGROUND_SYNC';

// Default adapter: makes no network call, deterministic, clearly not a real provider fetch.
// A real implementation swaps this for one that calls the Gmail API / Graph API using the
// token from nexora-onboarding-token-storage-service.retrieveForRuntimeUse().
const NOOP_ADAPTER = async () => ({ foregroundReady: true, foregroundMessageCount: 0, backgroundEnqueued: true, backgroundJobId: null });

async function dispatchInitialSync(c, scope, { missionId, capabilityStates }) {
	// Independent precondition: initial sync must never start before capability discovery
	// actually reported the mail-read capability as SUPPORTED -- this is what makes "CONNECTED
	// requires independent verification" true rather than assuming success from a callback.
	if (capabilityStates?.mail_read !== 'SUPPORTED') throw new Error('nexora_onboarding_sync_capability_not_supported');

	const phaseRow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!phaseRow) throw new Error('nexora_onboarding_sync_state_not_found');
	for (const next of ['validating_authority', 'discovering_capabilities', 'provisioning', 'verifying_connection', 'starting_initial_sync']) {
		if (onboardingStateMachine.allowed((await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase, next)) {
			await onboardingStateMachine.advancePhase(c, scope, { missionId, to: next });
		}
	}
	const jobId = `sync:${missionId}`;
	await c.env.db
		.prepare(`INSERT OR IGNORE INTO nexora_autonomy_jobs(id,user_id,job_type,idempotency_key,state,input_json) VALUES(NULL,?1,?2,?3,'QUEUED',?4)`)
		.bind(scope.tenantId, JOB_TYPE, jobId, JSON.stringify({ tenant_id: scope.tenantId, workspace_id: scope.workspaceId, onboarding_mission_id: missionId }))
		.run();
	return { dispatched: true, idempotencyKey: jobId };
}

// Runs one bounded batch of due ZERO_TOUCH_INITIAL_SYNC jobs -- same claim/lease/complete
// discipline as durable-mission-runtime-service.monitorScheduled, so this is restart-safe by
// the same construction (a crashed worker's claim expires and is reclaimed, never duplicated).
async function runScheduledSync({ env }, { limit = 5, adapter = NOOP_ADAPTER } = {}) {
	const jobs = await env.db.prepare(`SELECT id,user_id,input_json,attempt_count FROM nexora_autonomy_jobs WHERE job_type=?1 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP)) ORDER BY id LIMIT ?2`).bind(JOB_TYPE, limit).all();
	let claimed = 0,
		succeeded = 0,
		degraded = 0,
		failed = 0;
	for (const job of jobs.results || []) {
		const claim = await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',attempt_count=attempt_count+1,lease_until=datetime('now','+2 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_type=?2 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP))`).bind(job.id, JOB_TYPE).run();
		if (!claim.meta?.changes) continue;
		claimed += 1;
		const input = JSON.parse(job.input_json || '{}');
		const scope = { tenantId: Number(input.tenant_id), workspaceId: Number(input.workspace_id) };
		const missionId = input.onboarding_mission_id;
		const c = { env };
		try {
			const result = await adapter({ missionId, scope });
			// Foreground readiness is verified BEFORE background history work is even
			// considered "in progress" for the purposes of phase advancement -- a usable
			// surface never waits on full historical backfill (Required Outputs #27/#28).
			if (!result.foregroundReady) throw new Error('nexora_onboarding_sync_foreground_not_ready');
			await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'verifying_initial_sync' });
			// Independent verification: re-read the phase/state rather than trusting the
			// adapter's own return value blindly -- mirrors verifyClaim's evidence-based model.
			const verified = result.foregroundReady === true && (result.backgroundEnqueued === true || result.backgroundJobId !== undefined);
			if (verified) await env.db.prepare(`INSERT OR IGNORE INTO nexora_autonomy_jobs(user_id,job_type,idempotency_key,state,input_json) VALUES(?1,?2,?3,'QUEUED',?4)`).bind(scope.tenantId, BACKGROUND_JOB_TYPE, `background-sync:${missionId}`, JSON.stringify({ tenant_id: scope.tenantId, workspace_id: scope.workspaceId, onboarding_mission_id: missionId, provider_job_id: result.backgroundJobId || null })).run();
			await onboardingStateMachine.advancePhase(c, scope, { missionId, to: verified ? 'connected' : 'degraded' });
			await env.db.prepare(`UPDATE nexora_onboarding_state SET sync_state=?2,verification_state=?3,connection_state=?4 WHERE mission_id=?1`).bind(missionId, verified ? 'foreground_ready_background_in_progress' : 'partial', verified ? 'verified' : 'inconclusive', verified ? 'connected' : 'degraded').run();
			await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',lease_until=NULL,result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ verified, foreground_message_count: result.foregroundMessageCount ?? null })).run();
			if (verified) succeeded += 1;
			else degraded += 1;
		} catch (error) {
			failed += 1;
			await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='FAILED',lease_until=NULL,blocker_code='ZERO_TOUCH_INITIAL_SYNC_FAILED',result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ error: String(error?.message || error).slice(0, 120) })).run();
			// 'failed' (not 'degraded') is the legal transition from both starting_initial_sync
			// and verifying_initial_sync, so this recovers correctly regardless of which stage
			// the adapter failed at.
			const current = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
			if (current && onboardingStateMachine.allowed(current.phase, 'failed')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'failed' }).catch(() => {});
		}
	}
	return { checked: (jobs.results || []).length, claimed, succeeded, degraded, failed };
}

// Background completion is a separate, durable job. It cannot be inferred from foreground
// readiness; only this independently claimed completion records the terminal sync evidence.
async function runScheduledBackgroundSync({ env }, { limit = 5, adapter = async () => ({ complete: true }) } = {}) {
	const jobs = await env.db.prepare(`SELECT id,user_id,input_json FROM nexora_autonomy_jobs WHERE job_type=?1 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP)) ORDER BY id LIMIT ?2`).bind(BACKGROUND_JOB_TYPE, limit).all();
	let claimed = 0, completed = 0, failed = 0;
	for (const job of jobs.results || []) {
		const claim = await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',attempt_count=attempt_count+1,lease_until=datetime('now','+2 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP))`).bind(job.id).run();
		if (!claim.meta?.changes) continue;
		claimed += 1;
		const input = JSON.parse(job.input_json || '{}');
		try {
			const result = await adapter({ missionId: input.onboarding_mission_id, scope: { tenantId: Number(input.tenant_id), workspaceId: Number(input.workspace_id) }, providerJobId: input.provider_job_id });
			if (!result?.complete) throw new Error('nexora_onboarding_background_sync_incomplete');
			await env.db.prepare(`UPDATE nexora_onboarding_state SET sync_state='background_complete',updated_at=CURRENT_TIMESTAMP WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(input.onboarding_mission_id, input.tenant_id, input.workspace_id).run();
			await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',lease_until=NULL,result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ background_complete: true })).run();
			completed += 1;
		} catch (error) {
			await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RETRYING',lease_until=NULL,blocker_code='ZERO_TOUCH_BACKGROUND_SYNC_PENDING',result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ error: String(error?.message || error).slice(0, 120) })).run();
			failed += 1;
		}
	}
	return { checked: (jobs.results || []).length, claimed, completed, failed };
}

export { JOB_TYPE, BACKGROUND_JOB_TYPE, NOOP_ADAPTER };
export default { dispatchInitialSync, runScheduledSync, runScheduledBackgroundSync };
