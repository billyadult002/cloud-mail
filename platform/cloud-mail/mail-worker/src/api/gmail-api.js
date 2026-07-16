import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import gmailImapService from '../service/gmail-imap-service';
import googleTestUserRequestService from '../service/google-test-user-request-service';

function gmailFailureMessage(error) {
	const message = String(error?.message || error || 'Gmail IMAP connection failed.');
	const lower = message.toLowerCase();
	if (lower.includes('app password') || lower.includes('authentication') || lower.includes('login') || lower.includes('credentials')) {
		return 'Gmail authorization failed. Continue with Google and try again.';
	}
	if (lower.includes('socket') || lower.includes('network') || lower.includes('connection') || lower.includes('closed')) {
		return 'Gmail connection failed before mail sync. Check Google availability and try again.';
	}
	return message.slice(0, 300);
}

function gmailFailureCode(error) {
	return Number(error?.code || error?.status || 503);
}

app.post('/gmail/connect', async c => {
	try {
		const data = await gmailImapService.connect(c, userContext.getUserId(c), await c.req.json());
		return c.json(result.ok(data));
	} catch (error) {
		return c.json(result.fail(gmailFailureMessage(error), gmailFailureCode(error)));
	}
});

app.post('/gmail/sync', async c => {
	try {
		const data = await gmailImapService.sync(c, userContext.getUserId(c), await c.req.json());
		if (data?.email) {
			await googleTestUserRequestService.recordFirstSync(c, data.email);
		}
		return c.json(result.ok(data));
	} catch (error) {
		return c.json(result.fail(gmailFailureMessage(error), gmailFailureCode(error)));
	}
});

app.post('/gmail/receive-reality/probe', async c => {
	try {
		const data = await gmailImapService.receiveRealityProbe(c, userContext.getUserId(c), await c.req.json());
		return c.json(result.ok(data));
	} catch (error) {
		return c.json(result.fail(gmailFailureMessage(error), gmailFailureCode(error)));
	}
});

app.get('/gmail/diagnose', async c => {
	try {
		const data = await gmailImapService.diagnose(c);
		return c.json(result.ok(data));
	} catch (error) {
		return c.json(result.fail(gmailFailureMessage(error), gmailFailureCode(error)));
	}
});

app.get('/gmail/freshness-trace', async c => {
	try {
		const accountId = Number(c.req.query('accountId') || 0);
		const data = await gmailImapService.freshnessTrace(c, userContext.getUserId(c), { accountId });
		return c.json(result.ok(data));
	} catch (error) {
		return c.json(result.fail(gmailFailureMessage(error), gmailFailureCode(error)));
	}
});
