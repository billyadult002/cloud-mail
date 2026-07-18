// NEXORA Cloudflare provider authority binding (Required Outputs #8-#10). Cloudflare
// authorization is account- and zone-scoped, never a bare "connected" flag -- every capability
// check requires the specific capability to be present in authorized_capabilities_json.
// credential_reference NEVER holds a raw API token/secret value -- it is a reference into the
// approved secret boundary (Cloudflare Workers secret name / organization-managed credential
// id), consistent with ADR-9 (Required Output #9: never store a Global API Key when a scoped
// token is sufficient -- this contract has no field for one).
const uuid = () => crypto.randomUUID();
function assertScope(row, scope) {
	if (!row || Number(row.tenant_id) !== Number(scope.tenantId) || Number(row.workspace_id) !== Number(scope.workspaceId)) throw new Error('nexora_cloudflare_authority_scope_denied');
}

const AUTHORIZATION_SOURCES = new Set(['scoped_api_token', 'oauth', 'organization_managed', 'deployment_secret']);

async function bindAuthority(c, scope, { onboardingMissionId, cloudflareAccountId, zoneId = null, authorizedCapabilities, permissionScope, credentialReference, authorizationSource, expiresAt = null }) {
	if (!AUTHORIZATION_SOURCES.has(authorizationSource)) throw new Error('nexora_cloudflare_authorization_source_invalid');
	if (!credentialReference) throw new Error('nexora_cloudflare_credential_reference_required');
	// A credential_reference that LOOKS like a raw high-entropy secret (long base64-ish
	// string, e.g. an actual Cloudflare API token) is rejected outright -- this field must be
	// a short, human-readable reference name (e.g. "cf_api_token_zone_abc"), never the secret
	// value itself (Required Output #9/#12 - never store the raw credential).
	if (/^[A-Za-z0-9+/=]{30,}$/.test(credentialReference)) throw new Error('nexora_cloudflare_credential_reference_looks_like_raw_secret');
	const id = uuid();
	await c.env.db
		.prepare(`INSERT INTO nexora_cloudflare_authorities(id,onboarding_mission_id,tenant_id,workspace_id,cloudflare_account_id,zone_id,authorized_capabilities_json,permission_scope_json,credential_reference,authorization_source,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
		.bind(id, onboardingMissionId, scope.tenantId, scope.workspaceId, cloudflareAccountId, zoneId, JSON.stringify(authorizedCapabilities), JSON.stringify(permissionScope), credentialReference, authorizationSource, expiresAt)
		.run();
	return { id, cloudflareAccountId, zoneId, authorizedCapabilities };
}

async function revokeAuthority(c, scope, { authorityId, reason }) {
	const row = await c.env.db.prepare(`SELECT * FROM nexora_cloudflare_authorities WHERE id=?1`).bind(authorityId).first();
	assertScope(row, scope);
	if (row.revoked_at) return { alreadyRevoked: true };
	await c.env.db.prepare(`UPDATE nexora_cloudflare_authorities SET revoked_at=CURRENT_TIMESTAMP,revoked_reason=?2 WHERE id=?1`).bind(authorityId, reason).run();
	return { alreadyRevoked: false };
}

// The single check every Cloudflare mutation must pass before dispatch (Verified Action
// Boundary precondition): authority must exist, be unrevoked, unexpired, zone-matched (if the
// authority is zone-scoped), and explicitly list the requested capability.
async function checkCapabilityAuthorized(c, scope, { onboardingMissionId, cloudflareAccountId, zoneId, capability }) {
	const row = await c.env.db.prepare(`SELECT * FROM nexora_cloudflare_authorities WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND cloudflare_account_id=?4`).bind(onboardingMissionId, scope.tenantId, scope.workspaceId, cloudflareAccountId).first();
	if (!row) return { authorized: false, reason: 'AUTHORIZATION_MISSING' };
	if (row.revoked_at) return { authorized: false, reason: 'AUTHORIZATION_REVOKED' };
	if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return { authorized: false, reason: 'AUTHORIZATION_EXPIRED' };
	if (row.zone_id && zoneId && row.zone_id !== zoneId) return { authorized: false, reason: 'ZONE_OUTSIDE_AUTHORIZED_ACCOUNT' };
	const capabilities = JSON.parse(row.authorized_capabilities_json || '[]');
	if (!capabilities.includes(capability)) return { authorized: false, reason: 'CAPABILITY_NOT_AUTHORIZED' };
	return { authorized: true, authorityId: row.id };
}

export { AUTHORIZATION_SOURCES };
export default { bindAuthority, revokeAuthority, checkCapabilityAuthorized };
