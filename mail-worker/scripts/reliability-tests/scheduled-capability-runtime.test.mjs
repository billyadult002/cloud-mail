import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import runtime, { assertRollout, execute } from '../../src/service/scheduled-capability-runtime-service.js';
import { createCapabilityRegistry } from '../../src/service/capability-registry-service.js';
import { createCapabilityEvidenceWriter, createCapabilityVerifier } from '../../src/service/capability-evidence-ledger-service.js';
import { invokeCapability } from '../../src/service/capability-invocation-service.js';
import gmailAdapter from '../../src/service/gmail-communication-capability-adapter.js';

const TENANT = 880041, WORKSPACE = 880042, ACCOUNT = 880043;
const TABLES = ['nexora_autonomy_jobs','mission_runtime_outcomes','mission_runtime_verifications','mission_runtime_evidence','mission_runtime_events','mission_runtime_actions','mission_runtime_steps','mission_runtime_runs','mission_runtime_missions','workspace_authority_events','email','account','workspace_members','workspaces'];
const SCHEMA = [
	`CREATE TABLE workspaces(id INTEGER PRIMARY KEY,tenant_key TEXT)`,
	`CREATE TABLE workspace_members(workspace_id INTEGER,user_id INTEGER,role TEXT,PRIMARY KEY(workspace_id,user_id))`,
	`CREATE TABLE account(account_id INTEGER PRIMARY KEY,user_id INTEGER,provider TEXT,is_del INTEGER DEFAULT 0)`,
	`CREATE TABLE email(email_id INTEGER PRIMARY KEY,external_message_id TEXT,account_id INTEGER,user_id INTEGER,subject TEXT,send_email TEXT,text TEXT,is_del INTEGER DEFAULT 0)`,
	`CREATE TABLE workspace_authority_events(id TEXT PRIMARY KEY,tenant_key TEXT,workspace_id INTEGER,actor_user_id INTEGER,subject_user_id INTEGER,account_id INTEGER,relationship_type TEXT,relationship_id TEXT,event_type TEXT,state TEXT,scope_hash TEXT,authority_generation INTEGER,reason_code TEXT,request_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_missions(id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,user_id INTEGER,kind TEXT,state TEXT,version INTEGER DEFAULT 1,idempotency_key TEXT,claim_key TEXT,completed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_runs(id TEXT PRIMARY KEY,mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,state TEXT,fencing_token INTEGER DEFAULT 0,lease_until TEXT,version INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_steps(id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,tenant_id INTEGER,workspace_id INTEGER,step_key TEXT,state TEXT,version INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_actions(id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,step_id TEXT,tenant_id INTEGER,workspace_id INTEGER,capability TEXT,action_type TEXT,target_hash TEXT,params_hash TEXT,authority_generation INTEGER,authority_context_hash TEXT,state TEXT,idempotency_key TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_events(id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,step_id TEXT,action_id TEXT,tenant_id INTEGER,workspace_id INTEGER,event_type TEXT,from_state TEXT,to_state TEXT,expected_version INTEGER,fencing_token INTEGER,detail_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_evidence(id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,step_id TEXT,action_id TEXT,tenant_id INTEGER,workspace_id INTEGER,claim_key TEXT,evidence_type TEXT,source_type TEXT,producer_type TEXT,producer_id_hash TEXT,reference_hash TEXT,summary_json TEXT,status TEXT,integrity_hash TEXT,sensitivity TEXT,retention_class TEXT,valid_from TEXT,expires_at TEXT,observed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_verifications(id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,action_id TEXT,tenant_id INTEGER,workspace_id INTEGER,state TEXT,evidence_id TEXT,verifier TEXT,claim_id TEXT,policy_id TEXT,policy_version INTEGER,evidence_set_hash TEXT,reason_codes_json TEXT,integrity_state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_outcomes(id TEXT PRIMARY KEY,mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,state TEXT,verification_id TEXT,claim_key TEXT,action_id TEXT,policy_id TEXT,policy_version INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_autonomy_jobs(id TEXT PRIMARY KEY,user_id INTEGER,job_type TEXT,idempotency_key TEXT,state TEXT,attempt_count INTEGER DEFAULT 0,lease_until TEXT,input_json TEXT,result_json TEXT DEFAULT '{}',blocker_code TEXT,next_attempt_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
];
const rollout = overrides => ({ ...env, NEXORA_SCHEDULED_CAPABILITY_ENABLED: 'true', NEXORA_SCHEDULED_CAPABILITY_EMERGENCY_DISABLED: 'false', NEXORA_SCHEDULED_CAPABILITY_ALLOWLIST: 'search_email', NEXORA_SCHEDULED_TENANT_ALLOWLIST: String(TENANT), NEXORA_SCHEDULED_WORKSPACE_ALLOWLIST: String(WORKSPACE), ...overrides });
const input = overrides => ({ capability_id: 'search_email', tenant_id: TENANT, workspace_id: WORKSPACE, actor_user_id: TENANT, account_id: ACCOUNT, authority_generation: 0, query: 'fixture', page_size: 5, ...overrides });

beforeEach(async () => {
	await env.db.batch(TABLES.map(table => env.db.prepare(`DROP TABLE IF EXISTS ${table}`)));
	for (const sql of SCHEMA) await env.db.prepare(sql).run();
	await env.db.prepare(`INSERT INTO workspaces VALUES(?1,?2)`).bind(WORKSPACE, `user:${TENANT}`).run();
	await env.db.prepare(`INSERT INTO workspace_members VALUES(?1,?2,'OWNER')`).bind(WORKSPACE, TENANT).run();
	await env.db.prepare(`INSERT INTO account VALUES(?1,?2,'gmail',0)`).bind(ACCOUNT, TENANT).run();
	await env.db.prepare(`INSERT INTO workspace_authority_events(id,tenant_key,workspace_id,actor_user_id,account_id,relationship_type,relationship_id,event_type,state,scope_hash,authority_generation,reason_code) VALUES('authority-1',?1,?2,?3,?4,'account','account-1','activated','active','scope',1,'owner')`).bind(`user:${TENANT}`, WORKSPACE, TENANT, ACCOUNT).run();
	await env.db.prepare(`INSERT INTO email VALUES(1,'message-1',?1,?2,'fixture subject','sender@example.invalid','fixture body',0)`).bind(ACCOUNT, TENANT).run();
});

describe('scheduled search_email capability runtime', () => {
	it('is default-off and emergency-disabled unless both controls explicitly permit execution', async () => {
		expect(() => assertRollout({}, input())).toThrow('scheduled_capability_disabled');
		expect(() => assertRollout({ NEXORA_SCHEDULED_CAPABILITY_ENABLED: 'true' }, input())).toThrow('scheduled_capability_emergency_disabled');
	});

	it('executes one bounded canonical D1 read and correlates evidence, verification, and completed Mission', async () => {
		const c = { env: rollout() };
		const result = await execute(c, { id: 'job-ok', input_json: JSON.stringify(input()) });
		expect(result.resultCount).toBe(1);
		const row = await env.db.prepare(`SELECT m.state,e.id AS evidence_id,v.id AS verification_id,o.id AS outcome_id FROM mission_runtime_missions m JOIN mission_runtime_evidence e ON e.mission_id=m.id JOIN mission_runtime_verifications v ON v.evidence_id=e.id AND v.state='verified' JOIN mission_runtime_outcomes o ON o.verification_id=v.id WHERE m.id=?1`).bind(result.missionId).first();
		expect(row.state).toBe('completed');
		expect(row.evidence_id).toBe(result.evidenceId);
		expect(row.verification_id).toBe(result.verificationId);
		const summary = JSON.parse((await env.db.prepare(`SELECT summary_json FROM mission_runtime_evidence WHERE id=?1`).bind(result.evidenceId).first()).summary_json);
		expect(summary).toMatchObject({ provider_network_called: false, credential_accessed: false, mailbox_mutated: false });
	});

	it.each([
		['tenant', rollout({ NEXORA_SCHEDULED_TENANT_ALLOWLIST: '999' }), input(), 'scheduled_capability_tenant_denied'],
		['workspace', rollout({ NEXORA_SCHEDULED_WORKSPACE_ALLOWLIST: '999' }), input(), 'scheduled_capability_workspace_denied'],
		['capability', rollout(), input({ capability_id: 'send_email' }), 'scheduled_capability_not_allowlisted'],
		['authority generation', rollout(), input({ authority_generation: 1 }), 'capability_authority_generation_stale'],
	])('fails closed for invalid %s', async (_name, runtimeEnv, request, code) => {
		await expect(execute({ env: runtimeEnv }, { id: crypto.randomUUID(), input_json: JSON.stringify(request) })).rejects.toThrow(code);
	});

	it('scheduler claims at most one allowlisted job and emergency rollback leaves it queued', async () => {
		for (const id of ['job-a','job-b']) await env.db.prepare(`INSERT INTO nexora_autonomy_jobs(id,user_id,job_type,idempotency_key,state,input_json) VALUES(?1,?2,'MISSION_RUNTIME_CAPABILITY_SEARCH_EMAIL',?1,'QUEUED',?3)`).bind(id, TENANT, JSON.stringify(input())).run();
		const disabled = await runtime.monitorScheduled({ env: rollout({ NEXORA_SCHEDULED_CAPABILITY_EMERGENCY_DISABLED: 'true' }) });
		expect(disabled.disabled).toBe(true);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_autonomy_jobs WHERE state='QUEUED'`).first()).count)).toBe(2);
		const enabledResult = await runtime.monitorScheduled({ env: rollout() });
		expect(enabledResult.claimed).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_autonomy_jobs WHERE state='QUEUED'`).first()).count)).toBe(1);
	});

	it('rejects a conflicting replay digest and never treats unverified evidence as replayable', async () => {
		const c = { env: rollout() };
		const completed = await execute(c, { id: 'job-replay', input_json: JSON.stringify(input()) });
		const run = await env.db.prepare(`SELECT fencing_token FROM mission_runtime_runs WHERE id=?1`).bind(completed.runId).first();
		const context = Object.freeze({ invocation_id: completed.invocationId, capability_id: 'search_email', tenant_id: TENANT, workspace_id: WORKSPACE, actor_user_id: TENANT, account_id: ACCOUNT, authority_generation: 0, lease_generation: run.fencing_token, mission_id: completed.missionId, run_id: completed.runId, step_id: 'scheduled-search-job-replay-step', action_id: 'scheduled-search-job-replay-action', idempotency_key: 'job:job-replay:search', timestamp: new Date().toISOString() });
		const dependencies = { registry: createCapabilityRegistry([gmailAdapter]), evidenceWriter: createCapabilityEvidenceWriter(c), verifier: createCapabilityVerifier(c) };
		await expect(invokeCapability(c, { context, provider_id: 'gmail', request: { capability_id: 'search_email', query: 'different', page_size: 5 } }, dependencies)).rejects.toThrow('capability_replay_conflict');
		await env.db.prepare(`DELETE FROM mission_runtime_verifications WHERE evidence_id=?1`).bind(completed.evidenceId).run();
		await expect(invokeCapability(c, { context, provider_id: 'gmail', request: { capability_id: 'search_email', query: 'fixture', page_size: 5 } }, dependencies)).rejects.toThrow('capability_replay_unverified');
	});

	it('rejects adapter safety-flag regressions and changed-input pre-evidence retries', async () => {
		const c = { env: rollout() };
		await expect(execute(c, { id: 'job-crash', input_json: JSON.stringify(input({ authority_generation: 1 })) })).rejects.toThrow('capability_authority_generation_stale');
		await env.db.prepare(`UPDATE mission_runtime_runs SET lease_until='2000-01-01 00:00:00' WHERE id='scheduled-search-job-crash-run'`).run();
		await expect(execute(c, { id: 'job-crash', input_json: JSON.stringify(input({ authority_generation: 1, query: 'changed' })) })).rejects.toThrow('scheduled_capability_action_replay_conflict');

		const unsafeContext = Object.freeze({ invocation_id: 'unsafe-invocation', capability_id: 'search_email', tenant_id: TENANT, workspace_id: WORKSPACE, actor_user_id: TENANT, account_id: ACCOUNT, authority_generation: 0, lease_generation: 1, mission_id: 'unsafe-mission', run_id: 'unsafe-run', step_id: 'unsafe-step', action_id: 'unsafe-action', idempotency_key: 'unsafe-replay', timestamp: new Date().toISOString() });
		const unsafeAdapter = { provider_id: 'gmail', adapter_id: 'unsafe-test', adapter_version: '1', capabilities: ['search_email'], invoke: async () => ({ ok: true, response: { capability_id: 'search_email', message_refs: [], result_digest: 'unsafe', provider_network_called: true, credential_accessed: false, mailbox_mutated: false } }) };
		await expect(invokeCapability(c, { context: unsafeContext, provider_id: 'gmail', request: { capability_id: 'search_email', query: 'unsafe', page_size: 1 } }, { registry: createCapabilityRegistry([unsafeAdapter]), evidenceWriter: createCapabilityEvidenceWriter(c), verifier: createCapabilityVerifier(c) })).rejects.toThrow('capability_result_unverified');
		expect(Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_verifications WHERE state='verified' AND mission_id='unsafe-mission'`).first()).count)).toBe(0);
	});
});
