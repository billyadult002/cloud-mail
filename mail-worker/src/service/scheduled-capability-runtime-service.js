import durableMissionRuntime from './durable-mission-runtime-service.js';
import { invokeCapability } from './capability-invocation-service.js';
import { hash } from './durable-mission-runtime-service.js';

const JOB_TYPE = 'MISSION_RUNTIME_CAPABILITY_SEARCH_EMAIL';
const CAPABILITY = 'search_email';
const RATE_WINDOW_SECONDS = 60;
const CIRCUIT_WINDOW_SECONDS = 300;
const CIRCUIT_FAILURE_LIMIT = 3;
const safeError = error => String(error?.message || error || 'runtime_error').replace(/(token|secret|password|authorization|credential)\S*/ig, '[redacted]').slice(0, 120);
const allowlist = value => new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean));
const enabled = env => String(env.NEXORA_SCHEDULED_CAPABILITY_ENABLED || 'false').toLowerCase() === 'true';
const emergencyDisabled = env => String(env.NEXORA_SCHEDULED_CAPABILITY_EMERGENCY_DISABLED || 'true').toLowerCase() !== 'false';

function assertRollout(env, input) {
	if (!enabled(env)) throw new Error('scheduled_capability_disabled');
	if (emergencyDisabled(env)) throw new Error('scheduled_capability_emergency_disabled');
	const configuredCapabilities = allowlist(env.NEXORA_SCHEDULED_CAPABILITY_ALLOWLIST);
	if (configuredCapabilities.size !== 1 || !configuredCapabilities.has(CAPABILITY) || input.capability_id !== CAPABILITY) throw new Error('scheduled_capability_not_allowlisted');
	const tenants = allowlist(env.NEXORA_SCHEDULED_TENANT_ALLOWLIST);
	const workspaces = allowlist(env.NEXORA_SCHEDULED_WORKSPACE_ALLOWLIST);
	if (tenants.size !== 1 || !tenants.has(String(input.tenant_id))) throw new Error('scheduled_capability_tenant_denied');
	if (workspaces.size !== 1 || !workspaces.has(String(input.workspace_id))) throw new Error('scheduled_capability_workspace_denied');
}

async function assertCircuitAndRate(c, scope) {
	const failures = await c.env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_autonomy_jobs WHERE job_type=?1 AND state='FAILED' AND json_extract(input_json,'$.tenant_id')=?2 AND json_extract(input_json,'$.workspace_id')=?3 AND json_extract(input_json,'$.capability_id')=?4 AND updated_at>=datetime('now','-${CIRCUIT_WINDOW_SECONDS} seconds')`).bind(JOB_TYPE, scope.tenantId, scope.workspaceId, CAPABILITY).first();
	if (Number(failures?.count || 0) >= CIRCUIT_FAILURE_LIMIT) throw new Error('scheduled_capability_circuit_open');
	const recent = await c.env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_events WHERE tenant_id=?1 AND workspace_id=?2 AND event_type='SCHEDULED_CAPABILITY_INVOKED' AND created_at>=datetime('now','-${RATE_WINDOW_SECONDS} seconds')`).bind(scope.tenantId, scope.workspaceId).first();
	if (Number(recent?.count || 0) >= 1) throw new Error('scheduled_capability_rate_limited');
}

