import enterpriseAuthority from './enterprise-authority-service.js';
import { assertTransition, validateScope } from './connection-contract-service.js';
import providerSession from './provider-session-service.js';
import durableMissionRuntime from './durable-mission-runtime-service.js';

const JOB_TYPE = 'CONNECTION_RUNTIME_EVALUATE';
const AUTHORIZATION_SESSION_EXPIRED_SQL = "julianday(expires_at)<=julianday('now')";
const AUTHORIZATION_SESSION_QUALIFIED_EXPIRED_SQL = "julianday(s.expires_at)<=julianday('now')";
const AUTHORIZATION_SESSION_LIVE_SQL = "julianday(expires_at)>julianday('now')";
const expiredAuthorizationOperation = (priorAuthorizationSessionId, replacementAuthorizationSessionId) => ({
	type: 'REAUTHORIZE',
	idempotencyKey: `expired-authorization:${priorAuthorizationSessionId}:${replacementAuthorizationSessionId}`,
	authorizationSessionId: null,
});
const allowlist = (value) => new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean));
const enabled = (env) => String(env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true';
const emergencyDisabled = (env) => String(env.NEXORA_CONNECTION_RUNTIME_EMERGENCY_DISABLED || 'true').toLowerCase() !== 'false';
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
async function hash(value) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value))); return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function rawHash(value) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))); return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
const safeError = (error) => String(error?.message || error || 'connection_error').replace(/(token|secret|password|authorization|credential)\S*/ig, '[redacted]').slice(0, 120);

function assertRollout(env, input) {
	if (!enabled(env)) throw new Error('connection_runtime_disabled');
	if (emergencyDisabled(env)) throw new Error('connection_runtime_emergency_disabled');
	const providers = allowlist(env.NEXORA_CONNECTION_PROVIDER_ALLOWLIST);
	const tenants = allowlist(env.NEXORA_CONNECTION_TENANT_ALLOWLIST);
	const workspaces = allowlist(env.NEXORA_CONNECTION_WORKSPACE_ALLOWLIST);
	const accounts = allowlist(env.NEXORA_CONNECTION_ACCOUNT_ALLOWLIST);
	if (providers.size !== 1 || !providers.has('google') || input.provider !== 'google') throw new Error('connection_provider_not_allowlisted');
	if (tenants.size !== 1 || !tenants.has(String(input.tenant_id))) throw new Error('connection_tenant_not_allowlisted');
	if (workspaces.size !== 1 || !workspaces.has(String(input.workspace_id))) throw new Error('connection_workspace_not_allowlisted');
	if (accounts.size !== 1 || !accounts.has(String(input.account_id))) throw new Error('connection_account_not_allowlisted');
}

async function resolveBinding(c, input) {
	const scope = validateScope(input);
	if (scope.tenantId !== scope.actorUserId) throw new Error('connection_tenant_actor_mismatch');
	const authority = await enterpriseAuthority.resolveAccountAuthority(c, { workspaceId: scope.workspaceId, actingUserId: scope.actorUserId, accountId: scope.accountId, capability: 'account_state_visibility' });
	if (!authority.allowed) throw new Error(`connection_authority_denied:${authority.reason}`);
	if (Number(authority.authorityGeneration) !== scope.authorityGeneration) throw new Error('connection_authority_generation_stale');
	const row = await c.env.db.prepare(`SELECT a.account_id,lower(a.email) AS account_email,lower(a.provider) AS provider,lower(COALESCE(NULLIF(a.domain,''),substr(a.email,instr(a.email,'@')+1))) AS normalized_domain,da.id AS domain_authority_id,da.generation AS domain_authority_generation FROM account a JOIN workspace_account_bindings b ON b.account_id=a.account_id AND b.workspace_id=?2 JOIN nexora_domain_authorities da ON da.tenant_id=?1 AND da.workspace_id=?2 AND da.normalized_domain=lower(COALESCE(NULLIF(a.domain,''),substr(a.email,instr(a.email,'@')+1))) AND da.verification_status='verified' AND da.revoked_at IS NULL WHERE a.account_id=?3 AND a.user_id=?1 AND a.is_del=0`).bind(scope.tenantId, scope.workspaceId, scope.accountId).first();
	if (!row) throw new Error('connection_domain_account_binding_denied');
	const provider = ['gmail', 'google'].includes(row.provider) ? 'google' : row.provider;
	if (provider !== 'google') throw new Error('connection_provider_unsupported');
	return { scope, authority, row: { ...row, provider } };
}

function assertCurrentBinding(connection, { authority, row }) {
	if (
		Number(connection.authority_generation) !== Number(authority.authorityGeneration) ||
		connection.domain_authority_id !== row.domain_authority_id ||
		Number(connection.domain_authority_generation) !== Number(row.domain_authority_generation) ||
		connection.provider !== row.provider ||
		Number(connection.account_id) !== Number(row.account_id)
	) throw new Error('connection_live_authority_binding_stale');
}

