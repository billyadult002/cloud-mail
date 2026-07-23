async function hash(value) { const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)); const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
const integrityPayload = evidence => ({ invocation_id: evidence.invocation_id, capability_id: evidence.capability_id, tenant_id: evidence.tenant_id, workspace_id: evidence.workspace_id, mission_id: evidence.mission_id, run_id: evidence.run_id, step_id: evidence.step_id, action_id: evidence.action_id, authority_generation: evidence.authority_generation, lease_generation: evidence.lease_generation, idempotency_key: evidence.idempotency_key, adapter_id: evidence.adapter_id, adapter_version: evidence.adapter_version, request_digest: evidence.request_digest, result_digest: evidence.result_digest, provider_network_called: evidence.provider_network_called, credential_accessed: evidence.credential_accessed, mailbox_mutated: evidence.mailbox_mutated, timestamp: evidence.timestamp });

function createCapabilityEvidenceWriter(c) {
	return async evidence => {
		const summary = JSON.stringify({ invocation_id: evidence.invocation_id, capability_id: evidence.capability_id, idempotency_key: evidence.idempotency_key, request_digest: evidence.request_digest, result_digest: evidence.result_digest, authority_generation: evidence.authority_generation, lease_generation: evidence.lease_generation, adapter_id: evidence.adapter_id, adapter_version: evidence.adapter_version, provider_network_called: evidence.provider_network_called, credential_accessed: evidence.credential_accessed, mailbox_mutated: evidence.mailbox_mutated });
		const referenceHash = await hash({ invocation_id: evidence.invocation_id, request_digest: evidence.request_digest });
		const integrityHash = await hash(integrityPayload(evidence));
		await c.env.db.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,evidence_type,producer_type,producer_id_hash,integrity_hash,sensitivity,retention_class,valid_from) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'capability_invocation','supported',?9,?10,?11,'provider_observation','controlled_system',?12,?13,'restricted_metadata','runtime_audit',?11)`).bind(evidence.evidence_id, evidence.mission_id, evidence.run_id, evidence.step_id, evidence.action_id, evidence.tenant_id, evidence.workspace_id, `capability:${evidence.capability_id}`, referenceHash, summary, evidence.timestamp, await hash(evidence.adapter_id), integrityHash).run();
		return Object.freeze({ ...evidence, integrity_hash: integrityHash });
	};
}

function createCapabilityVerifier(c) {
	return async ({ context, request, result, evidence }) => {
		const integrityValid = evidence.integrity_hash === await hash(integrityPayload(evidence));
		const safetyValid = result.response?.provider_network_called === false && result.response?.credential_accessed === false && result.response?.mailbox_mutated === false && evidence.provider_network_called === false && evidence.credential_accessed === false && evidence.mailbox_mutated === false;
		const verified = integrityValid && safetyValid && result.ok && result.response?.capability_id === request.capability_id && evidence.invocation_id === context.invocation_id && evidence.mission_id === context.mission_id && evidence.run_id === context.run_id && evidence.step_id === context.step_id && evidence.action_id === context.action_id && Number(evidence.authority_generation) === Number(context.authority_generation) && Number(evidence.lease_generation) === Number(context.lease_generation);
		const verificationId = crypto.randomUUID();
		await c.env.db.prepare(`INSERT INTO mission_runtime_verifications(id,mission_id,run_id,action_id,tenant_id,workspace_id,state,evidence_id,verifier,evidence_set_hash,reason_codes_json,integrity_state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'capability_contract_v1',?9,?10,?11)`).bind(verificationId, context.mission_id, context.run_id, context.action_id, context.tenant_id, context.workspace_id, verified ? 'verified' : 'not_verified', evidence.evidence_id, await hash([evidence.evidence_id, evidence.integrity_hash]), JSON.stringify(verified ? [] : [!integrityValid ? 'capability_evidence_integrity_invalid' : !safetyValid ? 'capability_readonly_safety_invalid' : 'capability_result_unverified']), integrityValid ? 'valid' : 'invalid').run();
		return Object.freeze({ verification_id: verificationId, evidence_id: evidence.evidence_id, verification_state: verified ? 'verified' : 'rejected' });
	};
}

export { createCapabilityEvidenceWriter, createCapabilityVerifier };
export default { createCapabilityEvidenceWriter, createCapabilityVerifier };
