import app from '../hono/hono';
import result from '../model/result';
import p32cEnterpriseGovernanceService from '../service/p32c-enterprise-governance-service';

app.get('/v2/p32c/domains/:domain/reconciler', async c => {
	return c.json(result.ok(await p32cEnterpriseGovernanceService.declarativeDomainReconciler(c.req.param('domain'))));
});

app.get('/v2/p32c/domains/:domain/mta-sts-tls-rpt', async c => {
	return c.json(result.ok(await p32cEnterpriseGovernanceService.mtaStsTlsRptFoundation(c.req.param('domain'))));
});

app.post('/v2/p32c/inbound/security-assessment', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(p32cEnterpriseGovernanceService.inboundSecurityAssessment(body)));
});

app.post('/v2/p32c/lifecycle/transition/dry-run', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(p32cEnterpriseGovernanceService.lifecycleTransition(body.current_state, body.request, body.options)));
});

app.get('/v2/p32c/lifecycle/contract', async c => {
	return c.json(result.ok(p32cEnterpriseGovernanceService.lifecycleStateMachine()));
});

app.post('/v2/p32c/audit/hash-event/dry-run', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(await p32cEnterpriseGovernanceService.appendOnlyAuditHashEvent(body)));
});

app.get('/v2/p32c/org-rbac/seed', async c => {
	return c.json(result.ok(p32cEnterpriseGovernanceService.orgTenantRbacSeed()));
});

app.get('/v2/p32c/message-event-spine/contract', async c => {
	return c.json(result.ok(p32cEnterpriseGovernanceService.messageEventSpineContract()));
});

app.post('/v2/p32c/secure-links/lifecycle-contract', async c => {
	const body = await c.req.json().catch(() => ({}));
	return c.json(result.ok(p32cEnterpriseGovernanceService.secureLinkLifecycleContract(body)));
});

app.get('/v2/p32c/adrs', async c => {
	return c.json(result.ok(p32cEnterpriseGovernanceService.architectureAdrs()));
});
