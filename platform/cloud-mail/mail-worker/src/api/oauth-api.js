import app from '../hono/hono';
import result from "../model/result";
import oauthService from "../service/oauth-service";
import { buildAuthCookie } from '../security/token-transport';

app.post('/oauth/linuxDo/login', async (c) => {
	const loginInfo = await oauthService.linuxDoLogin(c, await c.req.json());
	if (loginInfo?.token) c.header('Set-Cookie', buildAuthCookie(loginInfo.token));
	return c.json(result.ok(loginInfo))
});

app.put('/oauth/bindUser', async (c) => {
	const loginInfo = await oauthService.bindUser(c, await c.req.json());
	if (loginInfo?.token) c.header('Set-Cookie', buildAuthCookie(loginInfo.token));
	return c.json(result.ok(loginInfo))
})
