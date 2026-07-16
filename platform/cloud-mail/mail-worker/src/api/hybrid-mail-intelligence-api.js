import app from '../hono/hono'; import result from '../model/result'; import userContext from '../security/user-context'; import service from '../service/hybrid-mail-intelligence-service';
app.post('/v3/mail/local-evidence',async c=>{const body=await c.req.json();const data=await service.submit(c,{...body,actorUserId:userContext.getUserId(c)});return c.json(result.ok(data));});
