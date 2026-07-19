import app from '../hono/hono';
import result from '../model/result';
import domainAuthorityBootstrapService from '../service/nexora-domain-authority-bootstrap-service.mjs';
import domainOwnershipService from '../service/nexora-domain-ownership-service.mjs';

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

app.post('/v3/domain-authorities/bootstrap', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	const data = await domainAuthorityBootstrapService.bootstrapVerifiedDomainAuthority(c, scopeFromBody(body, actor), body, actor);
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
