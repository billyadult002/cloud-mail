import app from '../hono/hono';
import result from '../model/result';
import passwordResetService from '../service/password-reset-service';

app.post('/forgot-password', async (c) => {
	const data = await passwordResetService.forgot(c, await c.req.json());
	return c.json(result.ok(data));
});

app.post('/reset-password', async (c) => {
	const data = await passwordResetService.reset(c, await c.req.json());
	return c.json(result.ok(data));
});
