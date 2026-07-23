import { hash, integrityPayload } from './capability-evidence-ledger-service.js';

function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value); }
async function canonicalDigest(value) { const bytes = new TextEncoder().encode(stable(value)); const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

function sameScope(context, response, evidence) {
	return Number(response?.scope?.tenant_id) === Number(context.tenant_id)
		&& Number(response?.scope?.workspace_id) === Number(context.workspace_id)
		&& Number(response?.scope?.account_id) === Number(context.account_id)
		&& Number(evidence.tenant_id) === Number(context.tenant_id)
		&& Number(evidence.workspace_id) === Number(context.workspace_id);
}

function createCapabilityVerifier(c) {
	return async ({ context, provider_id: providerId, request, result, evidence }) => {
		if (!evidence?.evidence_id || !evidence.integrity_hash) throw new Error('capability_evidence_result_invalid');
		const persisted = await c.env.db.prepare(`SELECT id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,evidence_type,source_type,producer_type,producer_id_hash,reference_hash,summary_json,integrity_hash,status,observed_at FROM mission_runtime_evidence WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND source_type='capability_invocation'`).bind(evidence.evidence_id, context.tenant_id, context.workspace_id).first();
		if (!persisted) throw new Error('capability_evidence_not_durable');
		let summary;
		try { summary = JSON.parse(persisted.summary_json); } catch { throw new Error('capability_evidence_summary_invalid'); }
		const persistedEvidence = {
			invocation_id: summary.invocation_id, capability_id: summary.capability_id,
			tenant_id: persisted.tenant_id, workspace_id: persisted.workspace_id,
			actor_user_id: summary.actor_user_id, account_id: summary.account_id,
			mission_id: persisted.mission_id, run_id: persisted.run_id, step_id: persisted.step_id, action_id: persisted.action_id,
			authority_generation: summary.authority_generation, lease_generation: summary.lease_generation,
			idempotency_key: summary.idempotency_key, adapter_id: summary.adapter_id, adapter_version: summary.adapter_version,
			request_digest: summary.request_digest, adapter_result_digest: summary.adapter_result_digest, result_digest: summary.result_digest,
			message_refs: summary.message_refs, provider_network_called: summary.provider_network_called,
			credential_accessed: summary.credential_accessed, mailbox_mutated: summary.mailbox_mutated, timestamp: persisted.observed_at,
		};
		const metadataValid = persisted.claim_key === `capability:${request.capability_id}` && persisted.evidence_type === 'canonical_state_observation' && persisted.source_type === 'capability_invocation' && persisted.producer_type === 'controlled_system' && persisted.producer_id_hash === await hash(summary.adapter_id) && persisted.reference_hash === await hash({ invocation_id: summary.invocation_id, request_digest: summary.request_digest });
		const integrityValid = metadataValid && persisted.integrity_hash === evidence.integrity_hash && persisted.integrity_hash === await hash(integrityPayload(persistedEvidence)) && evidence.integrity_hash === await hash(integrityPayload(evidence));
		const safetyValid = result.response?.provider_network_called === false && result.response?.credential_accessed === false && result.response?.mailbox_mutated === false && evidence.provider_network_called === false && evidence.credential_accessed === false && evidence.mailbox_mutated === false;
		const { result_digest: adapterResultDigest, ...adapterPayload } = result.response || {};
		const adapterDigestValid = typeof adapterResultDigest === 'string' && adapterResultDigest === await hash(adapterPayload);
		const executionDigestValid = evidence.request_digest === await canonicalDigest(request) && evidence.result_digest === await canonicalDigest(result);
		const contractValid = typeof providerId === 'string' && providerId.length > 0 && result.ok === true && result.response?.capability_id === request.capability_id && result.response?.source?.type === 'canonical_synchronized_mail' && result.response?.source?.provider === providerId && Array.isArray(result.response?.message_refs) && adapterDigestValid && executionDigestValid;
		const evidenceValid = persisted.status === 'supported' && persisted.mission_id === context.mission_id && persisted.run_id === context.run_id && persisted.step_id === context.step_id && persisted.action_id === context.action_id && summary.invocation_id === context.invocation_id && summary.request_digest === evidence.request_digest && summary.adapter_result_digest === adapterResultDigest && summary.result_digest === evidence.result_digest && JSON.stringify(summary.message_refs) === JSON.stringify(result.response.message_refs) && JSON.stringify(evidence.message_refs) === JSON.stringify(result.response.message_refs) && summary.adapter_id === evidence.adapter_id && summary.adapter_version === evidence.adapter_version;
		const scopeValid = sameScope(context, result.response, evidence) && Number(summary.actor_user_id) === Number(context.actor_user_id) && Number(summary.account_id) === Number(context.account_id) && Number(evidence.actor_user_id) === Number(context.actor_user_id) && Number(evidence.account_id) === Number(context.account_id) && evidence.mission_id === context.mission_id && evidence.run_id === context.run_id && evidence.step_id === context.step_id && evidence.action_id === context.action_id && Number(evidence.authority_generation) === Number(context.authority_generation) && Number(evidence.lease_generation) === Number(context.lease_generation);
		const verified = integrityValid && safetyValid && contractValid && evidenceValid && scopeValid;
		const reasons = [];
		if (!integrityValid) reasons.push('capability_evidence_integrity_invalid');
		if (!safetyValid) reasons.push('capability_readonly_safety_invalid');
		if (!contractValid) reasons.push('capability_contract_invalid');
		if (!evidenceValid) reasons.push('capability_evidence_binding_invalid');
		if (!scopeValid) reasons.push('capability_scope_invalid');
		const verificationId = crypto.randomUUID();
		const write = await c.env.db.prepare(`INSERT INTO mission_runtime_verifications(id,mission_id,run_id,action_id,tenant_id,workspace_id,state,evidence_id,verifier,evidence_set_hash,reason_codes_json,integrity_state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'canonical_capability_verifier_v1',?9,?10,?11)`).bind(verificationId, context.mission_id, context.run_id, context.action_id, context.tenant_id, context.workspace_id, verified ? 'verified' : 'not_verified', evidence.evidence_id, await hash([evidence.evidence_id, evidence.integrity_hash]), JSON.stringify(reasons), integrityValid ? 'valid' : 'invalid').run();
		if (Number(write?.meta?.changes) !== 1) throw new Error('capability_verification_write_failed');
		return Object.freeze({ verification_id: verificationId, evidence_id: evidence.evidence_id, verification_state: verified ? 'verified' : 'rejected' });
	};
}

export { createCapabilityVerifier };
export default { createCapabilityVerifier };
