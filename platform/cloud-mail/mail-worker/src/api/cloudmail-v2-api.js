import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import cloudMailV2Service from '../service/cloudmail-v2-service';
import BizError from '../error/biz-error';
import mailboxAuthorizationService from '../service/mailbox-authorization-service';
import syncPolicyService from '../service/sync-policy-service';

app.get('/auth/email-discovery', async c => {
	return c.json(result.ok(await cloudMailV2Service.discover(c, c.req.query('email'))));
});

app.post('/auth/provisioning-handoff', async c => {
	const body = await c.req.json();
	c.header('Cache-Control', 'private, no-store');
	return c.json(result.ok(await cloudMailV2Service.beginProvisioningAuthHandoff(c, body.email, {
		provider: body.provider,
		domain: body.domain,
		deviceReference: body.deviceReference
	})));
});

app.post('/auth/provisioning-continuation', async c => {
	const body = await c.req.json();
	c.header('Cache-Control', 'private, no-store');
	return c.json(result.ok(await cloudMailV2Service.createProvisioningContinuation(c, body.email, {
		provider: body.provider,
		domain: body.domain,
		deviceReference: body.deviceReference,
		challengeReference: body.challengeReference
	})));
});

app.post('/auth/bootstrap-from-routing', async c => {
	const body = await c.req.json();
	c.header('Cache-Control', 'private, no-store');
	return c.json(result.ok(await cloudMailV2Service.bootstrap(c, body.email, body.continuationToken, {
		provider: body.provider,
		deviceReference: body.deviceReference
	})));
});

app.post('/auth/activate', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await cloudMailV2Service.activate(c, body.token, body.password)));
});

app.get('/v2/ai/consent', async c => {
	return c.json(result.ok(await cloudMailV2Service.consent(c, userContext.getUserId(c))));
});

app.put('/v2/ai/consent', async c => {
	return c.json(result.ok(await cloudMailV2Service.updateConsent(
		c, userContext.getUserId(c), await c.req.json()
	)));
});

app.get('/v2/ai/providers', async c => {
	return c.json(result.ok(await cloudMailV2Service.providerReadiness(c, userContext.getUserId(c))));
});

app.get('/v2/accounts', async c => {
	const userId = userContext.getUserId(c);
	const user = c.get('user');
	await cloudMailV2Service.ensureNativeAccount(c, userId, user.email);
	return c.json(result.ok(await cloudMailV2Service.accounts(c, userId)));
});

app.get('/v2/mailbox-authorizations', async c => {
	return c.json(result.ok(await mailboxAuthorizationService.list(c, userContext.getUserId(c))));
});

app.post('/v2/mailbox-authorizations', async c => {
	return c.json(result.ok(await mailboxAuthorizationService.authorize(
		c,
		userContext.getUserId(c),
		await c.req.json()
	)));
});

app.delete('/v2/mailbox-authorizations/:id', async c => {
	return c.json(result.ok(await mailboxAuthorizationService.revoke(
		c,
		userContext.getUserId(c),
		c.req.param('id')
	)));
});

app.get('/v2/forwarding-settings', async c => {
	const user = c.get('user');
	const email = c.req.query('email') || user.email;
	return c.json(result.ok(await cloudMailV2Service.forwardingSettings(c, email)));
});

app.get('/v2/mail/messages', async c => {
	return c.json(result.fail('Frozen: canonical mail reads use /api/email/list with account/email source metadata.', 404));
});

app.post('/v2/security/analyze', async c => {
	return c.json(result.ok(await cloudMailV2Service.securityAnalyze(
		c, userContext.getUserId(c), await c.req.json()
	)));
});

app.post('/v2/secure-send', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await cloudMailV2Service.createSecureSend(
		c, userContext.getUserId(c), body.body, Number(body.expiresInSeconds || 86400)
	)));
});

app.get('/secure/:token', async c => {
	const content = await cloudMailV2Service.openSecureSend(c, c.req.param('token'));
	return new Response(content, {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff'
		}
	});
});

app.get('/v2/admin/summary', async c => {
	const user = c.get('user');
	return c.json(result.ok(await cloudMailV2Service.adminSummary(
		c, userContext.getUserId(c), user.email
	)));
});

app.post('/v2/admin/routing-audit', async c => {
	const user = c.get('user');
	if (user.email !== c.env.admin) throw new BizError('Unauthorized', 403);
	const body = await c.req.json();
	return c.json(result.ok(await cloudMailV2Service.routingAudit(c, body.emails || [])));
});

app.get('/internal/sync-policy', async c => {
	const user = c.get('user');
	if (user.email !== c.env.admin) throw new BizError('Unauthorized', 403);
	return c.json(result.ok(await syncPolicyService.load(c)));
});

app.patch('/internal/sync-policy', async c => {
	const user = c.get('user');
	if (user.email !== c.env.admin) throw new BizError('Unauthorized', 403);
	return c.json(result.ok(await syncPolicyService.save(c, await c.req.json())));
});
