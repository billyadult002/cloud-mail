import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../src/api/nexora-domain-authority-api.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/service/nexora-domain-authority-bootstrap-service.mjs', import.meta.url), 'utf8');
const ownershipSource = readFileSync(new URL('../src/service/nexora-domain-ownership-service.mjs', import.meta.url), 'utf8');
const workspaceAuthoritySource = readFileSync(new URL('../src/service/nexora-workspace-authority-service.mjs', import.meta.url), 'utf8');
const ownershipMigrationSource = readFileSync(new URL('../migrations/0078_nexora_domain_ownership_validation.sql', import.meta.url), 'utf8');
const websSource = readFileSync(new URL('../src/hono/webs.js', import.meta.url), 'utf8');

assert.ok(websSource.includes("import '../api/nexora-domain-authority-api'"), 'domain authority API must be mounted');
assert.ok(apiSource.includes("app.post('/v3/domain-authorities/bootstrap'"), 'bootstrap endpoint must exist');
assert.ok(apiSource.includes("new BizError('admin domain authority is required', 403)"), 'admin authority denials must preserve the 403 business envelope');
assert.ok(apiSource.includes("app.post('/v3/domain-ownership/dns-challenges'"), 'DNS ownership challenge endpoint must exist');
assert.ok(apiSource.includes("app.post('/v3/domain-ownership/dns-challenges/verify'"), 'DNS ownership verify endpoint must exist');
assert.ok(apiSource.includes("app.get('/v3/domain-authorities/workspace-selector'"), 'actor-scoped workspace selector must exist');
assert.ok(apiSource.includes("app.post('/v3/domain-authorities/workspace-selector/validate'"), 'workspace selection validation endpoint must exist');
assert.ok(apiSource.includes('requireWorkspaceSelectionCredential'), 'domain write endpoints must enforce the validated workspace selection credential');
assert.ok(apiSource.includes("'domain:write', { issueCredential: true }"), 'only the selector validate boundary may explicitly issue a workspace selection credential');
assert.ok(apiSource.includes('actor: actorIdentity'), 'workspace selector discovery must return safe server-resolved actor identity');
assert.ok(ownershipSource.includes('requireWorkspaceSelectionCredential'), 'DNS challenge create and verify must enforce the validated workspace selection credential');
assert.ok(apiSource.includes('requireAdmin(c);'), 'bootstrap endpoint must require admin authority');
assert.ok(apiSource.includes("user.email !== c.env.admin"), 'bootstrap endpoint must bind admin authority to configured admin identity');
assert.ok(apiSource.includes('tenant scope must match authenticated user'), 'request tenant scope must not override authenticated authority');
assert.ok(apiSource.includes('tenantId: Number(actor.userId)'), 'request tenant scope must derive from authenticated authority');
assert.ok(ownershipSource.includes('public mailbox domains cannot bootstrap authority'), 'public mailbox domains must be rejected before ownership verification');
assert.ok(ownershipSource.includes('cloudflare-dns.com/dns-query'), 'DNS TXT verification must use resolver evidence');
assert.ok(ownershipSource.includes("authority_state='VERIFIED'"), 'DNS verification must create verified workspace domain state');
assert.ok(ownershipSource.includes("assertWorkspaceCapability(c, actor, scope.workspaceId, 'domain:write')"), 'DNS ownership must require server-authoritative domain write capability');
assert.ok(ownershipSource.includes('domain is already bound to another workspace'), 'DNS verification must reject cross-workspace domain reassignment');
assert.ok(ownershipMigrationSource.includes('nexora_domain_ownership_challenges'), 'domain ownership challenge table must exist');
assert.ok(serviceSource.includes('domain bootstrap evidence is required'), 'bootstrap must require existing production evidence before verification');
assert.ok(serviceSource.includes("assertWorkspaceCapability(c, actor, scope.workspaceId, 'domain:write')"), 'bootstrap must require server-authoritative domain write capability');
assert.ok(workspaceAuthoritySource.includes('JOIN workspace_members'), 'workspace selection must derive membership server-side');
assert.ok(workspaceAuthoritySource.includes('m.user_id=?2'), 'workspace validation must bind membership to the authenticated actor');
assert.ok(workspaceAuthoritySource.includes('workspace tenant lineage does not match authenticated actor'), 'workspace validation must reject mismatched tenant lineage');
assert.ok(workspaceAuthoritySource.includes("includes('domain:write')"), 'workspace selector must expose domain activation eligibility from server role capabilities');
assert.ok(serviceSource.includes('workspace_domains'), 'bootstrap must consider workspace domain authority state');
assert.ok(serviceSource.includes('VERIFIED_WORKSPACE_DOMAIN_AUTHORITY_STATES'), 'bootstrap must require verified workspace domain authority state');
assert.ok(serviceSource.includes('cloudmail_domains'), 'bootstrap must consider CloudMail domain readiness state');
assert.ok(serviceSource.includes('workspace_account_bindings'), 'bootstrap must consider workspace account binding evidence');
assert.ok(serviceSource.includes('FROM email'), 'bootstrap must consider bodyless email aggregate evidence');
assert.ok(serviceSource.includes('supplemental'), 'mail/account/domain aggregates must remain supplemental to verified workspace ownership');
assert.ok(serviceSource.includes('INSERT INTO nexora_domain_authorities'), 'bootstrap must create the Domain authority through the product boundary');
assert.ok(serviceSource.includes('ON CONFLICT(tenant_id,workspace_id,normalized_domain)'), 'bootstrap must be idempotent by authority tuple');
assert.ok(serviceSource.includes("verification_status='verified'"), 'bootstrap must mark the authority verified');
assert.ok(serviceSource.includes('verification_evidence_ref'), 'bootstrap must persist a verification evidence reference');
assert.ok(serviceSource.includes('administrator_authority_ref'), 'bootstrap must persist administrator authority provenance');
assert.ok(serviceSource.includes('INSERT INTO nexora_audit_events'), 'bootstrap must create NEXORA audit evidence');
assert.ok(serviceSource.includes('INSERT INTO workspace_audit_events'), 'bootstrap must create workspace audit evidence');

for (const forbidden of ['access_token', 'refresh_token', 'pkce_verifier', 'client_secret', 'session_cookie']) {
	assert.equal(serviceSource.includes(forbidden), false, `bootstrap service must not reference ${forbidden}`);
	assert.equal(ownershipSource.includes(forbidden), false, `ownership service must not reference ${forbidden}`);
}

for (const forbiddenWrite of ['INSERT INTO nexora_email_classifications', 'INSERT INTO nexora_email_classification_evidence']) {
	assert.equal(serviceSource.includes(forbiddenWrite), false, `bootstrap service must not write ${forbiddenWrite}`);
}

console.log('domain authority bootstrap contract check passed');
