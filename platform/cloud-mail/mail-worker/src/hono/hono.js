import { Hono } from 'hono';
const app = new Hono();

import result from '../model/result';
import { cors } from 'hono/cors';

app.use('*', cors({
	// Never reflect arbitrary origins for a credentialed mailbox API. The
	// deployment can explicitly list SPA origins; same-origin requests need no
	// CORS header and remain unaffected.
	origin: (origin, c) => {
		if (!origin) return origin;
		const configured = String(c.env.CORS_ALLOWED_ORIGINS || '')
			.split(/[\s,]+/)
			.map(value => value.trim())
			.filter(Boolean);
		const sameOrigin = new URL(c.req.url).origin;
		return configured.includes(origin) || origin === sameOrigin ? origin : null;
	},
	allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	credentials: true,
	maxAge: 600
}));

app.onError((err, c) => {
	if (err.name === 'BizError') {
		console.warn(err.message);
	} else {
		console.error(err);
	}

	if (err.message === `Cannot read properties of undefined (reading 'get')`) {
		return c.json(result.fail('KV数据库未绑定 KV database not bound',502));
	}

	if (err.message === `Cannot read properties of undefined (reading 'put')`) {
		return c.json(result.fail('KV数据库未绑定 KV database not bound',502));
	}

	if (err.message === `Cannot read properties of undefined (reading 'prepare')`) {
		return c.json(result.fail('D1数据库未绑定 D1 database not bound',502));
	}

	let code = 500;
	if (typeof err.code === 'number') {
		code = err.code;
	} else if (err.code && !isNaN(Number(err.code))) {
		code = Number(err.code);
	} else if (err.name === 'BizError') {
		code = 500;
	}
	return c.json(result.fail(err.message, code));
});

export default app;