export async function assertConnectionMissionAssociation(c, scope, connection, nextMissionId, provider) {
	if (!connection.onboarding_mission_id || connection.onboarding_mission_id === nextMissionId || connection.state === 'REAUTHORIZATION_REQUIRED') return true;
	if (connection.state !== 'DISCOVERED'
		|| connection.provider_connection_id
		|| Number(connection.provider_connection_generation) !== 0
		|| connection.credential_reference_id
		|| Number(connection.credential_generation) !== 0) throw new Error('connection_mission_association_authority_conflict');
	const pending = await c.env.db.prepare(
		`SELECT expires_at FROM nexora_onboarding_authorization_sessions
		 WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4 AND status='pending'
		 ORDER BY created_at,id`
	).bind(connection.onboarding_mission_id, scope.tenantId, scope.workspaceId, provider).all();
	const expiries = (pending.results || []).map((row) => Date.parse(row.expires_at));
	if (!expiries.length || expiries.some((expiry) => !Number.isFinite(expiry) || expiry > Date.now())) throw new Error('connection_mission_association_session_conflict');
	return true;
}

async function claim(c, scope, { connectionId, expectedGeneration, owner, seconds = 60 }) {
	const changed = await c.env.db.prepare(`UPDATE nexora_connections SET lease_owner=?2,lease_expires_at=datetime('now','+'||?3||' seconds'),fencing_token=fencing_token+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?4 AND workspace_id=?5 AND connection_generation=?6 AND state NOT IN ('REVOKED','FAILED_TERMINAL') AND (lease_expires_at IS NULL OR lease_expires_at<CURRENT_TIMESTAMP)`).bind(connectionId, owner, Math.min(300, Math.max(30, Number(seconds))), scope.tenantId, scope.workspaceId, expectedGeneration).run();
	if (!changed.meta?.changes) throw new Error('connection_lease_conflict');
	return c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(connectionId, scope.tenantId, scope.workspaceId).first();
}

