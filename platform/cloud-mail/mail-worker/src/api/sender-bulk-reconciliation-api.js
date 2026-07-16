import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import service from '../service/sender-bulk-reconciliation-service';

async function assertReconciliationAuthority(c, workspaceId, actorUserId) {
  const row = await c.env.db.prepare(`SELECT 1 FROM workspace_members WHERE workspace_id=?1 AND user_id=?2 AND role IN ('OWNER','ADMIN','MAIL_ADMIN')`).bind(workspaceId, actorUserId).first();
  if (!row) throw new Error('sender_bulk_reconciliation_workspace_authority_required');
}

app.get('/v3/sender-bulk/:operationId/reconciliation-matrix', async c => {
  const actorUserId = userContext.getUserId(c);
  const workspaceId = Number(c.req.query('workspace_id'));
  await assertReconciliationAuthority(c, workspaceId, actorUserId);
  const matrix = await service.loadReconciliationMatrix(c.env, { originalOperationId: c.req.param('operationId') });
  if (matrix.some(row => Number(row.tenant_id) !== Number(actorUserId) || Number(row.workspace_id) !== workspaceId)) throw new Error('sender_bulk_reconciliation_scope_mismatch');
  return c.json(result.ok({ operation_id: c.req.param('operationId'), workspace_id: workspaceId, count: matrix.length, rows: matrix }));
});

app.post('/v3/sender-bulk/:operationId/reconciliation-records', async c => {
  const actorUserId = userContext.getUserId(c);
  const body = await c.req.json();
  const workspaceId = Number(body.workspaceId ?? body.workspace_id);
  await assertReconciliationAuthority(c, workspaceId, actorUserId);
  const matrix = await service.loadReconciliationMatrix(c.env, { originalOperationId: c.req.param('operationId') });
  const row = matrix.find(candidate => candidate.original_item_id === body.originalItemId || candidate.original_item_id === body.original_item_id);
  if (!row || Number(row.tenant_id) !== Number(actorUserId) || Number(row.workspace_id) !== workspaceId) throw new Error('sender_bulk_reconciliation_item_scope_mismatch');
  return c.json(result.ok(await service.appendReconciliationRecord(c.env, { matrixRow: row, deploymentRef: String(body.deploymentRef ?? body.deployment_ref ?? 'pending-deployment'), correctiveAttemptId: body.correctiveAttemptId ?? body.corrective_attempt_id ?? null })));
});

app.post('/v3/sender-bulk/:operationId/linked-atomic-retry', async c => {
  const actorUserId = userContext.getUserId(c);
  const body = await c.req.json();
  const workspaceId = Number(body.workspaceId ?? body.workspace_id);
  await assertReconciliationAuthority(c, workspaceId, actorUserId);
  const retry = await service.executeLinkedAtomicRetry(c.env, {
    originalOperationId: c.req.param('operationId'), workspaceId, actorUserId,
    deploymentRef: String(body.deploymentRef ?? body.deployment_ref ?? 'pending-deployment'),
    idempotencyKey: c.req.header('Idempotency-Key') || body.idempotencyKey || body.idempotency_key
  });
  return c.json(result.ok(retry));
});
