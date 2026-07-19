// NEXORA Mission Runtime operational visibility (Required Output #11). Read-only; scoped to
// the authenticated user's tenant. Never writes mission_runtime_* state, never returns
// credentials. See src/service/mission-runtime-status-service.js.
import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import missionRuntimeStatusService from '../service/mission-runtime-status-service';

app.get('/v3/mission-runtime/missions/:missionId', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const data = await missionRuntimeStatusService.missionStatus(c, { tenantId, workspaceId: Number(q.workspace_id) }, c.req.param('missionId'));
	return c.json(result.ok(data));
});

app.get('/v3/mission-runtime/missions', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const data = await missionRuntimeStatusService.listMissions(c, { tenantId, workspaceId: Number(q.workspace_id) }, { state: q.state || null, limit: Number(q.limit || 25) });
	return c.json(result.ok(data));
});

app.get('/v3/mission-runtime/evidence-delivery', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const data = await missionRuntimeStatusService.evidenceDeliveryStatus(c, { tenantId, workspaceId: Number(q.workspace_id) }, { outboxId: q.outbox_id || null, missionId: q.mission_id || null, limit: Number(q.limit || 25) });
	return c.json(result.ok(data));
});

export default app;
