import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import service from '../service/unified-conversation-service';

app.get('/v3/conversation-projections',async c=>{
 const q=c.req.query(),tenantId=userContext.getUserId(c);
 const data=await service.listProjections(c,{tenantId,workspaceId:Number(q.workspace_id),surface:q.surface||'all_mail',category:q.category||null,query:q.query||'',cursor:q.cursor||null,size:Number(q.size||50)});
 c.header('X-NEXORA-Conversation-Projection-Authority',data.authority_mode);
 c.header('X-NEXORA-Conversation-Cutover-Epoch',String(data.cutover_epoch));
 return c.json(result.ok(data));
});
app.get('/v3/conversation-projections/:conversationId',async c=>{const tenantId=userContext.getUserId(c),q=c.req.query();return c.json(result.ok(await service.projectionDetail(c,{tenantId,workspaceId:Number(q.workspace_id),conversationId:c.req.param('conversationId')})));});

export default app;
