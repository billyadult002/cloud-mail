import app from '../hono/hono';
import emailService from '../service/email-service';
import result from '../model/result';
import userContext from '../security/user-context';

app.get('/v2/mail/all', async (c) => {
	const data = await emailService.globalLedgerList(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});
