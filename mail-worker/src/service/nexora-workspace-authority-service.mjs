import { deriveCorrelationRef } from './nexora-session-ref-service.mjs';

const CAPABILITIES = Object.freeze({
	OWNER: Object.freeze(['domain:read', 'domain:write']),
	ADMIN: Object.freeze(['domain:read', 'domain:write']),
	SECURITY_ADMIN: Object.freeze(['domain:read']),
	MAIL_ADMIN: Object.freeze(['domain:read']),
	VIEWER: Object.freeze(['domain:read']),
	SUPPORT: Object.freeze(['domain:read'])
});

function actorId(actor) {
	const id = Number(actor?.userId);
	if (!Number.isInteger(id) || id <= 0) throw new Error('authenticated user context is required');
	return id;
}

function workspaceId(value) {
	const id = Number(value);
	if (!Number.isInteger(id) || id <= 0) throw new Error('workspaceId is required');
	return id;
}

function capabilities(role) {
	return CAPABILITIES[String(role || '').toUpperCase()] || [];
}

function requestHeader(c, name) {
	try { return c.req?.header?.(name) || null; } catch { return null; }
}

async function selectionEvidence(c, actor, row, capability) {
	const requestId = requestHeader(c, 'cf-ray') || globalThis.crypto?.randomUUID?.();
	const runtimeDeploymentId = String(c.env.CF_VERSION_METADATA?.id || '').trim();
	if (!requestId) throw new Error('server request identity is unavailable');
	if (!runtimeDeploymentId) throw new Error('runtime deployment identity is not configured');
	const workspaceSelectionRef = await deriveCorrelationRef(c.env, 'workspace-selection', [
		actor.userId, row.id, row.tenant_key, row.role, capability, requestId, runtimeDeploymentId
	].join('\n'));
	return {
		workspaceSelectionRef,
		hmacKeyVersion: String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION),
		requestId,
		runtimeDeploymentId,
		validatedAt: new Date().toISOString(),
		redactionLevel: 'BODYLESS'
	};
}

async function listActorWorkspaces(c, actorInput) {
	const id = actorId(actorInput);
	const rows = await c.env.db.prepare(
		`SELECT w.id,w.display_name,w.tenant_key,m.role
		 FROM workspaces w
		 JOIN workspace_members m ON m.workspace_id=w.id
		 WHERE m.user_id=?1
		 ORDER BY w.id`
	).bind(id).all();
	return (rows.results || []).map((row) => ({
		workspaceId: Number(row.id),
		displayName: row.display_name,
		role: row.role,
		capabilities: capabilities(row.role),
		canActivateDomain: capabilities(row.role).includes('domain:write')
	}));
}

async function assertWorkspaceCapability(c, actorInput, requestedWorkspaceId, capability = 'domain:write') {
	const id = actorId(actorInput);
	const selectedWorkspaceId = workspaceId(requestedWorkspaceId);
	const row = await c.env.db.prepare(
		`SELECT w.id,w.display_name,w.tenant_key,w.created_by_user_id,m.role
		 FROM workspaces w
		 JOIN workspace_members m ON m.workspace_id=w.id
		 WHERE w.id=?1 AND m.user_id=?2
		 LIMIT 1`
	).bind(selectedWorkspaceId, id).first();
	if (!row) throw new Error('workspace authority is required');
	if (row.tenant_key !== `user:${id}`) throw new Error('workspace tenant lineage does not match authenticated actor');
	if (!capabilities(row.role).includes(capability)) throw new Error(`workspace ${capability} capability is required`);
	return {
		workspace: {
			id: Number(row.id),
			displayName: row.display_name,
			role: row.role,
			capabilities: capabilities(row.role)
		},
		selectionEvidence: await selectionEvidence(c, { userId: id }, row, capability)
	};
}

export { CAPABILITIES, listActorWorkspaces, assertWorkspaceCapability };
export default { listActorWorkspaces, assertWorkspaceCapability };
