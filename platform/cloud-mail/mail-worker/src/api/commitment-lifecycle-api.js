import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import service from '../service/commitment-lifecycle-service';
const json=c=>c.req.json().catch(()=>({}));
app.post('/v3/commitments/:id/verifications',async c=>{const body=await json(c),tenantId=userContext.getUserId(c);const data=await service.createVerification(c,{...body,commitmentId:c.req.param('id'),tenantId});return c.json(result.ok(data));});
app.post('/v3/commitments/:id/transition',async c=>{const body=await json(c),tenantId=userContext.getUserId(c);const data=await service.transition(c,{...body,commitmentId:c.req.param('id'),tenantId});return c.json(result.ok(data));});
app.post('/v3/commitments/:id/deadlines',async c=>{const body=await json(c),tenantId=userContext.getUserId(c);const data=await service.recordDeadline(c,{...body,commitmentId:c.req.param('id'),tenantId,hash:async value=>{const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value||'')));return [...new Uint8Array(raw)].map(v=>v.toString(16).padStart(2,'0')).join('');}});return c.json(result.ok(data));});
