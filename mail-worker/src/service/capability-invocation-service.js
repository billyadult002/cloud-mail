const CONTEXT_MAX_AGE_MS = 5 * 60 * 1000;
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value); }
async function digest(value) { const bytes = new TextEncoder().encode(stable(value)); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function validate(request, context, now) {
	if (!request || request.capability_id !== 'search_email') throw new Error('capability_schema_invalid');
	if (Object.keys(request).some(key => !['capability_id', 'query', 'page_size'].includes(key))) throw new Error('capability_schema_unknown_field');
	if (!Object.isFrozen(context) || context.capability_id !== request.capability_id) throw new Error('capability_authority_context_invalid');
	if (!Number.isFinite(Date.parse(context.timestamp)) || Math.abs(now - Date.parse(context.timestamp)) > CONTEXT_MAX_AGE_MS) throw new Error('capability_authority_context_expired');
}

async function invokeCapability(c, { context, provider_id: providerId, request }, { registry, evidenceWriter, verifier, now = Date.now(), timeoutMs = 1500 }) {
	validate(request, context, now);
	const descriptor = registry.describe(request.capability_id);
	if (descriptor.effect_class !== 'read') throw new Error('capability_effect_not_enabled');
	const adapter = registry.resolve(providerId, request.capability_id);
	const requestDigest = await digest(request);
	const prior = await c.env.db.prepare(`SELECT e.id,e.summary_json,v.id AS verification_id,v.state AS verification_state FROM mission_runtime_evidence e LEFT JOIN mission_runtime_verifications v ON v.evidence_id=e.id AND v.tenant_id=e.tenant_id AND v.workspace_id=e.workspace_id WHERE e.tenant_id=?1 AND e.workspace_id=?2 AND e.source_type='capability_invocation' AND json_extract(e.summary_json,'$.idempotency_key')=?3 ORDER BY e.created_at DESC LIMIT 1`).bind(context.tenant_id, context.workspace_id, context.idempotency_key).first();
	if (prior) {
		const summary = JSON.parse(prior.summary_json || '{}');
		if (summary.request_digest !== requestDigest) throw new Error('capability_replay_conflict');
		if (prior.verification_state !== 'verified') throw new Error('capability_replay_unverified');
		return Object.freeze({ result: Object.freeze({ ok: true, response: Object.freeze({ capability_id: request.capability_id, message_refs: Object.freeze([]), result_digest: summary.result_digest, replayed: true }) }), evidence: Object.freeze({ evidence_id: prior.id, invocation_id: summary.invocation_id, result_digest: summary.result_digest }), verification: Object.freeze({ verification_id: prior.verification_id, evidence_id: prior.id, verification_state: 'verified' }), replayed: true });
	}
	const result = await Promise.race([
		adapter.invoke(c, context, request),
		new Promise((_, reject) => setTimeout(() => reject(new Error('capability_execution_timeout')), timeoutMs)),
	]);
	if (!result?.ok || result.response?.capability_id !== request.capability_id || !result.response?.result_digest) throw new Error('capability_adapter_result_invalid');
	const evidence = await evidenceWriter(Object.freeze({ evidence_id: crypto.randomUUID(), invocation_id: context.invocation_id, capability_id: request.capability_id, tenant_id: context.tenant_id, workspace_id: context.workspace_id, mission_id: context.mission_id, run_id: context.run_id, step_id: context.step_id, action_id: context.action_id, authority_generation: context.authority_generation, lease_generation: context.lease_generation, idempotency_key: context.idempotency_key, adapter_id: adapter.adapter_id, adapter_version: adapter.adapter_version, request_digest: requestDigest, result_digest: await digest(result), provider_network_called: result.response.provider_network_called, credential_accessed: result.response.credential_accessed, mailbox_mutated: result.response.mailbox_mutated, timestamp: new Date(now).toISOString() }));
	const verification = await verifier({ context, request, result, evidence });
	if (verification.verification_state !== 'verified') throw new Error('capability_result_unverified');
	return Object.freeze({ result, evidence, verification });
}

export { invokeCapability };
export default { invokeCapability };
