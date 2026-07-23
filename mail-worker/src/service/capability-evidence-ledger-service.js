async function hash(value) { const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)); const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
const integrityPayload = evidence => ({ invocation_id: evidence.invocation_id, capability_id: evidence.capability_id, tenant_id: evidence.tenant_id, workspace_id: evidence.workspace_id, actor_user_id: evidence.actor_user_id, account_id: evidence.account_id, mission_id: evidence.mission_id, run_id: evidence.run_id, step_id: evidence.step_id, action_id: evidence.action_id, authority_generation: evidence.authority_generation, lease_generation: evidence.lease_generation, idempotency_key: evidence.idempotency_key, adapter_id: evidence.adapter_id, adapter_version: evidence.adapter_version, request_digest: evidence.request_digest, adapter_result_digest: evidence.adapter_result_digest, result_digest: evidence.result_digest, message_refs: evidence.message_refs, provider_network_called: evidence.provider_network_called, credential_accessed: evidence.credential_accessed, mailbox_mutated: evidence.mailbox_mutated, timestamp: evidence.timestamp });

function createCapabilityEvidenceWriter(c) {
	return async input => {
		const evidence = Object.freeze({ ...input, evidence_id: crypto.randomUUID() });
		const summary = JSON.stringify({ invocation_id: evidence.invocation_id, capability_id: evidence.capability_id, actor_user_id: evidence.actor_user_id, account_id: evidence.account_id, idempotency_key: evidence.idempotency_key, request_digest: evidence.request_digest, adapter_result_digest: evidence.adapter_result_digest, result_digest: evidence.result_digest, message_refs: evidence.message_refs, authority_generation: evidence.authority_generation, lease_generation: evidence.lease_generation, adapter_id: evidence.adapter_id, adapter_version: evidence.adapter_version, provider_network_called: evidence.provider_network_called, credential_accessed: evidence.credential_accessed, mailbox_mutated: evidence.mailbox_mutated });
		const referenceHash = await hash({ invocation_id: evidence.invocation_id, request_digest: evidence.request_digest });
		const integrityHash = await hash(integrityPayload(evidence));
		const write = await c.env.db.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,evidence_type,producer_type,producer_id_hash,integrity_hash,sensitivity,retention_class,valid_from) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'capability_invocation','supported',?9,?10,?11,'canonical_state_observation','controlled_system',?12,?13,'restricted_metadata','runtime_audit',?11)`).bind(evidence.evidence_id, evidence.mission_id, evidence.run_id, evidence.step_id, evidence.action_id, evidence.tenant_id, evidence.workspace_id, `capability:${evidence.capability_id}`, referenceHash, summary, evidence.timestamp, await hash(evidence.adapter_id), integrityHash).run();
		if (Number(write?.meta?.changes) !== 1) throw new Error('capability_evidence_write_failed');
		return Object.freeze({ ...evidence, integrity_hash: integrityHash });
	};
}

export { createCapabilityEvidenceWriter, hash, integrityPayload };
export default { createCapabilityEvidenceWriter, hash, integrityPayload };
