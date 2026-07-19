import BizError from '../error/biz-error.js';

const MEMBERSHIP_SCOPES = new Set(['workspace_visibility','account_state_visibility']);
const DELEGATION_SCOPES = new Set(['account_state_visibility','metadata_read']);
const ADMIN_ROLES = new Set(['OWNER','ADMIN']);
const uuid = () => crypto.randomUUID();
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
async function digest(value) { const data = new TextEncoder().encode(typeof value === 'string' ? value : stable(value)); const raw = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(raw)].map(v => v.toString(16).padStart(2,'0')).join(''); }
function scopes(value, allowed) { const list = [...new Set((Array.isArray(value) ? value : []).map(String))].sort(); if (!list.length || list.some(v => !allowed.has(v))) throw new BizError('Authority scope is invalid or exceeds P0.',400); return list; }
async function context(c, workspaceId, permission = 'admin') {
	const actor = c.get('user'); const workspace = await c.env.db.prepare('SELECT id,tenant_key FROM workspaces WHERE id=?1').bind(workspaceId).first();
	const membership = await c.env.db.prepare('SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2').bind(workspaceId,actor.userId).first();
	if (!workspace || (permission !== 'subject' && !membership) || (permission === 'admin' && !ADMIN_ROLES.has(membership.role))) throw new BizError('Workspace authority denied.',403);
	return { actor, workspace, membership };
}
async function sameTenant(c, tenantKey, userId) {
	if (tenantKey === `user:${userId}`) return true;
	if (tenantKey.startsWith('user:')) return false;
	const row = await c.env.db.prepare(`SELECT 1 AS ok FROM tenants t JOIN org_memberships om ON om.tenant_id=t.id WHERE t.tenant_key=?1 AND om.user_id=?2 LIMIT 1`).bind(tenantKey,userId).first(); return Boolean(row);
}
async function event(c, ctx, values) {
	await c.env.db.prepare(`INSERT INTO workspace_authority_events(id,tenant_key,workspace_id,actor_user_id,subject_user_id,account_id,relationship_type,relationship_id,event_type,state,scope_hash,authority_generation,reason_code,request_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`).bind(uuid(),ctx.workspace.tenant_key,ctx.workspace.id,ctx.actor.userId,values.subjectId||null,values.accountId||null,values.type,values.id,values.event,values.state,values.scopeHash,values.generation||0,values.reason,c.req.header('cf-ray')||null).run();
}
async function createInvitation(c, body) {
	const workspaceId=Number(body.workspace_id), subjectId=Number(body.subject_user_id); const ctx=await context(c,workspaceId); if (!await sameTenant(c,ctx.workspace.tenant_key,subjectId)) throw new BizError('Cross-tenant membership is prohibited.',403);
	const scope=scopes(body.scope,MEMBERSHIP_SCOPES), id=uuid(), token=uuid(), tokenHash=await digest(token), expiresAt=body.expires_at;
	if (!expiresAt || Date.parse(expiresAt)<=Date.now()) throw new BizError('A future expiry is required.',400);
	await c.env.db.prepare(`INSERT INTO workspace_membership_invitations(id,tenant_key,workspace_id,requester_user_id,subject_user_id,role,scope_json,reason,token_hash,state,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending_review',?10)`).bind(id,ctx.workspace.tenant_key,workspaceId,ctx.actor.userId,subjectId,String(body.role||'VIEWER'),JSON.stringify(scope),String(body.reason||'').slice(0,240),tokenHash,expiresAt).run();
	await event(c,ctx,{subjectId,type:'membership_invitation',id,event:'requested',state:'pending_review',scopeHash:await digest(scope),reason:'membership_requested'}); return { id, state:'pending_review', acceptance_token:token, expires_at:expiresAt };
}
async function reviewInvitation(c, id, approve) {
	const row=await c.env.db.prepare('SELECT * FROM workspace_membership_invitations WHERE id=?1').bind(id).first(); if(!row) throw new BizError('Invitation not found.',404); const ctx=await context(c,row.workspace_id);
	const state=approve?'approved':'rejected'; const changed=await c.env.db.prepare(`UPDATE workspace_membership_invitations SET state=?2,approved_by_user_id=?3,issued_at=CASE WHEN ?2='approved' THEN CURRENT_TIMESTAMP ELSE issued_at END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='pending_review' AND expires_at>CURRENT_TIMESTAMP`).bind(id,state,ctx.actor.userId).run(); if(!changed.meta?.changes) throw new BizError('Invitation review conflict.',409);
	await event(c,ctx,{subjectId:row.subject_user_id,type:'membership_invitation',id,event:state,state,scopeHash:await digest(JSON.parse(row.scope_json)),reason:`membership_${state}`}); return {id,state};
}
async function acceptInvitation(c, body) {
	const actor=c.get('user'), tokenHash=await digest(String(body.acceptance_token||'')); const row=await c.env.db.prepare(`SELECT * FROM workspace_membership_invitations WHERE token_hash=?1`).bind(tokenHash).first(); if(!row||Number(row.subject_user_id)!==Number(actor.userId)) throw new BizError('Invitation acceptance denied.',403);
	const ctx=await context(c,row.workspace_id,'subject'); if (ctx.workspace.tenant_key!==row.tenant_key || !await sameTenant(c,row.tenant_key,actor.userId)) throw new BizError('Cross-tenant membership is prohibited.',403);
	if(row.state==='accepted') return {id:row.id,state:'accepted',idempotent:true}; if(row.state!=='approved'||Date.parse(row.expires_at)<=Date.now()) throw new BizError('Invitation is not active.',409);
	const generation=Number((await c.env.db.prepare('SELECT MAX(authority_generation) AS g FROM workspace_membership_authorities WHERE workspace_id=?1 AND subject_user_id=?2').bind(row.workspace_id,actor.userId).first())?.g||0)+1, authorityId=uuid();
	await c.env.db.batch([
		c.env.db.prepare(`UPDATE workspace_membership_invitations SET state='accepted',accepted_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='approved'`).bind(row.id),
		c.env.db.prepare(`INSERT INTO workspace_membership_authorities(id,tenant_key,workspace_id,subject_user_id,granting_user_id,invitation_id,role,scope_json,state,authority_generation,activated_at,expires_at,reason) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'active',?9,CURRENT_TIMESTAMP,?10,?11)`).bind(authorityId,row.tenant_key,row.workspace_id,actor.userId,row.approved_by_user_id,row.id,row.role,row.scope_json,generation,row.expires_at,row.reason),
		c.env.db.prepare(`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?1,?2,?3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,updated_at=CURRENT_TIMESTAMP`).bind(row.workspace_id,actor.userId,row.role)
	]);
	await event(c,ctx,{subjectId:actor.userId,type:'membership',id:authorityId,event:'activated',state:'active',scopeHash:await digest(JSON.parse(row.scope_json)),generation,reason:'invitation_accepted'}); return {id:authorityId,state:'active',authority_generation:generation};
}
async function createDelegation(c, body) {
	const workspaceId=Number(body.workspace_id), accountId=Number(body.account_id), subjectId=Number(body.subject_user_id); const ctx=await context(c,workspaceId); if(!await sameTenant(c,ctx.workspace.tenant_key,subjectId)) throw new BizError('Cross-tenant delegation is prohibited.',403);
	const account=await c.env.db.prepare('SELECT user_id FROM account WHERE account_id=?1 AND is_del=0').bind(accountId).first(); if(!account||!await sameTenant(c,ctx.workspace.tenant_key,account.user_id)) throw new BizError('Account is outside the Workspace tenant.',403);
	const scope=scopes(body.scope,DELEGATION_SCOPES), id=uuid(); if(!body.expires_at||Date.parse(body.expires_at)<=Date.now()) throw new BizError('A future expiry is required.',400);
	await c.env.db.prepare(`INSERT INTO workspace_account_delegations(id,tenant_key,workspace_id,account_id,owner_user_id,subject_user_id,requester_user_id,scope_json,reason,state,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending_owner_consent',?10)`).bind(id,ctx.workspace.tenant_key,workspaceId,accountId,account.user_id,subjectId,ctx.actor.userId,JSON.stringify(scope),String(body.reason||'').slice(0,240),body.expires_at).run();
	await event(c,ctx,{subjectId,accountId,type:'account_delegation',id,event:'requested',state:'pending_owner_consent',scopeHash:await digest(scope),generation:1,reason:'delegation_requested'}); return {id,state:'pending_owner_consent'};
}
async function ownerConsent(c,id,approve) {
	const actor=c.get('user'), row=await c.env.db.prepare('SELECT * FROM workspace_account_delegations WHERE id=?1').bind(id).first(); if(!row||Number(row.owner_user_id)!==Number(actor.userId)) throw new BizError('Only the account owner may consent.',403); const ctx=await context(c,row.workspace_id,'subject'); if(!await sameTenant(c,ctx.workspace.tenant_key,actor.userId)) throw new BizError('Cross-tenant owner consent is prohibited.',403); const state=approve?'pending_approval':'rejected';
	const changed=await c.env.db.prepare(`UPDATE workspace_account_delegations SET state=?2,owner_consent_at=CASE WHEN ?2='pending_approval' THEN CURRENT_TIMESTAMP ELSE owner_consent_at END,owner_consent_by_user_id=?3,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='pending_owner_consent' AND expires_at>CURRENT_TIMESTAMP`).bind(id,state,actor.userId).run(); if(!changed.meta?.changes) throw new BizError('Owner consent conflict.',409);
	await event(c,ctx,{subjectId:row.subject_user_id,accountId:row.account_id,type:'account_delegation',id,event:approve?'owner_consented':'owner_denied',state,scopeHash:await digest(JSON.parse(row.scope_json)),generation:row.authority_generation,reason:approve?'owner_consented':'owner_denied'}); return{id,state};
}
async function approveDelegation(c,id,approve) {
	const row=await c.env.db.prepare('SELECT * FROM workspace_account_delegations WHERE id=?1').bind(id).first(); if(!row) throw new BizError('Delegation not found.',404); const ctx=await context(c,row.workspace_id); if(Number(ctx.actor.userId)===Number(row.requester_user_id)) throw new BizError('Requester cannot approve delegation.',403);
	const state=approve?'active':'rejected', changed=await c.env.db.prepare(`UPDATE workspace_account_delegations SET state=?2,approved_at=CASE WHEN ?2='active' THEN CURRENT_TIMESTAMP ELSE approved_at END,approved_by_user_id=?3,activated_at=CASE WHEN ?2='active' THEN CURRENT_TIMESTAMP ELSE activated_at END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='pending_approval' AND owner_consent_at IS NOT NULL AND expires_at>CURRENT_TIMESTAMP`).bind(id,state,ctx.actor.userId).run(); if(!changed.meta?.changes) throw new BizError('Delegation approval conflict.',409);
	await event(c,ctx,{subjectId:row.subject_user_id,accountId:row.account_id,type:'account_delegation',id,event:state==='active'?'activated':'rejected',state,scopeHash:await digest(JSON.parse(row.scope_json)),generation:row.authority_generation,reason:`delegation_${state}`}); return{id,state,authority_generation:row.authority_generation};
}
async function transition(c,type,id,action) {
	if(!['membership','delegation'].includes(type)) throw new BizError('Invalid authority type.',400);
	const table=type==='membership'?'workspace_membership_authorities':'workspace_account_delegations', row=await c.env.db.prepare(`SELECT * FROM ${table} WHERE id=?1`).bind(id).first(); if(!row) throw new BizError('Authority not found.',404); const ctx=await context(c,row.workspace_id); if(type==='delegation'&&action==='revoke'&&Number(ctx.actor.userId)!==Number(row.owner_user_id)&&!ADMIN_ROLES.has(ctx.membership.role)) throw new BizError('Revocation denied.',403);
	const state={suspend:'suspended',resume:'active',revoke:'revoked'}[action]; if(!state) throw new BizError('Invalid authority transition.',400); const generation=Number(row.authority_generation)+1;
	const expected={suspend:'active',resume:'suspended',revoke:['active','suspended']}[action]; if(!(Array.isArray(expected)?expected.includes(row.state):row.state===expected)) throw new BizError('Authority transition conflict.',409);
	const changed=await c.env.db.prepare(`UPDATE ${table} SET state=?2,authority_generation=?3,suspended_at=CASE WHEN ?2='suspended' THEN CURRENT_TIMESTAMP ELSE suspended_at END,revoked_at=CASE WHEN ?2='revoked' THEN CURRENT_TIMESTAMP ELSE revoked_at END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state=?4`).bind(id,state,generation,row.state).run(); if(!changed.meta?.changes) throw new BizError('Authority transition conflict.',409);
	if(type==='membership'&&state==='revoked') await c.env.db.prepare('DELETE FROM workspace_members WHERE workspace_id=?1 AND user_id=?2').bind(row.workspace_id,row.subject_user_id).run();
	await event(c,ctx,{subjectId:row.subject_user_id,accountId:row.account_id,type,id,event:action,state,scopeHash:await digest(JSON.parse(row.scope_json)),generation,reason:`authority_${action}`}); return{id,state,authority_generation:generation};
}
function evaluateRuntimeAuthority({ membership, ownerUserId, actingUserId, delegation, capability, now = Date.now() }) {
	if (!membership) return { allowed:false, reason:'workspace_membership_missing' };
	if (Number(ownerUserId)===Number(actingUserId)) return { allowed:true, reason:'account_owner', authorityGeneration:0 };
	if (membership.state!=='active' || (membership.expires_at && Date.parse(membership.expires_at)<=now)) return { allowed:false, reason:'authoritative_membership_inactive' };
	if (!delegation) return { allowed:false, reason:'account_delegation_missing' };
	if (delegation.state!=='active' || !delegation.owner_consent_at || !delegation.approved_at || Date.parse(delegation.expires_at)<=now) return { allowed:false, reason:'account_delegation_inactive' };
	if (!(Array.isArray(delegation.scope) ? delegation.scope : JSON.parse(delegation.scope_json||'[]')).includes(capability)) return { allowed:false, reason:'delegation_scope_mismatch' };
	return { allowed:true, reason:'active_delegation', authorityGeneration:Number(delegation.authority_generation), delegationId:delegation.id };
}
async function resolveAccountAuthority(c,{workspaceId,actingUserId,accountId,capability}) {
	const workspace=await c.env.db.prepare('SELECT tenant_key FROM workspaces WHERE id=?1').bind(workspaceId).first(), account=await c.env.db.prepare('SELECT user_id FROM account WHERE account_id=?1 AND is_del=0').bind(accountId).first(); if(!workspace||!account) return{allowed:false,reason:'authority_subject_not_found'};
	if(!await sameTenant(c,workspace.tenant_key,actingUserId)||!await sameTenant(c,workspace.tenant_key,account.user_id)) return{allowed:false,reason:'cross_tenant_authority_denied'};
	const legacy=await c.env.db.prepare('SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2').bind(workspaceId,actingUserId).first(); if(!legacy) return{allowed:false,reason:'workspace_membership_missing'};
	if(Number(account.user_id)===Number(actingUserId)) return{allowed:true,reason:'account_owner',ownerUserId:account.user_id,authorityGeneration:0};
	const membership=await c.env.db.prepare(`SELECT state,expires_at,authority_generation FROM workspace_membership_authorities WHERE workspace_id=?1 AND subject_user_id=?2 AND tenant_key=?3 ORDER BY authority_generation DESC LIMIT 1`).bind(workspaceId,actingUserId,workspace.tenant_key).first(); if(!membership) return{allowed:false,reason:'authoritative_membership_missing'};
	const delegation=await c.env.db.prepare(`SELECT * FROM workspace_account_delegations WHERE workspace_id=?1 AND account_id=?2 AND subject_user_id=?3 AND owner_user_id=?4 AND tenant_key=?5 ORDER BY authority_generation DESC LIMIT 1`).bind(workspaceId,accountId,actingUserId,account.user_id,workspace.tenant_key).first();
	return { ...evaluateRuntimeAuthority({ membership, ownerUserId:account.user_id, actingUserId, delegation, capability }), ownerUserId:account.user_id };
}
async function list(c,workspaceId){const ctx=await context(c,workspaceId); const invitations=await c.env.db.prepare('SELECT id,subject_user_id,role,scope_json,state,expires_at,created_at FROM workspace_membership_invitations WHERE workspace_id=?1 ORDER BY created_at DESC').bind(workspaceId).all(), delegations=await c.env.db.prepare('SELECT id,account_id,owner_user_id,subject_user_id,scope_json,state,authority_generation,expires_at,created_at FROM workspace_account_delegations WHERE workspace_id=?1 ORDER BY created_at DESC').bind(workspaceId).all(), events=await c.env.db.prepare('SELECT id,actor_user_id,subject_user_id,account_id,relationship_type,event_type,state,authority_generation,reason_code,request_id,created_at FROM workspace_authority_events WHERE workspace_id=?1 ORDER BY created_at DESC LIMIT 100').bind(workspaceId).all(); return{workspace_id:ctx.workspace.id,invitations:invitations.results||[],delegations:delegations.results||[],audit:events.results||[]};}

export { MEMBERSHIP_SCOPES, DELEGATION_SCOPES, digest, evaluateRuntimeAuthority };
export default { createInvitation,reviewInvitation,acceptInvitation,createDelegation,ownerConsent,approveDelegation,transition,resolveAccountAuthority,list };
