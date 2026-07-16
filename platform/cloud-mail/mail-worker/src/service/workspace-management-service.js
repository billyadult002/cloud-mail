import BizError from '../error/biz-error';
import { safeMetadata } from './cloudmail-v2-service';

const PERMISSIONS = {
 OWNER: ['domain:read','domain:write','dns:read','dns:write','routing:read','routing:write','mailbox:provision','alias:manage','security:manage','calendar:manage','provider_grant:manage','audit:read'],
 ADMIN: ['domain:read','domain:write','dns:read','dns:write','routing:read','routing:write','mailbox:provision','alias:manage','security:manage','calendar:manage','provider_grant:manage','audit:read'],
 SECURITY_ADMIN: ['domain:read','dns:read','security:manage','audit:read'], MAIL_ADMIN: ['domain:read','routing:read','routing:write','mailbox:provision','alias:manage'],
 VIEWER: ['domain:read','dns:read','routing:read','audit:read'], SUPPORT: ['domain:read','routing:read']
};
const email = value => String(value || '').trim().toLowerCase();
const domainOf = value => email(value).split('@')[1] || '';
const localOf = value => email(value).split('@')[0] || '';
function slug(value) { return String(value || 'workspace').replace(/[^a-z0-9]+/ig, '-').replace(/^-|-$/g, '').toLowerCase(); }

