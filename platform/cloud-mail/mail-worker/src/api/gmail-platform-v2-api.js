import app from '../hono/hono';
import result from '../model/result';
import gmailPlatformV2Service from '../service/gmail-platform-v2-service';

app.get('/v2/gmail-platform/inventory', async c => {
	return c.json(result.ok(gmailPlatformV2Service.architectureInventory()));
});

app.get('/v2/gmail-platform/rest-only-plan', async c => {
	return c.json(result.ok(gmailPlatformV2Service.restOnlyMigrationPlan()));
});

app.post('/v2/gmail-platform/capability/evaluate', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.capabilityEngine(body)));
});

app.post('/v2/gmail-platform/health/evaluate', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.healthEngine(body)));
});

app.post('/v2/gmail-platform/governance/evaluate', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.governanceEngine(body)));
});

app.post('/v2/gmail-platform/lifecycle/evaluate', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.lifecycleEngine(body)));
});

app.post('/v2/gmail-platform/freshness/evaluate', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.freshnessEngine(body)));
});

app.post('/v2/gmail-platform/send/audit', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.sendPlatformAudit(body)));
});

app.post('/v2/gmail-platform/receive/audit', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.receivePlatformAudit(body)));
});

app.post('/v2/gmail-platform/identity/audit', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.identityPlatformAudit(body.accounts || [])));
});

app.post('/v2/gmail-platform/truth/evaluate', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.truthPlatform(body)));
});

app.post('/v2/gmail-platform/coordinator/plan', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(gmailPlatformV2Service.durableObjectCoordinatorPlan(body)));
});

app.get('/v2/gmail-platform/replay-readiness', async c => {
	return c.json(result.ok(gmailPlatformV2Service.replayReadiness()));
});
