import app from '../hono/hono';
import result from '../model/result';
import classificationService from '../service/nexora-email-classification-service.mjs';

function scopeFromBody(body) {
	return {
		tenantId: Number(body.tenantId),
		workspaceId: Number(body.workspaceId)
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

async function requireScopeAuthority(c, scope, mode = 'subject') {
	const user = authenticatedUser(c);
	if (user.email === c.env.admin) return { user, admin: true };
	if (Number(scope.tenantId) !== Number(user.userId)) throw new Error('cross-tenant classification authority denied');
	const member = await c.env.db.prepare(
		'SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2 LIMIT 1'
	).bind(scope.workspaceId, user.userId).first();
	if (!member) throw new Error('workspace classification authority denied');
	if (mode === 'admin') throw new Error('admin classification authority is required');
	return { user, admin: false, role: member.role };
}

app.post('/v3/classification/evaluate', async (c) => {
	const body = await c.req.json();
	const decision = classificationService.classifyMessage(body.message || body, body.corrections || []);
	return c.json(result.ok(decision));
});

app.post('/v3/classification/persist', async (c) => {
	requireAdmin(c);
	const body = await c.req.json();
	const scope = scopeFromBody(body);
	await requireScopeAuthority(c, scope, 'admin');
	const decision = await classificationService.classifyAndPersist(c, scope, body.message || body);
	return c.json(result.ok(decision));
});

app.post('/v3/classification/correction', async (c) => {
	const body = await c.req.json();
	const scope = scopeFromBody(body);
	await requireScopeAuthority(c, scope);
	const user = authenticatedUser(c);
	const correctionInput = { ...(body.correction || body) };
	if (correctionInput.authoritySource === 'ADMIN') {
		requireAdmin(c);
		correctionInput.authorityRef = `admin:${user.userId}`;
	} else {
		correctionInput.authoritySource = 'USER';
		correctionInput.authorityRef = `user:${user.userId}`;
	}
	const correction = await classificationService.recordCorrection(c, scope, body.message || body, correctionInput);
	return c.json(result.ok(correction));
});
