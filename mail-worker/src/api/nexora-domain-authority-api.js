import app from '../hono/hono';
import result from '../model/result';
import domainAuthorityBootstrapService from '../service/nexora-domain-authority-bootstrap-service.mjs';
import domainOwnershipService from '../service/nexora-domain-ownership-service.mjs';
import workspaceAuthorityService from '../service/nexora-workspace-authority-service.mjs';

function authenticatedUser(c) {
	const user = c.get('user');
	if (!user?.userId) throw new Error('authenticated user context is required');
	return user;
}

function requireAdmin(c) {
	const user = authenticatedUser(c);
	if (user.email !== c.env.admin) throw new Error('admin domain authority is required');
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
	return c.json(result.ok({ workspaces: data, selectionRequired: data.length !== 1 }));
});

app.post('/v3/domain-authorities/workspace-selector/validate', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	const scope = scopeFromBody(body, actor);
	const data = await workspaceAuthorityService.assertWorkspaceCapability(c, actor, scope.workspaceId, 'domain:write');
	return c.json(result.ok(data));
});

app.post('/v3/domain-authorities/bootstrap', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	const data = await domainAuthorityBootstrapService.bootstrapVerifiedDomainAuthority(c, scopeFromBody(body, actor), body, actor);
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
