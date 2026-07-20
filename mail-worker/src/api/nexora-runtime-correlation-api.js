import app from '../hono/hono';
import result from '../model/result';
import correlationService from '../service/nexora-runtime-correlation-service.mjs';

function authenticatedUser(c) {
	const user = c.get('user');
	if (!user?.userId) throw new Error('authenticated user context is required');
	return user;
}

app.post('/v3/acceptance/sessions', async (c) => {
	authenticatedUser(c);
	const session = await correlationService.createSession(c, await c.req.json());
	return c.json(result.ok(session));
});

app.post('/v3/acceptance/sessions/:id/consume', async (c) => {
	authenticatedUser(c);
	const body = await c.req.json();
	const correlation = await correlationService.consumeSession(c, { ...body, sessionId: c.req.param('id') });
	return c.json(result.ok(correlation));
});

app.get('/v3/acceptance/sessions/:id', async (c) => {
	authenticatedUser(c);
	const session = await correlationService.getSession(c, c.req.param('id'));
	return c.json(result.ok(session));
});