export async function persistConnectionEvidence(c, scope, { connection, operation, result }) {
	if (!connection.onboarding_mission_id) throw new Error('connection_onboarding_mission_required');
	const lineage = await c.env.db.prepare(`SELECT m.id AS mission_id,r.id AS run_id FROM mission_runtime_missions m JOIN mission_runtime_runs r ON r.mission_id=m.id AND r.tenant_id=m.tenant_id AND r.workspace_id=m.workspace_id WHERE m.id=?1 AND m.tenant_id=?2 AND m.workspace_id=?3 ORDER BY r.created_at DESC LIMIT 1`).bind(connection.onboarding_mission_id, scope.tenantId, scope.workspaceId).first();
	if (!lineage) throw new Error('connection_canonical_mission_lineage_missing');
	const missionId = lineage.mission_id;
	const runId = lineage.run_id;
	const claimId = `connection-claim:${operation.id}`;
	const evidenceId = `connection-evidence:${operation.id}`;
	const evidenceType = `connection_${String(operation.type || 'operation').toLowerCase()}`;
	const claimKey = `${evidenceType}:${operation.id}`;
	const policyId = `${evidenceType}_v1`;
	const claimType = 'connection_operation_outcome';
	const requiredEvidenceJson = JSON.stringify([evidenceType]);
	const policyHash = await hash({ policyId, version: 1, claimType, requiredEvidenceJson, freshnessSeconds: 300, minimumDistinctEvidence: 1, conflictMode: 'fail_closed' });
	const subjectHash = await hash({ connectionId: connection.id, accountId: connection.account_id });
	const assertionHash = await hash({ operationId: operation.id, operationType: operation.type, classification: result.classification, providerHttpStatus: result.providerHttpStatus || null, providerNetworkCalled: Boolean(result.providerNetworkCalled), mailboxMutated: false });
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_verification_policies(id,version,claim_type,required_evidence_json,freshness_seconds,minimum_distinct_evidence,conflict_mode,active,policy_hash) VALUES(?1,1,?2,?3,300,1,'fail_closed',1,?4)`).bind(policyId, claimType, requiredEvidenceJson, policyHash).run();
	const policy = await c.env.db.prepare(`SELECT claim_type,required_evidence_json,freshness_seconds,minimum_distinct_evidence,conflict_mode,active,policy_hash FROM mission_runtime_verification_policies WHERE id=?1 AND version=1`).bind(policyId).first();
	if (!policy
		|| policy.claim_type !== claimType
		|| policy.required_evidence_json !== requiredEvidenceJson
		|| Number(policy.freshness_seconds) !== 300
		|| Number(policy.minimum_distinct_evidence) !== 1
		|| policy.conflict_mode !== 'fail_closed'
		|| Number(policy.active) !== 1
		|| policy.policy_hash !== policyHash) throw new Error('connection_canonical_policy_conflict');
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_claims(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,claim_type,subject_hash,assertion_hash,required_evidence_json,policy_id,policy_version,state,version) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,1,'pending',1)`).bind(claimId, missionId, runId, evidenceType, operation.id, scope.tenantId, scope.workspaceId, claimKey, claimType, subjectHash, assertionHash, requiredEvidenceJson, policyId).run();
	const claim = await c.env.db.prepare(`SELECT mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,claim_type,subject_hash,assertion_hash,required_evidence_json,policy_id,policy_version,state,version FROM mission_runtime_claims WHERE id=?1`).bind(claimId).first();
	if (!claim
		|| claim.mission_id !== missionId
		|| claim.run_id !== runId
		|| claim.step_id !== evidenceType
		|| claim.action_id !== operation.id
		|| Number(claim.tenant_id) !== Number(scope.tenantId)
		|| Number(claim.workspace_id) !== Number(scope.workspaceId)
		|| claim.claim_key !== claimKey
		|| claim.claim_type !== claimType
		|| claim.subject_hash !== subjectHash
		|| claim.assertion_hash !== assertionHash
		|| claim.required_evidence_json !== requiredEvidenceJson
		|| claim.policy_id !== policyId
		|| Number(claim.policy_version) !== 1
		|| claim.state !== 'pending'
		|| Number(claim.version) !== 1) throw new Error('connection_canonical_claim_conflict');
	const priorEvidence = await c.env.db.prepare(`SELECT observed_at FROM mission_runtime_evidence WHERE id=?1`).bind(evidenceId).first();
	const observedAt = priorEvidence?.observed_at || new Date().toISOString();
	const referenceHash = await hash({ operation: operation.id, classification: result.classification, status: result.providerHttpStatus || null });
	const summaryJson = JSON.stringify({ operation_id: operation.id, classification: result.classification, provider_network_called: Boolean(result.providerNetworkCalled), mailbox_mutated: false, connection_generation: connection.connection_generation, credential_generation: connection.credential_generation, fencing_token: connection.fencing_token });
	const row = { id: evidenceId, mission_id: missionId, run_id: runId, step_id: evidenceType, action_id: null, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, claim_key: claimKey, evidence_type: evidenceType, source_type: 'connection_runtime', producer_type: 'controlled_system', producer_id_hash: await hash('connection-runtime-v1'), reference_hash: referenceHash, summary_json: summaryJson, observed_at: observedAt, expires_at: null };
	const integrityHash = await hash({ id: row.id, mission_id: row.mission_id, run_id: row.run_id, step_id: row.step_id, action_id: null, tenant_id: row.tenant_id, workspace_id: row.workspace_id, claim_key: row.claim_key, evidence_type: row.evidence_type, source_type: row.source_type, producer_type: row.producer_type, producer_id_hash: row.producer_id_hash, reference_hash: row.reference_hash, summary_json: row.summary_json, observed_at: row.observed_at, expires_at: null });
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_evidence(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,evidence_type,source_type,producer_type,producer_id_hash,reference_hash,summary_json,status,integrity_hash,observed_at,expires_at,created_at) VALUES(?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10,?11,?12,?13,'supported',?14,?15,NULL,?15)`).bind(row.id, row.mission_id, row.run_id, row.step_id, row.tenant_id, row.workspace_id, row.claim_key, row.evidence_type, row.source_type, row.producer_type, row.producer_id_hash, row.reference_hash, row.summary_json, integrityHash, observedAt).run();
	const evidence = await c.env.db.prepare(`SELECT mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,evidence_type,source_type,producer_type,producer_id_hash,reference_hash,summary_json,status,integrity_hash,observed_at,expires_at FROM mission_runtime_evidence WHERE id=?1`).bind(evidenceId).first();
	if (!evidence
		|| evidence.mission_id !== row.mission_id
		|| evidence.run_id !== row.run_id
		|| evidence.step_id !== row.step_id
		|| evidence.action_id !== null
		|| Number(evidence.tenant_id) !== Number(row.tenant_id)
		|| Number(evidence.workspace_id) !== Number(row.workspace_id)
		|| evidence.claim_key !== row.claim_key
		|| evidence.evidence_type !== row.evidence_type
		|| evidence.source_type !== row.source_type
		|| evidence.producer_type !== row.producer_type
		|| evidence.producer_id_hash !== row.producer_id_hash
		|| evidence.reference_hash !== row.reference_hash
		|| evidence.summary_json !== row.summary_json
		|| evidence.status !== 'supported'
		|| evidence.integrity_hash !== integrityHash
		|| evidence.observed_at !== observedAt
		|| evidence.expires_at !== null) throw new Error('connection_canonical_evidence_conflict');
	const verification = await durableMissionRuntime.verifyClaim(c, scope, { claimId, runId, verifier: 'canonical_connection_policy_v1' });
	if (verification.state !== 'verified') throw new Error('connection_canonical_verification_rejected');
	return { evidenceId, verificationId: verification.verificationId, claimId };
}

async function verifiedTransition(c, scope, connection, operation, toState, result, updates = {}) {
	assertTransition(connection.state, toState);
	const refs = await persistConnectionEvidence(c, scope, { connection, operation, result });
	const responseDigest = await hash({ classification: result.classification, status: result.providerHttpStatus || null, network: Boolean(result.providerNetworkCalled), mailboxMutated: false });
	const eventId = crypto.randomUUID();
	const abortOnZero = () => c.env.db.prepare(`INSERT INTO nexora_connection_events(id,connection_id,operation_id,tenant_id,workspace_id,event_type,from_state,to_state,connection_generation,fencing_token,detail_json) SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL WHERE changes()=0`);
	await c.env.db.batch([
		c.env.db.prepare(`UPDATE nexora_connection_operations SET state='VERIFIED',transition_from_state=?2,transition_to_state=?3,provider_response_classification=?4,provider_http_status=?5,provider_network_called=?6,response_digest=?7,evidence_id=?8,verification_id=?9,claim_id=?10,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND connection_id=?11 AND tenant_id=?12 AND workspace_id=?13 AND state IN ('LEASED','PROVIDER_RESPONSE_OBSERVED') AND lease_owner=?14 AND fencing_token=?15 AND lease_expires_at>CURRENT_TIMESTAMP`).bind(operation.id, connection.state, toState, result.classification, result.providerHttpStatus || null, result.providerNetworkCalled ? 1 : 0, responseDigest, refs.evidenceId, refs.verificationId, refs.claimId, connection.id, scope.tenantId, scope.workspaceId, connection.lease_owner, connection.fencing_token),
		abortOnZero(),
		c.env.db.prepare(`INSERT INTO nexora_connection_events(id,connection_id,operation_id,tenant_id,workspace_id,event_type,from_state,to_state,connection_generation,fencing_token,detail_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`).bind(eventId, connection.id, operation.id, scope.tenantId, scope.workspaceId, `CONNECTION_${result.classification}`, connection.state, toState, Number(connection.connection_generation) + 1, connection.fencing_token, JSON.stringify({ evidence_id: refs.evidenceId, verification_id: refs.verificationId, claim_id: refs.claimId, provider_network_called: Boolean(result.providerNetworkCalled), mailbox_mutated: false })),
		c.env.db.prepare(`UPDATE nexora_connections SET state=?2,connection_generation=connection_generation+1,last_transition_event_id=?3,last_verified_health_at=CASE WHEN ?2='HEALTHY' THEN CURRENT_TIMESTAMP ELSE last_verified_health_at END,next_eligible_retry_at=CASE WHEN ?2='RETRY_WAIT' THEN datetime('now','+30 seconds') ELSE NULL END,consecutive_failure_count=CASE WHEN ?2='HEALTHY' THEN 0 WHEN ?2 IN ('DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED','FAILED_TERMINAL') THEN consecutive_failure_count+1 ELSE consecutive_failure_count END,reauthorization_required=CASE WHEN ?2='REAUTHORIZATION_REQUIRED' THEN 1 WHEN ?2 IN ('CONNECTED','HEALTHY') THEN 0 ELSE reauthorization_required END,onboarding_mission_id=COALESCE(?4,onboarding_mission_id),provider_connection_id=COALESCE(?5,provider_connection_id),provider_connection_generation=CASE WHEN ?6 IS NULL THEN provider_connection_generation ELSE ?6 END,credential_reference_id=COALESCE(?7,credential_reference_id),credential_generation=CASE WHEN ?8 IS NULL THEN credential_generation ELSE ?8 END,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?9 AND workspace_id=?10 AND connection_generation=?11 AND fencing_token=?12 AND lease_owner=?13 AND lease_expires_at>CURRENT_TIMESTAMP`).bind(connection.id, toState, eventId, updates.onboardingMissionId || null, updates.providerConnectionId || null, updates.providerConnectionGeneration ?? null, updates.credentialReferenceId || null, updates.credentialGeneration ?? null, scope.tenantId, scope.workspaceId, connection.connection_generation, connection.fencing_token, connection.lease_owner),
		abortOnZero(),
		c.env.db.prepare(`UPDATE nexora_connections SET lease_owner=NULL,lease_expires_at=NULL WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND connection_generation=?4 AND fencing_token=?5 AND lease_owner=?6`).bind(connection.id, scope.tenantId, scope.workspaceId, Number(connection.connection_generation) + 1, connection.fencing_token, connection.lease_owner),
		abortOnZero(),
	]);
	return { connectionId: connection.id, state: toState, connectionGeneration: Number(connection.connection_generation) + 1, operationId: operation.id, ...refs, providerNetworkCalled: Boolean(result.providerNetworkCalled), mailboxMutated: false };
}

export async function createConnectionOperation(c, scope, connection, { type, idempotencyKey, state = 'LEASED', authorizationSessionId = null }) {
	let effectiveIdempotencyKey = idempotencyKey;
	const requestDigestFor = (key) => hash({ connection: connection.id, type, idempotencyKey: key, connectionGeneration: connection.connection_generation, credentialGeneration: connection.credential_generation });
	let requestDigest = await requestDigestFor(effectiveIdempotencyKey);
	const authorityDigest = await hash({ tenant: scope.tenantId, workspace: scope.workspaceId, authorityGeneration: connection.authority_generation, connectionGeneration: connection.connection_generation, credentialGeneration: connection.credential_generation, owner: connection.lease_owner, fence: connection.fencing_token });
	let existing = await c.env.db.prepare(`SELECT *,CASE WHEN lease_expires_at IS NULL OR lease_expires_at<=CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS lease_recoverable FROM nexora_connection_operations WHERE connection_id=?1 AND operation_type=?2 AND idempotency_key=?3`).bind(connection.id, type, effectiveIdempotencyKey).first();
	if (existing) {
		if (existing.request_digest === requestDigest && existing.authority_tuple_digest === authorityDigest) return { id: existing.id, type, existing };
		const recoverable = ['LEASED','PROVIDER_RESPONSE_OBSERVED','EVIDENCE_WRITTEN','RETRY_WAIT','FAILED'].includes(existing.state)
			&& (existing.state === 'FAILED' || Number(existing.lease_recoverable) === 1);
		if (!recoverable) throw new Error('connection_operation_idempotency_conflict');
		if (existing.state !== 'FAILED') {
			const retired = await c.env.db.prepare(`UPDATE nexora_connection_operations SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,fencing_token=NULL,error_code='INCOMPLETE_ATTEMPT_EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND connection_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND state IN ('LEASED','PROVIDER_RESPONSE_OBSERVED','EVIDENCE_WRITTEN','RETRY_WAIT') AND (lease_expires_at IS NULL OR lease_expires_at<=CURRENT_TIMESTAMP)`).bind(existing.id, connection.id, scope.tenantId, scope.workspaceId).run();
			if (!retired.meta?.changes) throw new Error('connection_operation_recovery_conflict');
		}
		if (existing.authorization_session_id) throw new Error('connection_authorization_operation_retry_requires_new_session');
		effectiveIdempotencyKey = `${idempotencyKey}:retry:${connection.fencing_token}`;
		requestDigest = await requestDigestFor(effectiveIdempotencyKey);
		existing = await c.env.db.prepare(`SELECT * FROM nexora_connection_operations WHERE connection_id=?1 AND operation_type=?2 AND idempotency_key=?3`).bind(connection.id, type, effectiveIdempotencyKey).first();
		if (existing) {
			if (existing.request_digest !== requestDigest || existing.authority_tuple_digest !== authorityDigest) throw new Error('connection_operation_retry_conflict');
			return { id: existing.id, type, existing };
		}
	}
	const id = crypto.randomUUID();
	await c.env.db.prepare(`INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,authorization_session_id,expected_authority_generation,expected_connection_generation,expected_credential_generation,lease_owner,lease_expires_at,fencing_token,state,request_digest,authority_tuple_digest,attempt) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,1)`).bind(id, connection.id, scope.tenantId, scope.workspaceId, type, effectiveIdempotencyKey, authorizationSessionId, connection.authority_generation, connection.connection_generation, connection.credential_generation, connection.lease_owner, connection.lease_expires_at, connection.fencing_token, state, requestDigest, authorityDigest).run();
	return { id, type };
}

