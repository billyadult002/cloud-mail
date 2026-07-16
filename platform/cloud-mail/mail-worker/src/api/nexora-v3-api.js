import app from '../hono/hono';
import result from '../model/result';
import nexoraV3Service from '../service/nexora-v3-service';
import workspaceManagementService from '../service/workspace-management-service';
import enterpriseAuthorityService from '../service/enterprise-authority-service';

const json = c => c.req.json().catch(() => ({}));
const untrustedAuthorityInput = body => ({ provider: body.provider, features: body.features, subject_ref: body.subject_ref, email: body.email, evidence: {} });
// Discovery observations are safe, non-secret hints only. Provider grants and
// verified capabilities are intentionally excluded: they must come from an
// OAuth callback or provider probe, never from an app request.
const untrustedDiscoveryInput = body => ({
	email_or_domain: body.email_or_domain,
	email: body.email,
	domain: body.domain,
	provider: body.provider,
	mailbox_provider: body.mailbox_provider,
	infrastructure_provider: body.infrastructure_provider,
	mx: Array.isArray(body.mx) ? body.mx.map(value => String(value).slice(0, 255)).slice(0, 20) : [],
	observed: body.observed && typeof body.observed === 'object' ? body.observed : {},
	features: Array.isArray(body.features) ? body.features : []
});
app.get('/v3/providers/capabilities', c => c.json(result.ok(nexoraV3Service.providerCapabilityMatrix())));
app.post('/v3/authority/maximize', async c => c.json(result.ok(nexoraV3Service.authorityMaximization(untrustedAuthorityInput(await json(c))))));
app.post('/v3/authority/graph', async c => c.json(result.ok(nexoraV3Service.authorityGraph(untrustedAuthorityInput(await json(c))))));
app.post('/v3/onboarding', async c => c.json(result.ok(await nexoraV3Service.beginOnboarding(c, await json(c)))));
// Legacy advanced-admin compatibility route. The NEXORA app never uses a
// provider-specific route in its normal onboarding path.
app.post('/v3/admin/cloudflare/domains/:domain/verify', async c => c.json(result.ok(await nexoraV3Service.verifyCloudflareDomain(c, c.req.param('domain')))));
app.post('/v3/domains/onboarding/plan', async c => c.json(result.ok(nexoraV3Service.customDomainOnboarding(untrustedDiscoveryInput(await json(c))))));
app.post('/v3/workspaces/contract', async c => c.json(result.ok(nexoraV3Service.identityWorkspace(await json(c)))));
app.post('/v3/aliases/transition', async c => { const body = await json(c); return c.json(result.ok(nexoraV3Service.aliasTransition(body.alias, body.action))); });
app.post('/v3/privacy/analyze', async c => c.json(result.ok(nexoraV3Service.privacyAnalysis(await json(c)))));
app.post('/v3/calendar/intelligence', async c => c.json(result.ok(nexoraV3Service.calendarIntelligence(await json(c)))));
app.post('/v3/meetings/brief', async c => c.json(result.ok(nexoraV3Service.meetingBrief(await json(c)))));
app.post('/v3/graphs/organization', async c => { const body = await json(c); return c.json(result.ok(nexoraV3Service.organizationGraph({ ...body, tenant_key: `user:${c.get('user').userId}`, isolation_evidence: 'AUTHENTICATED_USER_SCOPE' }))); });
app.post('/v3/graphs/identity', async c => { const body = await json(c); return c.json(result.ok(nexoraV3Service.identityGraph({ ...body, tenant_key: `user:${c.get('user').userId}`, isolation_evidence: 'AUTHENTICATED_USER_SCOPE' }))); });
app.post('/v3/repair/plan', async c => c.json(result.ok(nexoraV3Service.repairPlan(await json(c)))));
app.post('/v3/health', async c => c.json(result.ok(nexoraV3Service.domainHealth(await json(c)))));
app.post('/v3/command-center', async c => { const body = await json(c); return c.json(result.ok(nexoraV3Service.executiveCommandCenter({ ...body, authority: 'AUTHORIZATION_REQUIRED', readiness_invariants_observed: false }))); });
app.get('/v3/workspaces/resolve', async c => c.json(result.ok(await workspaceManagementService.resolve(c))));
app.post('/v3/workspaces/domains', async c => {
	const body = await json(c);
	return c.json(result.ok(await workspaceManagementService.addDomain(c, body)));
});
app.get('/v3/workspaces/:id/command-center', async c => {
	const workspaceId = Number(c.req.param('id'));
	return c.json(result.ok(await workspaceManagementService.commandCenter(c, workspaceId)));
});
app.get('/v3/workspaces/:id/authority', async c => c.json(result.ok(await enterpriseAuthorityService.list(c, Number(c.req.param('id'))))));
app.post('/v3/workspaces/:id/membership-invitations', async c => c.json(result.ok(await enterpriseAuthorityService.createInvitation(c, { ...(await json(c)), workspace_id:Number(c.req.param('id')) }))));
app.post('/v3/authority/membership-invitations/:id/review', async c => { const body=await json(c); return c.json(result.ok(await enterpriseAuthorityService.reviewInvitation(c,c.req.param('id'),body.approve===true))); });
app.post('/v3/authority/membership-invitations/accept', async c => c.json(result.ok(await enterpriseAuthorityService.acceptInvitation(c,await json(c)))));
app.post('/v3/workspaces/:id/account-delegations', async c => c.json(result.ok(await enterpriseAuthorityService.createDelegation(c,{ ...(await json(c)), workspace_id:Number(c.req.param('id')) }))));
app.post('/v3/authority/account-delegations/:id/owner-consent', async c => { const body=await json(c); return c.json(result.ok(await enterpriseAuthorityService.ownerConsent(c,c.req.param('id'),body.approve===true))); });
app.post('/v3/authority/account-delegations/:id/review', async c => { const body=await json(c); return c.json(result.ok(await enterpriseAuthorityService.approveDelegation(c,c.req.param('id'),body.approve===true))); });
app.post('/v3/authority/:type/:id/transition', async c => { const body=await json(c); return c.json(result.ok(await enterpriseAuthorityService.transition(c,c.req.param('type'),c.req.param('id'),body.action))); });
