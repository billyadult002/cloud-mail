// Deterministic, redacted persistence fingerprint for rollback and duplicate-effect tests.
// Deliberately selects metadata only; token ciphertext, OAuth material, and credentials are
// never read into the fingerprint.
const stable = (value) => {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
	return value;
};

async function rows(db, sql, bindings = []) {
	const result = await db.prepare(sql).bind(...bindings).all();
	return (result.results || []).map((row) => stable(row));
}

async function fingerprintReplacementAuthorityState(c, { missionId, tenantId, workspaceId }) {
	const db = c.env.db;
	const state = {
		tokens: await rows(db, `SELECT COUNT(*) AS count, onboarding_mission_id,tenant_id,workspace_id,provider,provider_account_hash,rotation_generation,connection_health,revoked_at,access_token_expires_at,granted_scopes_json FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 GROUP BY onboarding_mission_id,tenant_id,workspace_id,provider,provider_account_hash,rotation_generation,connection_health,revoked_at,access_token_expires_at,granted_scopes_json`, [missionId, tenantId, workspaceId]),
		reauthorization: await rows(db, `SELECT id,original_correlation_id,original_authorization_session_id,replacement_authorization_session_id,replacement_correlation_id,onboarding_mission_id,tenant_id,workspace_id,provider,scope_plan_reference,scope_plan_digest,expected_token_generation,replacement_token_generation,fencing_token,attempt,status FROM nexora_onboarding_reauthorization_work WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 ORDER BY id`, [missionId, tenantId, workspaceId]),
		checkpoints: await rows(db, `SELECT correlation_id,claim_id,fencing_token,step,status,attempt,token_generation_reference FROM nexora_onboarding_callback_checkpoints WHERE correlation_id IN (SELECT id FROM nexora_onboarding_callback_correlations WHERE onboarding_mission_id=?1) ORDER BY correlation_id,step`, [missionId]),
		commitResults: await rows(db, `SELECT id,reauthorization_work_id,idempotency_key,authority_tuple_hash,onboarding_mission_id,tenant_id,workspace_id,provider,replacement_authorization_session_id,replacement_correlation_id,expected_prior_checkpoint,expected_token_generation,committed_token_generation,callback_claim_id,fencing_token,status FROM nexora_onboarding_reauthorization_commit_results WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 ORDER BY id`, [missionId, tenantId, workspaceId]),
		evidenceOutbox: await rows(db, `SELECT id,commit_result_id,onboarding_mission_id,tenant_id,workspace_id,event_type,status,attempts,delivered_at FROM nexora_onboarding_evidence_outbox WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 ORDER BY id`, [missionId, tenantId, workspaceId]),
		providerConnections: await rows(db, `SELECT id,onboarding_mission_id,tenant_id,workspace_id,provider,connection_identity,generation,connection_state FROM nexora_onboarding_provider_connections WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 ORDER BY id`, [missionId, tenantId, workspaceId]),
		mission: await rows(db, `SELECT mission_id,phase,blocked_reason FROM nexora_onboarding_state WHERE mission_id=?1`, [missionId]),
		correlations: await rows(db, `SELECT id,onboarding_mission_id,tenant_id,workspace_id,provider,status,resume_checkpoint,claim_generation FROM nexora_onboarding_callback_correlations WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 ORDER BY id`, [missionId, tenantId, workspaceId]),
	};
	const canonical = JSON.stringify(stable(state));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
	return { digest: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''), state };
}

export default { fingerprintReplacementAuthorityState };