async function discoverConnection(c, input) {
	assertRollout(c.env, { ...input, provider: 'google' });
	const { scope, authority, row } = await resolveBinding(c, input);
	const id = `connection:${scope.tenantId}:${scope.workspaceId}:${row.provider}:${scope.accountId}`;
	const accountLoginHintHash = await rawHash(row.account_email);
	const candidates = await c.env.db.prepare(`SELECT pc.id AS provider_connection_id,pc.generation AS provider_connection_generation,pc.onboarding_mission_id,t.id AS credential_reference_id,t.rotation_generation FROM nexora_onboarding_provider_connections pc JOIN nexora_onboarding_token_connection_bindings b ON b.connection_id=pc.id AND b.tenant_id=pc.tenant_id AND b.workspace_id=pc.workspace_id AND b.provider=pc.provider AND b.connection_generation=pc.generation JOIN nexora_onboarding_tokens t ON t.id=b.token_id AND t.tenant_id=pc.tenant_id AND t.workspace_id=pc.workspace_id AND t.provider=pc.provider AND t.rotation_generation=b.token_generation AND t.revoked_at IS NULL JOIN nexora_callback_verified_results vr ON vr.mission_id=pc.onboarding_mission_id AND vr.tenant_id=pc.tenant_id AND vr.workspace_id=pc.workspace_id AND vr.provider=pc.provider AND vr.provider_connection_id=pc.id AND vr.provider_connection_generation=pc.generation AND vr.token_generation=t.rotation_generation AND vr.result_status='VERIFIED' JOIN nexora_onboarding_authorization_sessions s ON s.id=vr.authorization_session_id AND s.onboarding_mission_id=vr.mission_id AND s.tenant_id=vr.tenant_id AND s.workspace_id=vr.workspace_id AND s.provider=vr.provider AND s.status='consumed' AND s.login_hint_hash=?4 WHERE pc.tenant_id=?1 AND pc.workspace_id=?2 AND pc.provider=?3 AND pc.connection_state='active'`).bind(scope.tenantId, scope.workspaceId, row.provider, accountLoginHintHash).all();
	if ((candidates.results || []).length > 1) throw new Error('connection_ownership_ambiguous');
	const candidate = (candidates.results || [])[0] || null;
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,onboarding_mission_id,provider_connection_id,provider_connection_generation,credential_reference_id,credential_generation,state,authority_generation,connection_generation) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'DISCOVERED',?14,1)`).bind(id, scope.tenantId, scope.workspaceId, row.normalized_domain, row.domain_authority_id, row.domain_authority_generation, row.provider, scope.accountId, candidate?.onboarding_mission_id || input.onboarding_mission_id || null, candidate?.provider_connection_id || null, candidate?.provider_connection_generation || 0, candidate?.credential_reference_id || null, candidate?.rotation_generation || 0, authority.authorityGeneration).run();
	let connection = await c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(id, scope.tenantId, scope.workspaceId).first();
	assertCurrentBinding(connection, { authority, row });
	if (connection.state !== 'DISCOVERED') return connection;
	if (!candidate) return connection;
	connection = await claim(c, scope, { connectionId: id, expectedGeneration: connection.connection_generation, owner: `connection-discovery:${crypto.randomUUID()}` });
	const operation = await createConnectionOperation(c, scope, connection, { type: 'DISCOVER', idempotencyKey: input.idempotency_key || `discover:${id}:${connection.connection_generation}` });
	await verifiedTransition(c, scope, connection, operation, 'CONNECTED', { classification: 'DISCOVERED_VERIFIED_BINDING', providerNetworkCalled: false, mailboxMutated: false }, { onboardingMissionId: candidate.onboarding_mission_id, providerConnectionId: candidate.provider_connection_id, providerConnectionGeneration: candidate.provider_connection_generation, credentialReferenceId: candidate.credential_reference_id, credentialGeneration: candidate.rotation_generation });
	return c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1`).bind(id).first();
}

