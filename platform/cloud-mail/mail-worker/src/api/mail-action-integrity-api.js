import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import service from '../service/mail-action-integrity-service';
app.put('/v3/mail/state',async c=>{const body=await c.req.json();const data=await service.mutate(c,{...body,workspaceId:body.workspaceId??body.workspace_id,expectedVersion:body.expectedVersion??body.expected_version,actorUserId:userContext.getUserId(c),idempotencyKey:c.req.header('Idempotency-Key')||body.idempotencyKey||body.idempotency_key,sourceSurface:body.sourceSurface||body.source_surface||'unknown'});return c.json(result.ok(data));});
app.get('/v3/mail/state',async c=>{const q=c.req.query();const data=await service.canonicalState(c,{actorUserId:userContext.getUserId(c),workspaceId:Number(q.workspace_id),accountId:Number(q.account_id),messageId:Number(q.message_id)});return c.json(result.ok(data));});
