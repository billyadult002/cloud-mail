import app from '../hono/hono';
import result from '../model/result';
import providerRuntimeRouter from '../service/provider-runtime-router';

app.post('/v4/ai/runtime/preflight', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await providerRuntimeRouter.preflight(c, body)));
});

app.post('/v4/ai/workspace/action', async c => {
	const body = await c.req.json();
	return c.json(result.ok(await providerRuntimeRouter.workspaceAction(c, body)));
});

app.post('/secure/ai/openai/smoke', async c => {
	const expected = c.env.CLOUDMAIL_AI_SYNTHETIC_SMOKE_TOKEN || '';
	const provided = c.req.header('x-cloudmail-ai-smoke-token') || '';
	if (!expected || provided !== expected) {
		return c.json(result.fail('synthetic_smoke_token_required', 401));
	}
	return c.json(result.ok(await providerRuntimeRouter.preflight(c, {
		provider_id: 'openai',
		method_id: 'openai_project_api_key_reference',
		synthetic_prompt_class: 'workspace_summarize'
	})));
});
