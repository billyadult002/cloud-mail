import app from '../hono/hono';
import result from '../model/result';
import classificationService from '../service/nexora-email-classification-service.mjs';

function scopeFromBody(body) {
	return {
		tenantId: body.tenantId,
		workspaceId: body.workspaceId
	};
}

function authenticatedUser(c) {
	const user = c.get('user');
	if (!user?.userId) throw new Error('authenticated user context is required');
	return user;
}

function requireAdmin(c) {
	const user = authenticatedUser(c);
	if (user.email !== c.env.admin) throw new Error('admin classification authority is required');
	return user;
}

app.post('/v3/classification/evaluate', async (c) => {
	const body = await c.req.json();
	const decision = classificationService.classifyMessage(body.message || body, body.corrections || []);
	return c.json(result.ok(decision));
});

app.post('/v3/classification/persist', async (c) => {
	requireAdmin(c);
	const body = await c.req.json();
	const decision = await classificationService.classifyAndPersist(c, scopeFromBody(body), body.message || body);
	return c.json(result.ok(decision));
});

app.post('/v3/classification/correction', async (c) => {
	const body = await c.req.json();
	const user = authenticatedUser(c);
	const correctionInput = { ...(body.correction || body) };
	if (correctionInput.authoritySource === 'ADMIN') {
		requireAdmin(c);
		correctionInput.authorityRef = `admin:${user.userId}`;
	} else {
		correctionInput.authoritySource = 'USER';
		correctionInput.authorityRef = `user:${user.userId}`;
	}
	const correction = await classificationService.recordCorrection(c, scopeFromBody(body), body.message || body, correctionInput);
	return c.json(result.ok(correction));
});
