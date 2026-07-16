import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import geminiOAuthService from '../service/gemini-oauth-service';
import gmailImapService from '../service/gmail-imap-service';
import googleTestUserRequestService from '../service/google-test-user-request-service';

app.get('/v2/ai/gemini/status', async c => {
	return c.json(result.ok(await geminiOAuthService.status(c, userContext.getUserId(c))));
});

app.get('/v2/ai/gemini/oauth/start', async c => {
	return c.json(result.ok(await geminiOAuthService.start(c, userContext.getUserId(c))));
});

app.get('/v2/google/mail/oauth/start', async c => {
	return c.json(result.ok(await geminiOAuthService.startGoogleMailbox(c, userContext.getUserId(c), c.req.query())));
});

app.get('/v2/google/oauth/start', async c => {
	return c.json(result.ok(await geminiOAuthService.startGoogleMailbox(c, userContext.getUserId(c), c.req.query())));
});

app.get('/v2/gmail/oauth/start', async c => {
	return c.json(result.ok(await geminiOAuthService.startGoogleMailbox(c, userContext.getUserId(c), c.req.query())));
});

app.get('/v2/gmail/oauth/reconnect', async c => {
	return c.json(result.ok(await geminiOAuthService.startGoogleMailbox(c, userContext.getUserId(c), c.req.query())));
});

app.get('/ai/oauth/gemini/start', async c => {
	const data = await geminiOAuthService.start(c, userContext.getUserId(c));
	if (!data.authorizationUrl) {
		return c.json(result.ok(data), 503);
	}
	return c.redirect(data.authorizationUrl, 302);
});

function acceptsJson(c) {
	return String(c.req.header('accept') || '').toLowerCase().includes('application/json')
		|| String(c.req.header('x-requested-with') || '').toLowerCase() === 'xmlhttprequest';
}

app.get('/google/mail/oauth/start', async c => {
	const data = await geminiOAuthService.startGoogleMailbox(c, userContext.getUserId(c), c.req.query());
	if (!data.authorizationUrl) {
		return c.json(result.ok(data), 503);
	}
	if (acceptsJson(c)) {
		return c.json(result.ok(data));
	}
	return c.redirect(data.authorizationUrl, 302);
});

app.post('/v2/ai/gemini/disconnect', async c => {
	return c.json(result.ok(await geminiOAuthService.disconnect(c, userContext.getUserId(c))));
});

function oauthReturnPage({
	title,
	detail,
	status,
	provider,
	accountEmail = '',
	error = '',
	cloudmailGovernance = '',
	googleOAuthState = '',
	mailboxState = ''
}) {
	const params = new URLSearchParams({
		status,
		provider,
		accountEmail,
		error,
		cloudmailGovernance,
		googleOAuthState,
		mailboxState
	});
	const target = `glassmail://oauth-callback?${params.toString()}`;
	return new Response(
		`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="apple-itunes-app" content="app-argument=${target}">
<title>${title}</title><script>location.href=${JSON.stringify(target)};</script>
</head><body><main><h1>${title}</h1><p>${detail}</p><p><a href="${target}">Open CloudMail</a></p></main></body></html>`,
		{
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'no-store',
				'x-cloudmail-provider': provider,
				'x-cloudmail-oauth-status': status
			}
		}
	);
}

async function geminiCallbackResponse(c) {
	const oauthError = c.req.query('error');
	if (oauthError) {
		const state = c.req.query('state');
		const blocked = oauthError === 'access_denied'
			? await googleTestUserRequestService.recordAccessDenied(c, {
				state,
				oauthError,
				oauthErrorDescription: c.req.query('error_description')
			})
			: { recorded: false };
		await googleTestUserRequestService.clearOAuthState(c, state);
		return oauthReturnPage({
			title: blocked.recorded ? 'Google OAuth blocked' : 'Google authorization was not completed',
			detail: blocked.recorded
				? 'CloudMail auto approved this Gmail mailbox, but Google did not allow OAuth authorization. Return to CloudMail for the restriction details.'
				: 'CloudMail did not receive Google mailbox authorization. Return to CloudMail to try again.',
			status: 'failed',
			provider: 'google_mailbox',
			accountEmail: blocked.gmail || '',
			error: blocked.recorded ? 'google_oauth_blocked' : oauthError,
			cloudmailGovernance: blocked.cloudmailGovernance || 'auto_approved',
			googleOAuthState: blocked.googleOAuthState || 'unknown_error',
			mailboxState: blocked.mailboxState || 'not_ready'
		});
	}

	try {
		const data = await geminiOAuthService.callback(c, {
			code: c.req.query('code'),
			state: c.req.query('state')
		});
		if (data.provider === 'google_mailbox' && data.accountEmail) {
			await googleTestUserRequestService.recordOAuthSuccess(c, data.accountEmail, {
				accountId: data.accountId,
				userId: data.userId
			});
			if (data.userId && data.accountId) {
				await gmailImapService.sync(c, data.userId, { accountId: data.accountId, limit: 10 })
					.catch(error => {
						console.warn('Gmail OAuth immediate REST sync failed:', String(error?.message || error).slice(0, 160));
					});
			}
		}
		const title = data.provider === 'google_mailbox' ? 'Google mailbox connected' : 'Gemini connected';
		const detail = data.provider === 'google_mailbox'
			? 'Your Google mailbox and Gemini are ready in CloudMail.'
			: 'You can return to CloudMail.';
		return oauthReturnPage({
			title,
			detail,
			status: 'connected',
			provider: data.provider,
			accountEmail: data.accountEmail || '',
			cloudmailGovernance: data.provider === 'google_mailbox' ? 'auto_approved' : '',
			googleOAuthState: data.provider === 'google_mailbox' ? 'oauth_success' : '',
			mailboxState: data.provider === 'google_mailbox' ? 'importing' : ''
		});
	} catch (error) {
		return oauthReturnPage({
			title: 'Google authorization needs attention',
			detail: 'CloudMail could not finish Google authorization. Return to CloudMail to retry.',
			status: 'failed',
			provider: 'google_mailbox',
			error: String(error?.message || error || 'oauth_callback_failed').slice(0, 180)
		});
	}
}

app.get('/oauth/gemini/callback', geminiCallbackResponse);

app.get('/ai/oauth/gemini/callback', geminiCallbackResponse);