function nextState(result) { if (result.classification === 'HEALTHY') return 'HEALTHY'; if (result.reauthorizationRequired) return 'REAUTHORIZATION_REQUIRED'; if (result.retryable) return 'RETRY_WAIT'; return 'DEGRADED'; }
async function evaluateConnection(c, input, { fetchImpl } = {}) {
	assertRollout(c.env, input);
	const { scope, authority, row: liveBinding } = await resolveBinding(c, input);
	let connection = await c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND account_id=?4 AND provider=?5`).bind(input.connection_id, scope.tenantId, scope.workspaceId, scope.accountId, input.provider).first();
	if (!connection) throw new Error('connection_scope_denied');
	if (Number(connection.authority_generation) !== scope.authorityGeneration) throw new Error('connection_authority_generation_stale');
	assertCurrentBinding(connection, { authority, row: liveBinding });
	if (!connection.credential_reference_id) throw new Error('connection_credential_reference_missing');
	connection = await claim(c, scope, { connectionId: connection.id, expectedGeneration: Number(input.connection_generation), owner: `connection-health:${crypto.randomUUID()}` });
	const operation = await createConnectionOperation(c, scope, connection, { type: 'HEALTH', idempotencyKey: input.idempotency_key });
	let session;
	let result;
	try { session = await providerSession.acquireProviderSession(c, scope, { connectionId: connection.id, operationId: operation.id, leaseOwner: connection.lease_owner, purpose: 'health', expectedConnectionGeneration: connection.connection_generation, fencingToken: connection.fencing_token, fetchImpl }); result = await session.evaluateHealth({ timeoutMs: input.timeout_ms || 2500 }); } finally { session?.close(); }
	if (result.mailboxMutated) throw new Error('connection_provider_mutation_forbidden');
	return verifiedTransition(c, scope, connection, operation, nextState(result), result);
}

async function requireReauthorization(c, input, { idempotencyKey, classification = 'PROVIDER_OUTCOME_AMBIGUOUS' } = {}) {
	assertRollout(c.env, input);
	const { scope, authority, row } = await resolveBinding(c, input);
	let connection = await c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND account_id=?4 AND provider=?5`).bind(input.connection_id, scope.tenantId, scope.workspaceId, scope.accountId, input.provider).first();
	if (!connection || !['CONNECTED','HEALTHY','REFRESH_PENDING','DEGRADED','RETRY_WAIT'].includes(connection.state)) throw new Error('connection_reauthorization_state_denied');
	assertCurrentBinding(connection, { authority, row });
	connection = await claim(c, scope, { connectionId: connection.id, expectedGeneration: Number(input.connection_generation), owner: `connection-refresh-ambiguity:${crypto.randomUUID()}` });
	const operation = await createConnectionOperation(c, scope, connection, { type: 'REFRESH', idempotencyKey });
	return verifiedTransition(c, scope, connection, operation, 'REAUTHORIZATION_REQUIRED', { classification, providerNetworkCalled: true, mailboxMutated: false });
}

