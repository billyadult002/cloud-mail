import { createCapabilityRegistry } from './capability-registry-service.js';
import { createCapabilityEvidenceWriter } from './capability-evidence-ledger-service.js';
import { createCapabilityVerifier } from './capability-verification-service.js';
import gmailAdapter from './gmail-communication-capability-adapter.js';
import { mintCapabilityAuthorityContext } from './capability-authority-context-service.js';

const CONTEXT_MAX_AGE_MS = 5 * 60 * 1000;
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value); }
async function digest(value) { const bytes = new TextEncoder().encode(stable(value)); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function validate(request, context, now) {
	if (!request || request.capability_id !== 'search_email') throw new Error('capability_schema_invalid');
	if (Object.keys(request).some(key => !['capability_id', 'query', 'page_size'].includes(key))) throw new Error('capability_schema_unknown_field');
	if (!Object.isFrozen(context) || context.capability_id !== request.capability_id) throw new Error('capability_authority_context_invalid');
	if (!Number.isFinite(Date.parse(context.timestamp)) || Math.abs(now - Date.parse(context.timestamp)) > CONTEXT_MAX_AGE_MS) throw new Error('capability_authority_context_expired');
}

function assertDependencies(dependencies) {
	if (!dependencies || typeof dependencies.registry?.describe !== 'function' || typeof dependencies.registry?.resolve !== 'function' || typeof dependencies.evidenceWriter !== 'function' || typeof dependencies.verifier !== 'function') throw new Error('capability_dependencies_invalid');
}

async function invokeCapabilityForTest(c, { context, provider_id: providerId, request }, dependencies) {
	assertDependencies(dependencies);
	const { registry, evidenceWriter, verifier, now = Date.now(), timeoutMs = 1500 } = dependencies;
	validate(request, context, now);
	const descriptor = registry.describe(request.capability_id);
	if (descriptor.effect_class !== 'read') throw new Error('capability_effect_not_enabled');
	const adapter = registry.resolve(providerId, request.capability_id);
	const requestDigest = await digest(request);
	const prior = await c.env.db.prepare(`SELECT e.id,e.integrity_hash,e.summary_json,v.id AS verification_id,v.state AS verification_state,v.integrity_state AS verification_integrity_state FROM mission_runtime_evidence e LEFT JOIN mission_runtime_verifications v ON v.evidence_id=e.id AND v.tenant_id=e.tenant_id AND v.workspace_id=e.workspace_id AND v.mission_id=e.mission_id WHERE e.tenant_id=?1 AND e.workspace_id=?2 AND e.source_type='capability_invocation' AND json_extract(e.summary_json,'$.idempotency_key')=?3 ORDER BY e.created_at DESC LIMIT 1`).bind(context.tenant_id, context.workspace_id, context.idempotency_key).first();
	if (prior) {
		const summary = JSON.parse(prior.summary_json || '{}');
		if (summary.request_digest !== requestDigest) throw new Error('capability_replay_conflict');
		if (summary.capability_id !== request.capability_id || Number(summary.actor_user_id) !== Number(context.actor_user_id) || Number(summary.account_id) !== Number(context.account_id)) throw new Error('capability_replay_scope_conflict');
		if (prior.verification_state !== 'verified' || prior.verification_integrity_state !== 'valid' || typeof prior.integrity_hash !== 'string' || prior.integrity_hash.length !== 64 || typeof summary.result_digest !== 'string' || summary.result_digest.length !== 64 || typeof summary.adapter_result_digest !== 'string' || summary.adapter_result_digest.length !== 64 || !Array.isArray(summary.message_refs) || summary.message_refs.length > 20 || summary.message_refs.some(ref => !/^msg_[0-9a-f]{64}$/.test(ref))) throw new Error('capability_replay_unverified');
		return Object.freeze({ result: Object.freeze({ ok: true, response: Object.freeze({ capability_id: request.capability_id, message_refs: Object.freeze(summary.message_refs), result_digest: summary.adapter_result_digest, scope: Object.freeze({ tenant_id: context.tenant_id, workspace_id: context.workspace_id, account_id: context.account_id }), source: Object.freeze({ type: 'canonical_synchronized_mail', provider: providerId, store: 'd1' }), provider_network_called: false, credential_accessed: false, mailbox_mutated: false, replayed: true }) }), evidence: Object.freeze({ evidence_id: prior.id, invocation_id: summary.invocation_id, result_digest: summary.result_digest, integrity_hash: prior.integrity_hash }), verification: Object.freeze({ verification_id: prior.verification_id, evidence_id: prior.id, verification_state: prior.verification_state }), replayed: true });
	}
	const result = await Promise.race([
		adapter.invoke(c, context, request),
		new Promise((_, reject) => setTimeout(() => reject(new Error('capability_execution_timeout')), timeoutMs)),
	]);
	if (!result?.ok || result.response?.capability_id !== request.capability_id || typeof result.response?.result_digest !== 'string' || result.response.result_digest.length !== 64 || !Array.isArray(result.response?.message_refs) || result.response?.source?.type !== 'canonical_synchronized_mail' || result.response?.source?.provider !== providerId || Number(result.response?.scope?.tenant_id) !== Number(context.tenant_id) || Number(result.response?.scope?.workspace_id) !== Number(context.workspace_id) || Number(result.response?.scope?.account_id) !== Number(context.account_id)) throw new Error('capability_adapter_result_invalid');
	const evidence = await evidenceWriter(Object.freeze({ invocation_id: context.invocation_id, capability_id: request.capability_id, tenant_id: context.tenant_id, workspace_id: context.workspace_id, actor_user_id: context.actor_user_id, account_id: context.account_id, mission_id: context.mission_id, run_id: context.run_id, step_id: context.step_id, action_id: context.action_id, authority_generation: context.authority_generation, lease_generation: context.lease_generation, idempotency_key: context.idempotency_key, adapter_id: adapter.adapter_id, adapter_version: adapter.adapter_version, request_digest: requestDigest, adapter_result_digest: result.response.result_digest, result_digest: await digest(result), message_refs: result.response.message_refs, provider_network_called: result.response.provider_network_called, credential_accessed: result.response.credential_accessed, mailbox_mutated: result.response.mailbox_mutated, timestamp: new Date(now).toISOString() }));
	if (!evidence?.evidence_id || !evidence.integrity_hash || evidence.invocation_id !== context.invocation_id) throw new Error('capability_evidence_result_invalid');
	const verification = await verifier({ context, provider_id: providerId, request, result, evidence });
	if (!verification?.verification_id || verification.evidence_id !== evidence.evidence_id || verification.verification_state !== 'verified') throw new Error('capability_result_unverified');
	return Object.freeze({ result, evidence, verification });
}

async function invokeCapability(c, { authority, provider_id: providerId, request } = {}, options = {}) {
	if (Object.keys(options).some(key => key !== 'timeoutMs')) throw new Error('capability_production_dependency_override_forbidden');
	const timeoutMs = options.timeoutMs === undefined ? 1500 : Number(options.timeoutMs);
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 2000) throw new Error('capability_timeout_invalid');
	if (!authority || Object.prototype.hasOwnProperty.call(authority, 'authority_decision')) throw new Error('capability_authority_input_required');
	const context = await mintCapabilityAuthorityContext(c, authority);
	return invokeCapabilityForTest(c, {
		context,
		provider_id: providerId,
		request,
	}, {
		registry: createCapabilityRegistry([gmailAdapter]),
		evidenceWriter: createCapabilityEvidenceWriter(c),
		verifier: createCapabilityVerifier(c),
		timeoutMs,
	});
}

export { invokeCapability, invokeCapabilityForTest };
export default { invokeCapability };
