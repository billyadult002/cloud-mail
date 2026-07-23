import boundary from './capability-verified-action-boundary-service.js';
import { DESCRIPTORS } from './capability-registry-service.js';

function required(value, code) { if (value === undefined || value === null || value === '') throw new Error(code); return value; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; for (const child of Object.values(value)) deepFreeze(child); return Object.freeze(value); }

async function mintCapabilityAuthorityContext(c, input) {
	if (!DESCRIPTORS[input.capability_id]) throw new Error('capability_unknown');
	const authorized = await boundary.authorize(c, input);
	const timestamp = input.timestamp || new Date().toISOString();
	if (!Number.isFinite(Date.parse(timestamp))) throw new Error('capability_timestamp_invalid');
	return deepFreeze({
		invocation_id: required(input.invocation_id, 'capability_invocation_id_required'), capability_id: input.capability_id,
		tenant_id: authorized.tenantId, workspace_id: authorized.workspaceId, actor_user_id: authorized.actorUserId,
		account_id: authorized.accountId, authority_generation: authorized.authorityGeneration, lease_generation: authorized.leaseGeneration,
		mission_id: required(input.mission_id, 'capability_mission_required'), run_id: required(input.run_id, 'capability_run_required'),
		step_id: required(input.step_id, 'capability_step_required'), action_id: required(input.action_id, 'capability_action_required'), idempotency_key: required(input.idempotency_key, 'capability_idempotency_required'),
		authority_decision: { allowed: true, reason: authorized.authority.reason, authority_generation: authorized.authority.authorityGeneration }, timestamp,
	});
}

export { mintCapabilityAuthorityContext };
export default { mintCapabilityAuthorityContext };
