import service from '../src/service/unified-conversation-backfill-service';

export default {
 async fetch(request, env) {
 const url = new URL(request.url);
  if (url.pathname !== '/run') return new Response('not found', { status: 404 });
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit') || 10)));
  const workspaceId = Number(url.searchParams.get('workspace_id') || 0);
  if (workspaceId) {
   const scope = await env.db.prepare('SELECT tenant_id,workspace_id FROM conversation_cutover_state WHERE workspace_id=?1 AND dual_write_enabled=1').bind(workspaceId).first();
   if (!scope) return Response.json({ error: 'scope_not_found' }, { status: 404 });
   const tenantId = Number(scope.tenant_id);
   const live = await service.processIngestOutbox(env, { tenantId, workspaceId, limit });
   const run = await service.runWorkspace(env, { tenantId, workspaceId, limit });
   const mission = await service.materializeMissionProvenance(env, { tenantId, workspaceId });
   if (run.ready) run.parity = await service.parityWorkspace(env, { tenantId, workspaceId });
   return Response.json({ tenantId, workspaceId, live, run, mission });
  }
  const result = await service.monitorScheduled({ env }, { limit });
  return Response.json(result);
 }
};