async function beginAuthorization(c, input, { authorizationSessionId }) {
	assertRollout(c.env, input);
	const { scope, authority, row } = await resolveBinding(c, input);
	let connection = await c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND account_id=?4 AND provider=?5`).bind(input.connection_id, scope.tenantId, scope.workspaceId, scope.accountId, input.provider).first();
	if (!connection || !['DISCOVERED','REAUTHORIZATION_REQUIRED','DISCONNECTED'].includes(connection.state)) throw new Error('connection_authorization_state_denied');
	assertCurrentBinding(connection, { authority, row });
	const session = await c.env.db.prepare(`SELECT onboarding_mission_id FROM nexora_onboarding_authorization_sessions WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4 AND status='pending' AND ${AUTHORIZATION_SESSION_LIVE_SQL}`).bind(authorizationSessionId, scope.tenantId, scope.workspaceId, input.provider).first();
	if (!session) throw new Error('connection_authorization_session_denied');
	await assertConnectionMissionAssociation(c, scope, connection, session.onboarding_mission_id, input.provider);
	connection = await claim(c, scope, { connectionId: connection.id, expectedGeneration: connection.connection_generation, owner: `connection-authorization:${crypto.randomUUID()}` });
	// Mission association is part of the same fenced transition as the authorization state.
	// The claimed snapshot is used for evidence so a replacement Mission cannot be overwritten
	// by a concurrent recovery after this owner acquires the lease.
	const boundConnection = { ...connection, onboarding_mission_id: session.onboarding_mission_id };
	const operation = await createConnectionOperation(c, scope, boundConnection, { type: 'REAUTHORIZE', idempotencyKey: input.idempotency_key, authorizationSessionId });
	return verifiedTransition(c, scope, boundConnection, operation, 'AUTHORIZATION_PENDING', { classification: 'AUTHORIZATION_SESSION_BOUND', providerNetworkCalled: false, mailboxMutated: false }, { onboardingMissionId: session.onboarding_mission_id });
}

async function recoverExpiredAuthorization(c, input, { replacementAuthorizationSessionId }) {
	assertRollout(c.env, input);
	const { scope, authority, row } = await resolveBinding(c, input);
	let connection = await c.env.db.prepare(
		`SELECT * FROM nexora_connections
		 WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND account_id=?4 AND provider=?5`
	).bind(input.connection_id, scope.tenantId, scope.workspaceId, scope.accountId, input.provider).first();
	if (!connection || connection.state !== 'AUTHORIZATION_PENDING') throw new Error('connection_expired_authorization_state_denied');
	assertCurrentBinding(connection, { authority, row });
	const prior = await c.env.db.prepare(
		`SELECT o.authorization_session_id
		 FROM nexora_connection_operations o
		 JOIN nexora_onboarding_authorization_sessions s ON s.id=o.authorization_session_id
		 WHERE o.connection_id=?1 AND o.tenant_id=?2 AND o.workspace_id=?3
		  AND o.operation_type='REAUTHORIZE' AND o.state='VERIFIED'
		  AND s.onboarding_mission_id=?4 AND s.provider=?5
		  AND ${AUTHORIZATION_SESSION_QUALIFIED_EXPIRED_SQL}
		 ORDER BY o.created_at DESC LIMIT 1`
	).bind(connection.id, scope.tenantId, scope.workspaceId, connection.onboarding_mission_id, input.provider).first();
	if (!prior) throw new Error('connection_authorization_session_not_expired');
	const replacement = await c.env.db.prepare(
		`SELECT id FROM nexora_onboarding_authorization_sessions
		 WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4
		  AND status='pending' AND ${AUTHORIZATION_SESSION_LIVE_SQL}`
	).bind(replacementAuthorizationSessionId, scope.tenantId, scope.workspaceId, input.provider).first();
	if (!replacement) throw new Error('connection_replacement_authorization_session_denied');
	await c.env.db.batch([
		c.env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET status='expired' WHERE id=?1 AND status='pending' AND ${AUTHORIZATION_SESSION_EXPIRED_SQL}`).bind(prior.authorization_session_id),
		c.env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET status='expired' WHERE authorization_session_id=?1 AND status='pending'`).bind(prior.authorization_session_id),
	]);
	connection = await claim(c, scope, { connectionId: connection.id, expectedGeneration: connection.connection_generation, owner: `connection-expired-authorization:${crypto.randomUUID()}` });
	const operation = await createConnectionOperation(c, scope, connection, expiredAuthorizationOperation(prior.authorization_session_id, replacementAuthorizationSessionId));
	return verifiedTransition(c, scope, connection, operation, 'REAUTHORIZATION_REQUIRED', {
		classification: 'AUTHORIZATION_SESSION_EXPIRED',
		providerNetworkCalled: false,
		mailboxMutated: false,
	});
}

async function findAuthorizationReplay(c, input, { authorizationSessionId }) {
	assertRollout(c.env, input);
	const { scope, authority, row } = await resolveBinding(c, input);
	const connection = await c.env.db.prepare(
		`SELECT * FROM nexora_connections
		 WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND account_id=?4 AND provider=?5`
	).bind(input.connection_id, scope.tenantId, scope.workspaceId, scope.accountId, input.provider).first();
	if (!connection || connection.state !== 'AUTHORIZATION_PENDING') throw new Error('connection_authorization_replay_state_denied');
	assertCurrentBinding(connection, { authority, row });
	const operation = await c.env.db.prepare(
		`SELECT id FROM nexora_connection_operations
		 WHERE connection_id=?1 AND tenant_id=?2 AND workspace_id=?3
		  AND authorization_session_id=?4 AND operation_type='REAUTHORIZE' AND state='VERIFIED'`
	).bind(connection.id, scope.tenantId, scope.workspaceId, authorizationSessionId).first();
	if (!operation) return null;
	const session = await c.env.db.prepare(
		`SELECT id FROM nexora_onboarding_authorization_sessions
		 WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4
		  AND provider=?5 AND status='pending' AND ${AUTHORIZATION_SESSION_LIVE_SQL}`
	).bind(authorizationSessionId, connection.onboarding_mission_id, scope.tenantId, scope.workspaceId, input.provider).first();
	if (!session) throw new Error('connection_authorization_replay_session_denied');
	return { connectionId: connection.id, state: connection.state, connectionGeneration: Number(connection.connection_generation), operationId: operation.id, idempotentReplay: true };
}

async function replayAuthorization(c, input, options) {
	const receipt = await findAuthorizationReplay(c, input, options);
	if (!receipt) throw new Error('connection_authorization_replay_receipt_missing');
	return receipt;
}

async function enqueueHealthEvaluation(c, scope, connection) {
	const healthInput = { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, actor_user_id: scope.tenantId, account_id: Number(connection.account_id), authority_generation: Number(connection.authority_generation), provider: connection.provider, connection_id: connection.id, connection_generation: Number(connection.connection_generation), idempotency_key: `health:${connection.id}:${connection.connection_generation}` };
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_autonomy_jobs(id,user_id,job_type,idempotency_key,input_json,state) VALUES(?1,?2,?3,?4,?5,'QUEUED')`).bind(crypto.randomUUID(), scope.tenantId, JOB_TYPE, `connection-health:${connection.id}:${connection.connection_generation}`, JSON.stringify(healthInput)).run();
}

