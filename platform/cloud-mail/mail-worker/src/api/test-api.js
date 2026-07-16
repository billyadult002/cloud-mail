import app from '../hono/hono';
import result from '../model/result';
import providerRuntimeRouter from '../service/provider-runtime-router';

app.post('/test/ai/workspace/verify', async c => {
	const body = await c.req.json();
	const verify = providerRuntimeRouter.publicWorkspaceVerification(body);
	return c.json(result.ok({
		...verify,
		runtime_call_executed: verify.runtime_call_executed,
		auth_required_for_runtime: verify.auth_required_for_runtime
	}));
});

app.post('/test/ai/workspace/verify/action', async c => {
	const body = await c.req.json();
	const verify = providerRuntimeRouter.publicWorkspaceVerification(body);
	return c.json(result.ok({
		...verify,
		runtime_call_executed: verify.runtime_call_executed,
		auth_required_for_runtime: verify.auth_required_for_runtime
	}));
});