async function ensureDefault(c) {
 const user = c.get('user'); const tenant = `user:${user.userId}`; const name = `${String(user.email || 'NEXORA').split('@')[0]} Workspace`;
 await c.env.db.prepare(`INSERT INTO workspaces (tenant_key,display_name,created_by_user_id) VALUES (?1,?2,?3) ON CONFLICT(tenant_key,display_name) DO NOTHING`).bind(tenant,name,user.userId).run();
 const workspace = await c.env.db.prepare(`SELECT id,display_name FROM workspaces WHERE tenant_key=?1 AND display_name=?2`).bind(tenant,name).first();
 await c.env.db.prepare(`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES (?1,?2,'OWNER') ON CONFLICT(workspace_id,user_id) DO NOTHING`).bind(workspace.id,user.userId).run();
 // One-way compatibility projection: legacy domain and account records become workspace-scoped; no legacy record is deleted.
 await c.env.db.prepare(`INSERT INTO workspace_domains (workspace_id,domain,provider,authority_state,lifecycle_state,health_state)
   SELECT ?1, lower(domain), provider, authority_state, lifecycle_state,
          CASE WHEN lifecycle_state='READY' THEN 'HEALTHY' WHEN lifecycle_state='BLOCKED' THEN 'BLOCKED' ELSE 'NEEDS_ATTENTION' END
     FROM nexora_domain_connections WHERE user_id=?2
   ON CONFLICT(domain) DO NOTHING`).bind(workspace.id,user.userId).run();
 await c.env.db.prepare(`INSERT INTO workspace_identities (workspace_id,local_part,domain_id,lifecycle_state)
   SELECT ?1, lower(substr(a.email,1,instr(a.email,'@')-1)), wd.id,
          CASE WHEN a.status='active' THEN 'READY' ELSE 'DISCOVERED' END
     FROM account a JOIN workspace_domains wd ON lower(substr(a.email,instr(a.email,'@')+1))=lower(wd.domain)
    WHERE a.user_id=?2 AND a.is_del=0
   ON CONFLICT(workspace_id,local_part,domain_id) DO NOTHING`).bind(workspace.id,user.userId).run();
 // Public provider domains are not tenant-owned domains. Bind each account
 // directly to its owner workspace so provider-agnostic mail actions remain
 // available without inventing domain authority.
 await c.env.db.prepare(`INSERT INTO workspace_account_bindings (workspace_id,account_id,owner_user_id,subject_user_id,lifecycle_state)
   SELECT ?1,a.account_id,a.user_id,?2,CASE WHEN a.is_del=0 THEN 'READY' ELSE 'REVOKED' END
     FROM account a
    WHERE a.user_id=?2 OR EXISTS(SELECT 1 FROM mailbox_authorizations ma WHERE ma.grantee_user_id=?2 AND ma.owner_user_id=a.user_id AND ma.owner_account_id=a.account_id AND ma.status='active' AND ma.revoked_at IS NULL)
   ON CONFLICT(workspace_id,account_id) DO UPDATE SET subject_user_id=excluded.subject_user_id,lifecycle_state=excluded.lifecycle_state,updated_at=CURRENT_TIMESTAMP`).bind(workspace.id,user.userId).run();
 return workspace;
}
async function member(c, workspaceId, permission) {
 const user = c.get('user'); const row = await c.env.db.prepare(`SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2`).bind(workspaceId,user.userId).first();
 if (!row || !(PERMISSIONS[row.role] || []).includes(permission)) throw new BizError('Workspace permission denied.',403); return row;
}
async function audit(c, workspaceId, action, objectType, objectRef, before = {}, after = {}) {
 const user = c.get('user'); await c.env.db.prepare(`INSERT INTO workspace_audit_events (workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`).bind(workspaceId,user.userId,action,objectType,objectRef,JSON.stringify(safeMetadata(before)),JSON.stringify(safeMetadata(after)),c.req.header('cf-ray') || null).run();
}
async function resolve(c) {
 const defaultWorkspace = await ensureDefault(c); const user = c.get('user');
 const workspaces = await c.env.db.prepare(`SELECT w.id,w.display_name,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=?1 ORDER BY w.id`).bind(user.userId).all();
 return { default_workspace_id: defaultWorkspace.id, workspaces: (workspaces.results || []).map(w => ({ ...w, capabilities: PERMISSIONS[w.role] || [] })) };
}
async function addDomain(c, body) {
 const workspaceId = Number(body.workspace_id); await member(c,workspaceId,'domain:write'); const domain = domainOf(`x@${body.domain}`); if (!domain || !domain.includes('.')) throw new BizError('A valid custom domain is required.',400);
 const existing = await c.env.db.prepare(`SELECT workspace_id FROM workspace_domains WHERE lower(domain)=lower(?1)`).bind(domain).first(); if (existing && Number(existing.workspace_id)!==workspaceId) throw new BizError('Domain belongs to another workspace.',409);
 await c.env.db.prepare(`INSERT INTO workspace_domains (workspace_id,domain,provider,authority_state,lifecycle_state) VALUES (?1,?2,?3,'AUTHORITY_REQUIRED','DISCOVERED') ON CONFLICT(domain) DO UPDATE SET provider=excluded.provider,updated_at=CURRENT_TIMESTAMP`).bind(workspaceId,domain,String(body.provider || 'custom')).run();
 const row = await c.env.db.prepare(`SELECT * FROM workspace_domains WHERE lower(domain)=lower(?1)`).bind(domain).first(); await audit(c,workspaceId,'domain_added','domain',domain,{},row); return row;
}
async function commandCenter(c, workspaceId) {
 await member(c,workspaceId,'domain:read'); const q = async sql => (await c.env.db.prepare(sql).bind(workspaceId).all()).results || [];
 return { workspace: await c.env.db.prepare(`SELECT id,display_name FROM workspaces WHERE id=?1`).bind(workspaceId).first(), domains: await q(`SELECT * FROM workspace_domains WHERE workspace_id=?1`), identities: await q(`SELECT wi.*,wd.domain FROM workspace_identities wi JOIN workspace_domains wd ON wd.id=wi.domain_id WHERE wi.workspace_id=?1`), mailboxes: await q(`SELECT * FROM workspace_mailboxes WHERE workspace_id=?1`), aliases: await q(`SELECT * FROM workspace_aliases WHERE workspace_id=?1`), provider_grants: await q(`SELECT id,provider,authority_state,expires_at FROM workspace_provider_grants WHERE workspace_id=?1`), provisioning: await q(`SELECT id,job_type,state,blocker_code FROM workspace_provisioning_jobs WHERE workspace_id=?1`), audit: await q(`SELECT action,object_type,object_ref,request_id,created_at FROM workspace_audit_events WHERE workspace_id=?1 ORDER BY id DESC LIMIT 50`) };
}
export default { PERMISSIONS, resolve, addDomain, commandCenter, async assertMailboxWorkspace(c, address) { const d=domainOf(address); const row=await c.env.db.prepare(`SELECT workspace_id FROM workspace_domains WHERE lower(domain)=lower(?1)`).bind(d).first(); if(!row) throw new BizError('Custom domain is not attached to a workspace.',409); await member(c,row.workspace_id,'mailbox:provision'); return row.workspace_id; } };
