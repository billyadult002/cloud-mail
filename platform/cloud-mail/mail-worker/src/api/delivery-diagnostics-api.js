import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import BizError from '../error/biz-error';
import deliveryLedgerQueryService from '../service/delivery-ledger-query-service';

function adminScope(c) {
	const user = c.get('user');
	if (user.email !== c.env.admin) throw new BizError('Unauthorized', 403);
	return { admin: true, userId: userContext.getUserId(c) };
}

app.get('/v2/admin/delivery/events', async c => {
	const scope = adminScope(c);
	const outboundId = c.req.query('outboundId');
	const provider = c.req.query('provider');
	const providerMessageId = c.req.query('providerMessageId');
	if (outboundId) {
		return c.json(result.ok(await deliveryLedgerQueryService.timelineByOutboundId(c, outboundId, scope, c.req.query())));
	}
	if (provider && providerMessageId) {
		return c.json(result.ok(await deliveryLedgerQueryService.timelineByProviderMessage(
			c,
			provider,
			providerMessageId,
			scope,
			c.req.query()
		)));
	}
	return c.json(result.fail('outboundId or provider/providerMessageId is required', 400));
});

app.get('/v2/admin/delivery/summary', async c => {
	return c.json(result.ok(await deliveryLedgerQueryService.summaryByWindow(c, adminScope(c), c.req.query())));
});

app.get('/v2/admin/delivery/retry-backlog', async c => {
	return c.json(result.ok(await deliveryLedgerQueryService.retryBacklog(c, adminScope(c), c.req.query())));
});

app.get('/v2/admin/delivery/failure-rollup', async c => {
	return c.json(result.ok(await deliveryLedgerQueryService.failureRollup(c, adminScope(c), c.req.query())));
});