async function bindVerifiedCallback(c, scope, { authorizationSessionId, callbackCorrelationId, providerConnectionId, onboardingMissionId, credentialReferenceId, credentialGeneration, providerConnectionGeneration }) {
	const authorizationOperation = await c.env.db.prepare(`SELECT * FROM nexora_connection_operations WHERE authorization_session_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND operation_type='REAUTHORIZE'`).bind(authorizationSessionId, scope.tenantId, scope.workspaceId).first();
	if (!authorizationOperation) return { bound: false, reason: 'NO_CONNECTION_AUTHORIZATION_OPERATION' };
	const prior = await c.env.db.prepare(`SELECT * FROM nexora_connection_operations WHERE connection_id=?1 AND operation_type='CALLBACK' AND idempotency_key=?2`).bind(authorizationOperation.connection_id, `callback:${callbackCorrelationId}:binding`).first();
	if (prior?.state === 'VERIFIED') {
		const current=await c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(prior.connection_id,scope.tenantId,scope.workspaceId).first();
		if(!current||!['CONNECTED','HEALTHY','DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED'].includes(current.state)) throw new Error('connection_callback_receipt_state_conflict');
		if(current.state==='CONNECTED') await enqueueHealthEvaluation(c,scope,current);
		return { bound: true, idempotent: true, connectionId: prior.connection_id, connectionGeneration:current.connection_generation, operationId: prior.id, evidenceId: prior.evidence_id, verificationId: prior.verification_id };
	}
	let connection = await c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(authorizationOperation.connection_id, scope.tenantId, scope.workspaceId).first();
	if (!connection || connection.state !== 'AUTHORIZATION_PENDING' || connection.onboarding_mission_id !== onboardingMissionId) throw new Error('connection_callback_authority_mismatch');
	connection = await claim(c, scope, { connectionId: connection.id, expectedGeneration: connection.connection_generation, owner: `connection-callback:${crypto.randomUUID()}` });
	const operation = await createOperation(c, scope, connection, { type: 'CALLBACK', idempotencyKey: `callback:${callbackCorrelationId}:binding` });
	await c.env.db.prepare(`UPDATE nexora_connection_operations SET callback_correlation_id=?2 WHERE id=?1`).bind(operation.id, callbackCorrelationId).run();
	const receipt = await verifiedTransition(c, scope, connection, operation, 'CONNECTED', { classification: 'CALLBACK_BINDING_VERIFIED', providerNetworkCalled: true, mailboxMutated: false }, { onboardingMissionId, providerConnectionId, providerConnectionGeneration, credentialReferenceId, credentialGeneration });
	await enqueueHealthEvaluation(c,scope,{...connection,connection_generation:receipt.connectionGeneration});
	return { bound: true, ...receipt };
}