async function execute(c, job) {
	const input = JSON.parse(job.input_json || '{}');
	assertRollout(c.env, input);
	const scope = { tenantId: Number(input.tenant_id), workspaceId: Number(input.workspace_id) };
	if (!Number.isSafeInteger(scope.tenantId) || !Number.isSafeInteger(scope.workspaceId)) throw new Error('scheduled_capability_scope_invalid');
	await assertCircuitAndRate(c, scope);
	const root = `scheduled-search-${job.id}`;
	const missionId = `${root}-mission`, runId = `${root}-run`, stepId = `${root}-step`, actionId = `${root}-action`;
	const request = { capability_id: CAPABILITY, query: String(input.query || ''), page_size: Math.min(20, Number(input.page_size || 10)) };
	const targetHash = await hash({ account_id: Number(input.account_id), provider: 'gmail' });
	const paramsHash = await hash(request);
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES(?1,?2,?3,?2,'CAPABILITY_SEARCH_EMAIL','runnable',?4,'capability:search_email')`).bind(missionId, scope.tenantId, scope.workspaceId, `job:${job.id}`).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id,state) VALUES(?1,?2,?3,?4,'runnable')`).bind(runId, missionId, scope.tenantId, scope.workspaceId).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_steps(id,mission_id,run_id,tenant_id,workspace_id,step_key,state) VALUES(?1,?2,?3,?4,?5,'search_email','runnable')`).bind(stepId, missionId, runId, scope.tenantId, scope.workspaceId).run();
	const run = await durableMissionRuntime.claimRun(c, scope, runId, 30);
	await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='running',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='runnable'`).bind(missionId, scope.tenantId, scope.workspaceId).run();
	await c.env.db.prepare(`UPDATE mission_runtime_steps SET state='running',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND run_id=?2 AND state='runnable'`).bind(stepId, runId).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_actions(id,mission_id,run_id,step_id,tenant_id,workspace_id,capability,action_type,target_hash,params_hash,authority_generation,authority_context_hash,state,idempotency_key) VALUES(?1,?2,?3,?4,?5,?6,'search_email','READ_ONLY_CANONICAL_MAIL',?7,?8,?9,?10,'dispatch_pending',?11)`).bind(actionId, missionId, runId, stepId, scope.tenantId, scope.workspaceId, targetHash, paramsHash, Number(input.authority_generation), 'minted-after-lease-claim', `job:${job.id}:action`).run();
	const persistedAction = await c.env.db.prepare(`SELECT target_hash,params_hash,authority_generation FROM mission_runtime_actions WHERE id=?1 AND mission_id=?2 AND tenant_id=?3 AND workspace_id=?4`).bind(actionId, missionId, scope.tenantId, scope.workspaceId).first();
	if (!persistedAction || persistedAction.target_hash !== targetHash || persistedAction.params_hash !== paramsHash || Number(persistedAction.authority_generation) !== Number(input.authority_generation)) throw new Error('scheduled_capability_action_replay_conflict');
	const outcomeId = `${root}-outcome`;
	const existingOutcome = await c.env.db.prepare(`SELECT o.verification_id,v.evidence_id,e.summary_json FROM mission_runtime_outcomes o JOIN mission_runtime_verifications v ON v.id=o.verification_id AND v.mission_id=o.mission_id AND v.tenant_id=o.tenant_id AND v.workspace_id=o.workspace_id AND v.state='verified' AND v.integrity_state='valid' JOIN mission_runtime_evidence e ON e.id=v.evidence_id AND e.mission_id=o.mission_id AND e.tenant_id=o.tenant_id AND e.workspace_id=o.workspace_id AND e.status='supported' WHERE o.id=?1 AND o.mission_id=?2 AND o.tenant_id=?3 AND o.workspace_id=?4 AND o.action_id=?5 AND o.state='verified' AND o.claim_key='capability:search_email'`).bind(outcomeId, missionId, scope.tenantId, scope.workspaceId, actionId).first();
	if (existingOutcome) {
		const mission = await c.env.db.prepare(`SELECT state,version FROM mission_runtime_missions WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
		const actionStep = await c.env.db.prepare(`SELECT a.state AS action_state,s.state AS step_state FROM mission_runtime_actions a JOIN mission_runtime_steps s ON s.id=a.step_id AND s.run_id=a.run_id AND s.tenant_id=a.tenant_id AND s.workspace_id=a.workspace_id WHERE a.id=?1 AND a.run_id=?2 AND a.tenant_id=?3 AND a.workspace_id=?4`).bind(actionId, runId, scope.tenantId, scope.workspaceId).first();
		if (mission?.state !== 'verification_pending' || !Number.isSafeInteger(Number(mission.version)) || actionStep?.action_state !== 'completed' || actionStep?.step_state !== 'completed') throw new Error('scheduled_capability_recovery_state_invalid');
		let priorSummary;
		try { priorSummary = JSON.parse(existingOutcome.summary_json); } catch { throw new Error('scheduled_capability_recovery_evidence_invalid'); }
		if (!Array.isArray(priorSummary.message_refs) || priorSummary.message_refs.some(ref => !/^msg_[0-9a-f]{64}$/.test(ref))) throw new Error('scheduled_capability_recovery_evidence_invalid');
		await durableMissionRuntime.complete(c, scope, { missionId, runId, outcomeId, expectedVersion: mission.version, fencingToken: run.fencing_token });
		return { missionId, runId, invocationId: priorSummary.invocation_id, evidenceId: existingOutcome.evidence_id, verificationId: existingOutcome.verification_id, resultCount: priorSummary.message_refs.length, recovered: true };
	}
	const authority = { invocation_id: crypto.randomUUID(), capability_id: CAPABILITY, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, actor_user_id: Number(input.actor_user_id), account_id: Number(input.account_id), authority_generation: Number(input.authority_generation), lease_generation: run.fencing_token, mission_id: missionId, run_id: runId, step_id: stepId, action_id: actionId, idempotency_key: `job:${job.id}:search`, timestamp: new Date().toISOString() };
	const output = await invokeCapability(c, { authority, provider_id: 'gmail', request }, { timeoutMs: Math.min(2000, Math.max(250, Number(input.timeout_ms || 1500))) });
	const actionWrite = await c.env.db.prepare(`UPDATE mission_runtime_actions SET state='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='dispatch_pending'`).bind(actionId, scope.tenantId, scope.workspaceId).run();
	if (Number(actionWrite?.meta?.changes) !== 1) throw new Error('scheduled_capability_action_completion_conflict');
	const stepWrite = await c.env.db.prepare(`UPDATE mission_runtime_steps SET state='completed',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND run_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND state='running'`).bind(stepId, runId, scope.tenantId, scope.workspaceId).run();
	if (Number(stepWrite?.meta?.changes) !== 1) throw new Error('scheduled_capability_step_completion_conflict');
	const missionWrite = await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='verification_pending',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='running'`).bind(missionId, scope.tenantId, scope.workspaceId).run();
	if (Number(missionWrite?.meta?.changes) !== 1) throw new Error('scheduled_capability_mission_transition_conflict');
	const pending = await c.env.db.prepare(`SELECT version FROM mission_runtime_missions WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!Number.isSafeInteger(Number(pending?.version))) throw new Error('scheduled_capability_mission_version_invalid');
	const outcomeWrite = await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_outcomes(id,mission_id,tenant_id,workspace_id,state,verification_id,claim_key,action_id,policy_id,policy_version) SELECT ?1,?2,?3,?4,'verified',?5,'capability:search_email',?6,'capability_contract_v1',1 WHERE EXISTS (SELECT 1 FROM mission_runtime_verifications WHERE id=?5 AND evidence_id=?7 AND mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND state='verified' AND integrity_state='valid')`).bind(outcomeId, missionId, scope.tenantId, scope.workspaceId, output.verification.verification_id, actionId, output.evidence.evidence_id).run();
	if (Number(outcomeWrite?.meta?.changes) !== 1) {
		const exact = await c.env.db.prepare(`SELECT 1 AS ok FROM mission_runtime_outcomes WHERE id=?1 AND mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND state='verified' AND verification_id=?5 AND claim_key='capability:search_email' AND action_id=?6 AND policy_id='capability_contract_v1' AND policy_version=1`).bind(outcomeId, missionId, scope.tenantId, scope.workspaceId, output.verification.verification_id, actionId).first();
		if (!exact) throw new Error('scheduled_capability_verified_outcome_missing');
	}
	await durableMissionRuntime.complete(c, scope, { missionId, runId, outcomeId, expectedVersion: pending.version, fencingToken: run.fencing_token });
	await c.env.db.prepare(`INSERT INTO mission_runtime_events(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,event_type,fencing_token,detail_json) VALUES(?1,?2,?3,?4,?5,?6,?7,'SCHEDULED_CAPABILITY_INVOKED',?8,?9)`).bind(crypto.randomUUID(), missionId, runId, stepId, actionId, scope.tenantId, scope.workspaceId, run.fencing_token, JSON.stringify({ capability: CAPABILITY, evidence_id: output.evidence.evidence_id, verification_id: output.verification.verification_id, provider_network_called: false, credential_accessed: false, mailbox_mutated: false })).run();
	return { missionId, runId, invocationId: authority.invocation_id, evidenceId: output.evidence.evidence_id, verificationId: output.verification.verification_id, resultCount: output.result.response.message_refs.length };
}

async function monitorScheduled({ env }) {
	if (!enabled(env) || emergencyDisabled(env)) return { checked: 0, claimed: 0, succeeded: 0, disabled: true };
	const c = { env };
	const tenants = [...allowlist(env.NEXORA_SCHEDULED_TENANT_ALLOWLIST)], workspaces = [...allowlist(env.NEXORA_SCHEDULED_WORKSPACE_ALLOWLIST)], capabilities = [...allowlist(env.NEXORA_SCHEDULED_CAPABILITY_ALLOWLIST)];
	if (tenants.length !== 1 || workspaces.length !== 1 || capabilities.length !== 1 || capabilities[0] !== CAPABILITY) return { checked: 0, claimed: 0, succeeded: 0, disabled: true };
	const jobs = await env.db.prepare(`SELECT id,input_json FROM nexora_autonomy_jobs WHERE job_type=?1 AND json_extract(input_json,'$.tenant_id')=?2 AND json_extract(input_json,'$.workspace_id')=?3 AND json_extract(input_json,'$.capability_id')=?4 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP)) AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) ORDER BY id LIMIT 1`).bind(JOB_TYPE, Number(tenants[0]), Number(workspaces[0]), CAPABILITY).all();
	let claimed = 0, succeeded = 0;
	for (const job of jobs.results || []) {
		const claim = await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',attempt_count=attempt_count+1,lease_until=datetime('now','+30 seconds'),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_type=?2 AND json_extract(input_json,'$.tenant_id')=?3 AND json_extract(input_json,'$.workspace_id')=?4 AND json_extract(input_json,'$.capability_id')=?5 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP)) AND NOT EXISTS (SELECT 1 FROM nexora_autonomy_jobs active WHERE active.id!=?1 AND active.job_type=?2 AND active.state='RUNNING' AND active.lease_until>CURRENT_TIMESTAMP AND json_extract(active.input_json,'$.tenant_id')=json_extract(nexora_autonomy_jobs.input_json,'$.tenant_id') AND json_extract(active.input_json,'$.workspace_id')=json_extract(nexora_autonomy_jobs.input_json,'$.workspace_id'))`).bind(job.id, JOB_TYPE, Number(tenants[0]), Number(workspaces[0]), CAPABILITY).run();
		if (!claim.meta?.changes) continue;
		claimed += 1;
		try { const result = await execute(c, job); await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',lease_until=NULL,blocker_code=NULL,result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ ...result, read_only: true })).run(); succeeded += 1; }
		catch (error) { await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='FAILED',lease_until=NULL,blocker_code='SCHEDULED_CAPABILITY_FAILED',result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ executed: false, error: safeError(error), read_only: true })).run(); }
	}
	return { checked: (jobs.results || []).length, claimed, succeeded, bounded: true };
}

export { JOB_TYPE, CAPABILITY, monitorScheduled, execute, assertRollout };
export default { JOB_TYPE, CAPABILITY, monitorScheduled, execute, assertRollout };
