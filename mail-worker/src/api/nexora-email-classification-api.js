import app from '../hono/hono';
import result from '../model/result';
import classificationService from '../service/nexora-email-classification-service.mjs';

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

function rejectLegacyScope(body = {}) {
	if (body.tenantId !== undefined || body.tenant_id !== undefined) {
		throw new Error('cross-tenant classification authority denied');
	}
	if (body.workspaceId !== undefined || body.workspace_id !== undefined) {
		throw new Error('workspace classification authority denied');
	}
}

app.post('/v3/classification/evaluate', async (c) => {
	const body = await c.req.json();
	const decision = classificationService.classifyMessage(body.message || body, body.corrections || []);
	decision.provenance = { source: 'UNVERIFIED_CLIENT_INPUT', durable: false, bodyPersisted: false };
	return c.json(result.ok(decision));
});

app.post('/v3/classification/persist', async (c) => {
	const actor = requireAdmin(c);
	const body = await c.req.json();
	rejectLegacyScope(body);
	classificationService.validateLegacyPersistPayload(body);
	const decision = await classificationService.classifyCanonicalAndPersist(c, {
		acceptanceSessionId: body.acceptanceSessionId || body.interactionId,
		canonicalMessageId: body.canonicalMessageId,
		actor
	});
	return c.json(result.ok(decision));
});

app.get('/v3/classification/records/:canonicalMessageId', async (c) => {
	const actor = authenticatedUser(c);
	const record = await classificationService.readCanonicalClassification(c, {
		acceptanceSessionId: c.req.query('acceptanceSessionId') || c.req.query('interactionId'),
		canonicalMessageId: c.req.param('canonicalMessageId'),
		actor
	});
	return c.json(result.ok(record));
});

app.post('/v3/classification/correction', async (c) => {
	const body = await c.req.json();
	const user = authenticatedUser(c);
	rejectLegacyScope(body);
	classificationService.validateLegacyPersistPayload(body);
	const canonical = await classificationService.loadCanonicalClassificationContext(c, {
		acceptanceSessionId: body.acceptanceSessionId || body.interactionId,
		canonicalMessageId: body.canonicalMessageId,
		actor: user
	});
	const correctionInput = { ...(body.correction || body) };
	if (correctionInput.authoritySource === 'ADMIN') {
		requireAdmin(c);
		correctionInput.authorityRef = `admin:${user.userId}`;
	} else {
		correctionInput.authoritySource = 'USER';
		correctionInput.authorityRef = `user:${user.userId}`;
	}
	const correction = await classificationService.recordCorrection(c, canonical.scope, canonical.message, correctionInput);
	return c.json(result.ok(correction));
});
