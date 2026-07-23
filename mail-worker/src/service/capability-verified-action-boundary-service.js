import enterpriseAuthorityService from './enterprise-authority-service.js';

async function digest(value) { const bytes = new TextEncoder().encode(String(value)); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

function positiveInteger(value, code) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(code);
	return parsed;
}
function nonnegativeInteger(value, code) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code); return parsed; }

async function authorize(c, input) {
	const tenantId = positiveInteger(input.tenant_id, 'capability_tenant_invalid');
	const workspaceId = positiveInteger(input.workspace_id, 'capability_workspace_invalid');
	const actorUserId = positiveInteger(input.actor_user_id, 'capability_actor_invalid');
	const accountId = positiveInteger(input.account_id, 'capability_account_invalid');
	const authorityGeneration = nonnegativeInteger(input.authority_generation, 'capability_authority_generation_invalid');
	const leaseGeneration = positiveInteger(input.lease_generation, 'capability_lease_generation_invalid');
	if (tenantId !== actorUserId) throw new Error('capability_tenant_actor_mismatch');
	const authority = await enterpriseAuthorityService.resolveAccountAuthority(c, { workspaceId, actingUserId: actorUserId, accountId, capability: 'receive_mail' });
	if (!authority.allowed) throw new Error(`capability_authority_denied:${authority.reason}`);
	if (Number(authority.authorityGeneration) !== authorityGeneration) throw new Error('capability_authority_generation_stale');
	const run = await c.env.db.prepare(`SELECT fencing_token,lease_until,state FROM mission_runtime_runs WHERE id=?1 AND mission_id=?2 AND tenant_id=?3 AND workspace_id=?4`).bind(input.run_id, input.mission_id, tenantId, workspaceId).first();
	if (!run || run.state !== 'running' || !run.lease_until || Date.parse(`${run.lease_until}Z`) <= Date.now()) throw new Error('capability_lease_inactive');
	if (Number(run.fencing_token) !== leaseGeneration) throw new Error('capability_lease_generation_stale');
	const workspace = await c.env.db.prepare(`SELECT tenant_key FROM workspaces WHERE id=?1`).bind(workspaceId).first();
	if (!workspace?.tenant_key) throw new Error('capability_workspace_invalid');
	const audit = await c.env.db.prepare(`INSERT INTO workspace_authority_events(id,tenant_key,workspace_id,actor_user_id,subject_user_id,account_id,relationship_type,relationship_id,event_type,state,scope_hash,authority_generation,reason_code,request_id) VALUES(?1,?2,?3,?4,?4,?5,'VERIFIED_ACTION',?6,'READ_MAIL','ALLOW',?7,?8,?9,?10)`).bind(crypto.randomUUID(), workspace.tenant_key, workspaceId, actorUserId, accountId, input.invocation_id, await digest(`search_email|${tenantId}|${workspaceId}|${actorUserId}|${accountId}`), authorityGeneration, `canonical:${authority.reason}`.slice(0, 200), `mission:${input.mission_id}`).run();
	if (Number(audit?.meta?.changes) !== 1) throw new Error('capability_authority_audit_failed');
	return Object.freeze({ tenantId, workspaceId, actorUserId, accountId, authorityGeneration, leaseGeneration, authority });
}

export { authorize };
export default { authorize };
