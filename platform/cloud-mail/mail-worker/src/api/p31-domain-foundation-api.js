import app from '../hono/hono';
import result from '../model/result';
import p31DomainFoundationService from '../service/p31-domain-foundation-service';

app.get('/v2/p31/cloudflare/zones', async c => {
	return c.json(result.ok(await p31DomainFoundationService.discoverZones(c)));
});

app.post('/v2/p31/domains/select', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(p31DomainFoundationService.selectDomain(body.domain_name || body.domain, body.candidates || [])));
});

app.get('/v2/p31/domains/:domain/scan', async c => {
	return c.json(result.ok(await p31DomainFoundationService.scanDomain(c, c.req.param('domain'))));
});

app.post('/v2/p31/domains/:domain/enable', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(await p31DomainFoundationService.enableCloudMail(c, c.req.param('domain'), body)));
});

app.get('/v2/p31/ui-contract', async c => {
	return c.json(result.ok(p31DomainFoundationService.uiApiContract()));
});

app.get('/v2/domains/:domain/p31/discovery', async c => {
	return c.json(result.ok(await p31DomainFoundationService.discover(c, c.req.param('domain'))));
});

app.get('/v2/domains/:domain/p31/readiness', async c => {
	const discovery = await p31DomainFoundationService.discover(c, c.req.param('domain'));
	return c.json(result.ok(discovery.readiness));
});

app.post('/v2/domains/:domain/p31/autoconfigure', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(await p31DomainFoundationService.autoconfigure(c, c.req.param('domain'), body)));
});

app.post('/v2/domains/:domain/p31/provision-foundation', async c => {
	return c.json(result.ok(await p31DomainFoundationService.provisionFoundation(c, c.req.param('domain'))));
});

app.post('/v2/security/lifecycle/dry-run', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(p31DomainFoundationService.lifecycleDryRun(body)));
});

app.post('/v2/security/lifecycle/:domain/dry-run', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(p31DomainFoundationService.secureLifecyclePlan(c.req.param('domain'), body)));
});

app.post('/v2/security/secure-links/dry-run', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(p31DomainFoundationService.secureLinkMetadataFoundation(body.domain, body)));
});

app.post('/v2/security/secure-links/:id/revoke/dry-run', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(p31DomainFoundationService.secureLinkMetadataFoundation(body.domain, {
		...body,
		revoked_at: body.revoked_at || new Date(0).toISOString(),
		secure_link_id: c.req.param('id')
	})));
});

app.get('/v2/security/secure-links/contract', async c => {
	return c.json(result.ok(p31DomainFoundationService.secureLinkApiContract()));
});
