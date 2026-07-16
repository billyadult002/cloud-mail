import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import { authTransport } from '../security/token-transport';

app.get('/session/status', async (c) => {
	const user = userContext.getUser(c);
	return c.json(result.ok({
		authenticated: true,
		userId: user.userId,
		email: user.email,
		transport: authTransport(c),
		clientType: authTransport(c) === 'cookie' ? 'browser' : 'legacy_header'
	}));
});
