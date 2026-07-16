import app from '../hono/hono';
import loginService from '../service/login-service';
import result from '../model/result';
import userContext from '../security/user-context';
import { buildAuthCookie, buildClearAuthCookie } from '../security/token-transport';
import cloudMailV2Service from '../service/cloudmail-v2-service';

app.post('/login', async (c) => {
	const body = await c.req.json();
	await cloudMailV2Service.recordProvisioningAuthAttempt(c, body.challengeReference, 'started');
	let token;
	try {
		token = await loginService.login(c, body);
	} catch (error) {
		await cloudMailV2Service.recordProvisioningAuthAttempt(c, body.challengeReference, 'failed');
		throw error;
	}
	// Dual-write (WF-2, Phase C): keep the token in the body for the legacy
	// header path, AND set a hardened httpOnly cookie so the client can migrate
	// off localStorage. The cookie is not JS-readable → XSS cannot steal it.
	c.header('Set-Cookie', buildAuthCookie(token));
	c.header('Cache-Control', 'private, no-store');
	return c.json(result.ok({ token: token }));
});

app.post('/register', async (c) => {
	const data = await loginService.register(c, await c.req.json());
	return c.json(result.ok({
		...data,
		userCreated: true,
		routingCreated: Boolean(data?.routingSetup?.routingCreated)
	}));
});

app.delete('/logout', async (c) => {
	await loginService.logout(c, userContext.getUserId(c));
	// Clear the hardened session cookie alongside server-side token revocation.
	c.header('Set-Cookie', buildClearAuthCookie());
	return c.json(result.ok());
});
