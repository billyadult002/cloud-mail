import app from '../hono/hono';
import { dbInit } from '../init/init';
import secureStagingBootstrapService from '../service/nexora-secure-staging-bootstrap-service';

const securityHeaders = {
	'Cache-Control': 'private, no-store, max-age=0',
	'Referrer-Policy': 'no-referrer',
	'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
	'X-Content-Type-Options': 'nosniff',
};

app.get('/init/secure', (c) => {
	if (!secureStagingBootstrapService.isStaging(c.env)) return c.text('Not Found', 404, securityHeaders);
	return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Secure staging bootstrap</title></head><body><main><h1>Secure staging bootstrap</h1><form method="post" action="/api/init/secure"><label>One-time bootstrap secret <input type="password" name="bootstrap_secret" required autocomplete="off"></label><button type="submit">Initialize staging configuration</button></form><form method="post" action="/api/init/secure/complete-authority"><label>One-time bootstrap secret <input type="password" name="bootstrap_secret" required autocomplete="off"></label><button type="submit">Verify and finalize first authority</button></form></main></body></html>`, 200, securityHeaders);
});

app.post('/init/secure/complete-authority', async (c) => {
	let secret = '';
	try {
		const contentType = c.req.header('content-type') || '';
		secret = contentType.includes('application/json')
			? (await c.req.json()).bootstrap_secret
			: (await c.req.parseBody()).bootstrap_secret;
	} catch {
		return c.json({ error: 'INVALID_REQUEST' }, 400, securityHeaders);
	}
	const outcome = await secureStagingBootstrapService.completeFirstAuthority(c, secret);
	return c.json(outcome.body, outcome.status, securityHeaders);
});

app.post('/init/secure', async (c) => {
	let secret = '';
	try {
		const contentType = c.req.header('content-type') || '';
		if (contentType.includes('application/json')) {
			secret = (await c.req.json()).bootstrap_secret;
		} else {
			secret = (await c.req.parseBody()).bootstrap_secret;
		}
	} catch {
		return c.json({ error: 'INVALID_REQUEST' }, 400, securityHeaders);
	}
	const outcome = await secureStagingBootstrapService.execute(c, secret);
	return c.json(outcome.body, outcome.status, securityHeaders);
});

app.get('/init/:secret', (c) => {
	if (secureStagingBootstrapService.isStaging(c.env)) {
		return c.json({ error: 'LEGACY_INITIALIZER_DISABLED' }, 404, securityHeaders);
	}
	return dbInit.init(c);
});
