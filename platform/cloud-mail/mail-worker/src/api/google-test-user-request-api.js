import app from '../hono/hono';
import result from '../model/result';
import googleTestUserRequestService from '../service/google-test-user-request-service';

const SENSITIVE_EXPORT_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, proxy-revalidate';

app.get('/v2/admin/google-test-user-requests', async c => {
	const data = await googleTestUserRequestService.list(c, c.req.query());
	return c.json(result.ok(data));
});

app.post('/v2/google-test-user-requests/request', async c => {
	const body = await c.req.json().catch(() => ({}));
	const data = await googleTestUserRequestService.requestAccess(c, body);
	return c.json(result.ok(data));
});

app.get('/v2/admin/google-test-user-requests/dashboard', async c => {
	const data = await googleTestUserRequestService.dashboard(c);
	return c.json(result.ok(data));
});

app.post('/v2/admin/google-test-user-requests/approve-all', async c => {
	const data = await googleTestUserRequestService.approveAll(c);
	return c.json(result.ok(data));
});

app.post('/v2/admin/google-test-user-requests/status', async c => {
	const body = await c.req.json();
	const data = await googleTestUserRequestService.updateStatus(c, body.ids, body.status, body.notes);
	return c.json(result.ok(data));
});

app.post('/v2/admin/google-test-user-requests/google-synced', async c => {
	const body = await c.req.json();
	const data = await googleTestUserRequestService.markGoogleSynced(c, body.ids, body);
	return c.json(result.ok(data));
});

app.get('/v2/admin/google-test-user-requests/gmail-list', async c => {
	const data = await googleTestUserRequestService.gmailList(c, c.req.query());
	return c.json(result.ok({ gmail: data, text: data.join('\n') }));
});

app.get('/v2/admin/google-test-user-requests/report.md', async c => {
	const markdown = await googleTestUserRequestService.markdownReport(c, c.req.query());
	return new Response(markdown, {
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'cache-control': SENSITIVE_EXPORT_CACHE_CONTROL,
			'x-content-type-options': 'nosniff'
		}
	});
});

app.get('/v2/admin/google-test-user-requests/export.csv', async c => {
	const csv = await googleTestUserRequestService.csv(c, c.req.query());
	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': 'attachment; filename="cloudmail-google-test-user-requests.csv"',
			'cache-control': SENSITIVE_EXPORT_CACHE_CONTROL,
			'x-content-type-options': 'nosniff'
		}
	});
});