async function monitorScheduled({ env }) {
	if (!enabled(env) || emergencyDisabled(env)) return { disabled: true, claimed: 0 };
	const tenant = [...allowlist(env.NEXORA_CONNECTION_TENANT_ALLOWLIST)]; const workspace = [...allowlist(env.NEXORA_CONNECTION_WORKSPACE_ALLOWLIST)]; const account = [...allowlist(env.NEXORA_CONNECTION_ACCOUNT_ALLOWLIST)];
	if (tenant.length !== 1 || workspace.length !== 1 || account.length !== 1) return { disabled: true, claimed: 0 };
	const jobs = await env.db.prepare(`SELECT id,input_json FROM nexora_autonomy_jobs WHERE job_type=?1 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP)) AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) AND json_extract(input_json,'$.tenant_id')=?2 AND json_extract(input_json,'$.workspace_id')=?3 AND json_extract(input_json,'$.account_id')=?4 AND json_extract(input_json,'$.provider')='google' ORDER BY id LIMIT 1`).bind(JOB_TYPE, Number(tenant[0]), Number(workspace[0]), Number(account[0])).all();
	let claimed = 0;
	for (const job of jobs.results || []) {
		const claimResult = await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',attempt_count=attempt_count+1,lease_until=datetime('now','+60 seconds'),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP))`).bind(job.id).run();
		if (!claimResult.meta?.changes) continue;
		claimed += 1;
		try { const output = await evaluateConnection({ env }, JSON.parse(job.input_json)); await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',lease_until=NULL,result_json=?2 WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify(output)).run(); }
		catch (error) { await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state=CASE WHEN attempt_count<3 THEN 'RETRYING' ELSE 'FAILED' END,lease_until=NULL,next_attempt_at=CASE WHEN attempt_count<3 THEN datetime('now','+'||(attempt_count*30)||' seconds') ELSE next_attempt_at END,blocker_code='CONNECTION_RUNTIME_FAILED',result_json=?2 WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ executed: false, error: safeError(error) })).run(); }
	}
	return { disabled: false, claimed };
}

export { JOB_TYPE, AUTHORIZATION_SESSION_EXPIRED_SQL, AUTHORIZATION_SESSION_QUALIFIED_EXPIRED_SQL, AUTHORIZATION_SESSION_LIVE_SQL, expiredAuthorizationOperation, assertRollout, discoverConnection, beginAuthorization, findAuthorizationReplay, replayAuthorization, recoverExpiredAuthorization, evaluateConnection, requireReauthorization, bindVerifiedCallback, monitorScheduled, claim };
export default { JOB_TYPE, assertRollout, discoverConnection, beginAuthorization, findAuthorizationReplay, replayAuthorization, recoverExpiredAuthorization, evaluateConnection, requireReauthorization, bindVerifiedCallback, monitorScheduled, claim };
