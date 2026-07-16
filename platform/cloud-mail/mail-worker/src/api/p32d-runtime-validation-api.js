import app from '../hono/hono';
import result from '../model/result';
import p32dRuntimeValidationService from '../service/p32d-runtime-validation-service';

app.post('/v2/p32d/runtime/lifecycle/validate', async c => {
	return c.json(result.ok(await p32dRuntimeValidationService.validateLifecycleStateMachineRuntime()));
});

app.post('/v2/p32d/runtime/audit/hash-chain/validate', async c => {
	return c.json(result.ok(await p32dRuntimeValidationService.validateAuditHashChain()));
});

app.post('/v2/p32d/runtime/message-event-spine/validate', async c => {
	return c.json(result.ok(p32dRuntimeValidationService.validateMessageEventSpine()));
});

app.post('/v2/p32d/runtime/secure-link/validate', async c => {
	return c.json(result.ok(p32dRuntimeValidationService.validateSecureLinkLifecycle()));
});

app.post('/v2/p32d/runtime/inbound-security/validate', async c => {
	return c.json(result.ok(p32dRuntimeValidationService.validateInboundSecurityVerdicts()));
});

app.post('/v2/p32d/runtime/domain-reconciler/validate', async c => {
	return c.json(result.ok(await p32dRuntimeValidationService.validateDomainReconcilerDrift()));
});

app.post('/v2/p32d/runtime/rbac/validate', async c => {
	return c.json(result.ok(p32dRuntimeValidationService.validateOrgTenantRbacPolicy()));
});

app.post('/v2/p32d/runtime/mail-provider/validate', async c => {
	return c.json(result.ok(await p32dRuntimeValidationService.validateMailProviderBoundary()));
});

app.get('/v2/p32d/runtime/internal-usability/contract', async c => {
	return c.json(result.ok(p32dRuntimeValidationService.validateInternalUsabilityApiContract()));
});

app.post('/v2/p32d/runtime/validate-all', async c => {
	return c.json(result.ok(await p32dRuntimeValidationService.validateAll()));
});
