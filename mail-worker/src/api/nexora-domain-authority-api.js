import app from '../hono/hono';
import result from '../model/result';
import domainAuthorityBootstrapService from '../service/nexora-domain-authority-bootstrap-service.mjs';
import domainOwnershipService from '../service/nexora-domain-ownership-service.mjs';
import workspaceAuthorityService from '../service/nexora-workspace-authority-service.mjs';
import BizError from '../error/biz-error.js';

function authenticatedUser(c) {
	const user = c.get('user');
	if (!user?.userId) throw new BizError('authenticated user context is required', 401);
	return user;
}

function requireAdmin(c) {
	const user = authenticatedUser(c);
	if (user.email !== c.env.admin) throw new BizError('admin domain authority is required', 403);
	return user;
}

function scopeFromBody(body, actor) {
	const requestedTenantId = body.tenantId ?? body.tenant_id;
	if (requestedTenantId !== undefined && Number(requestedTenantId) !== Number(actor.userId)) {
		throw new Error('tenant scope must match authenticated user');
	}
	return {
		tenantId: Number(actor.userId),
		workspaceId: Number(body.workspaceId ?? body.workspace_id)
	};
}

app.get('/v3/domain-authorities/workspace-selector', async (c) => {
	const actor = requireAdmin(c);
	const data = await workspaceAuthorityService.listActorWorkspaces(c, actor);
	const actorIdentity = await workspaceAuthorityService.resolveActorIdentity(c, actor);
	return c.json(result.ok({ actor: actorIdentity, workspaces: data, selectionRequired: data.length !== 1 }));
});

app.post('/v3/domain-authorities/workspace-selector/validate', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	const scope = scopeFromBody(body, actor);
	const data = await workspaceAuthorityService.assertWorkspaceCapability(c, actor, scope.workspaceId, 'domain:write', { issueCredential: true });
	return c.json(result.ok(data));
});

app.get('/v3/domain-authorities/status', async (c) => {
	const actor = requireAdmin(c);
	const workspaceId = Number(c.req.query('workspace_id'));
	const domain = String(c.req.query('domain') || '').trim().toLowerCase();
	if (!Number.isInteger(workspaceId) || workspaceId <= 0) throw new BizError('workspaceId is required', 400);
	if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new BizError('domain is invalid', 400);
	const workspaces = await workspaceAuthorityService.listActorWorkspaces(c, actor);
	const selected = workspaces.find((workspace) => workspace.workspaceId === workspaceId);
	if (!selected?.capabilities?.includes('domain:write')) throw new BizError('workspace domain:write capability is required', 403);
	const authority = await c.env.db.prepare(
		`SELECT id,normalized_domain,verification_status,generation
		 FROM nexora_domain_authorities
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3
		  AND verification_status='verified' AND revoked_at IS NULL`
	).bind(Number(actor.userId), workspaceId, domain).first();
	return c.json(result.ok({
		verified: Boolean(authority),
		authority: authority ? {
			id: authority.id,
			domain: authority.normalized_domain,
			status: authority.verification_status,
			generation: Number(authority.generation),
		} : null,
	}));
});

app.post('/v3/domain-authorities/bootstrap', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	const scope = scopeFromBody(body, actor);
	await workspaceAuthorityService.requireWorkspaceSelectionCredential(c, actor, scope.workspaceId, 'domain:write', body.workspaceSelectionCredential ?? body.workspace_selection_credential);
	const data = await domainAuthorityBootstrapService.bootstrapVerifiedDomainAuthority(c, scope, body, actor);
	return c.json(result.ok(data));
});

app.post('/v3/domain-authorities/revoke', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	const data = await domainAuthorityBootstrapService.revokeDomainAuthority(c, scopeFromBody(body, actor), body, actor);
	return c.json(result.ok(data));
});

app.post('/v3/domain-ownership/dns-challenges', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	const data = await domainOwnershipService.createDnsChallenge(c, scopeFromBody(body, actor), body, actor);
	return c.json(result.ok(data));
});

app.post('/v3/domain-ownership/dns-challenges/verify', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	const data = await domainOwnershipService.verifyDnsChallenge(c, scopeFromBody(body, actor), body, actor);
	return c.json(result.ok(data));
});
