import { assertDomain, resolveTxt } from './nexora-domain-ownership-service.mjs';
import { deriveCorrelationRef, deriveSessionRef } from './nexora-session-ref-service.mjs';

const OPERATION_ID = 'nexora-staging-authority-tuple-v1';
const encoder = new TextEncoder();
const ALLOWED_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function enabled(env) {
	return env.CLOUDFLARE_EMAIL_WORKER === 'cloud-mail-staging'
		&& String(env.NEXORA_STAGING_AUTHORITY_TUPLE_ENABLED || 'false').toLowerCase() === 'true';
}

function sameOriginRequest(c) {
	if ((c.req.header('sec-fetch-site') || '').toLowerCase() === 'cross-site') return false;
	const origin = c.req.header('origin');
	if (!origin) return true;
	try { return new URL(origin).origin === new URL(c.req.url).origin; } catch { return false; }
}

function abortOnZero(c) {
	return c.env.db.prepare(`INSERT INTO organizations(org_key,display_name) SELECT NULL,NULL WHERE changes()=0`);
}

async function sha256(value) {
	const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')));
	return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function stableDigest(value) {
	const stable = (entry) => Array.isArray(entry)
		? `[${entry.map(stable).join(',')}]`
		: entry && typeof entry === 'object'
			? `{${Object.keys(entry).sort().map(key => `${JSON.stringify(key)}:${stable(entry[key])}`).join(',')}}`
			: JSON.stringify(entry);
	return sha256(stable(value));
}

async function matchesSecret(provided, expected) {
	if (!provided || !expected || String(expected).length < 32) return false;
	const [left, right] = await Promise.all([sha256(provided), sha256(expected)]);
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	return difference === 0;
}

function normalizeDomain(value) {
	const domain = String(value || '').trim().toLowerCase().replace(/\.$/, '');
	if (!ALLOWED_DOMAIN.test(domain) || domain.length > 253) throw new Error('STAGING_AUTHORITY_DOMAIN_INVALID');
	try { return assertDomain(domain); } catch { throw new Error('STAGING_AUTHORITY_PUBLIC_DOMAIN_DENIED'); }
}

function secretResponse(row, extra = {}) {
	return {
		operationId: row.operation_id,
		state: row.state,
		workerVersion: row.worker_version,
		domainFingerprint: row.normalized_domain ? row.normalized_domain.split('.').map((part, index) => index ? part : `sha256:${part.length}`).join('.') : null,
		tupleDigest: row.authority_tuple_digest || null,
		replayed: Boolean(extra.replayed),
		...extra,
	};
}

async function authenticate(c, input) {
	if (!enabled(c.env)) return { denied: { status: 403, body: { error: 'STAGING_AUTHORITY_TUPLE_DISABLED' } } };
	if (!sameOriginRequest(c)) return { denied: { status: 403, body: { error: 'CROSS_SITE_REQUEST_DENIED' } } };
	if (!await matchesSecret(input?.authority_secret, c.env.NEXORA_STAGING_AUTHORITY_TUPLE_SECRET)) {
		return { denied: { status: 401, body: { error: 'UNAUTHORIZED' } } };
	}
	return {};
}

async function authenticateVerifier(c, input) {
	if (c.env.CLOUDFLARE_EMAIL_WORKER !== 'cloud-mail-staging'
		|| String(c.env.NEXORA_STAGING_AUTHORITY_VERIFIER_ENABLED || 'false').toLowerCase() !== 'true') {
		return { denied: { status: 403, body: { error: 'STAGING_AUTHORITY_VERIFIER_DISABLED' } } };
	}
	if (!sameOriginRequest(c)) return { denied: { status: 403, body: { error: 'CROSS_SITE_REQUEST_DENIED' } } };
	if (!await matchesSecret(input?.verifier_secret, c.env.NEXORA_STAGING_AUTHORITY_VERIFIER_SECRET)) {
		return { denied: { status: 401, body: { error: 'UNAUTHORIZED' } } };
	}
	return {};
}

async function existing(c) {
	return c.env.db.prepare('SELECT * FROM nexora_staging_authority_tuple_operations WHERE singleton_id=1').first();
}

async function prepare(c, input) {
	const auth = await authenticate(c, input);
	if (auth.denied) return auth.denied;
	const domain = normalizeDomain(input?.domain);
	const requestDigest = await stableDigest({ contract: OPERATION_ID, domain, capability: 'mail_read' });
	const prior = await existing(c);
	if (prior) {
		if (prior.request_digest !== requestDigest) return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_REPLAY_CONFLICT' } };
		return { status: 200, body: secretResponse(prior, { replayed: true }) };
	}

	const challengeId = crypto.randomUUID();
	const challengeTokenBytes = new Uint8Array(32);
	crypto.getRandomValues(challengeTokenBytes);
	const challengeToken = [...challengeTokenBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
	const challengeHash = await deriveCorrelationRef(c.env, 'dns-txt-token', challengeToken);
	const challengeName = `_nexora-domain.${domain}`;
	const challengeExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
	const workerVersion = String(c.env.CF_VERSION_METADATA?.id || '').trim();
	if (!workerVersion) return { status: 503, body: { error: 'STAGING_WORKER_IDENTITY_MISSING' } };

	try {
		await c.env.db.batch([
			c.env.db.prepare(`INSERT INTO nexora_staging_authority_tuple_operations(singleton_id,operation_id,request_digest,state,normalized_domain,domain_challenge_id,domain_challenge_generation,domain_challenge_token_hash,challenge_expires_at,worker_version) SELECT 1,?1,?2,'DNS_CHALLENGE_READY',?3,?4,1,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM nexora_staging_bootstrap_operations WHERE singleton_id=1 AND state='READY_FOR_FIRST_AUTHORITY') AND (SELECT COUNT(*) FROM user)=0 AND (SELECT COUNT(*) FROM tenants)=0 AND (SELECT COUNT(*) FROM workspaces)=0 AND (SELECT COUNT(*) FROM workspace_members)=0 AND (SELECT COUNT(*) FROM workspace_account_delegations)=0 AND (SELECT COUNT(*) FROM nexora_onboarding_authorization_sessions)=0 AND (SELECT COUNT(*) FROM nexora_onboarding_tokens)=0 AND (SELECT COUNT(*) FROM nexora_onboarding_provider_connections)=0 AND (SELECT COUNT(*) FROM nexora_connections)=0`).bind(OPERATION_ID, requestDigest, domain, challengeId, challengeHash, challengeExpiresAt, workerVersion),
			abortOnZero(c),
		]);
	} catch {
		const winner = await existing(c);
		if (winner?.request_digest === requestDigest) return { status: 200, body: secretResponse(winner, { replayed: true }) };
		return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_PRECONDITION_FAILED' } };
	}

	const row = await existing(c);
	if (row?.state !== 'DNS_CHALLENGE_READY') return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_PREPARE_INCOMPLETE' } };
	return {
		status: 200,
		body: secretResponse(row, {
			dnsChallenge: { type: 'TXT', name: challengeName, value: `nexora-domain-verification=${challengeToken}` },
		}),
	};
}

async function finalize(c, input, fetchImpl = fetch) {
	const auth = await authenticate(c, input);
	if (auth.denied) return auth.denied;
	const row = await existing(c);
	if (!row) return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_NOT_PREPARED' } };
	if (['TUPLE_CREATED','COMPLETE'].includes(row.state)) return { status: 200, body: secretResponse(row, { replayed: true }) };
	if (row.state !== 'DNS_CHALLENGE_READY') return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_STATE_INVALID' } };
	if (Date.parse(row.challenge_expires_at) <= Date.now()) return { status: 409, body: { error: 'STAGING_AUTHORITY_DOMAIN_CHALLENGE_EXPIRED' } };
	const answers = await resolveTxt(`_nexora-domain.${row.normalized_domain}`, fetchImpl);
	let verified = false;
	for (const answer of answers) {
		const token = answer.replace(/^nexora-domain-verification=/, '');
		if (await deriveCorrelationRef(c.env, 'dns-txt-token', token) === row.domain_challenge_token_hash) verified = true;
	}
	if (!verified) return { status: 409, body: { error: 'STAGING_AUTHORITY_DOMAIN_NOT_VERIFIED' } };

	const ids = {
		membership: crypto.randomUUID(),
		domainEvent: crypto.randomUUID(),
		domainAuthority: crypto.randomUUID(),
		delegation: crypto.randomUUID(),
		evidence: crypto.randomUUID(),
	};
	const tenantKey = `staging:${row.request_digest.slice(0, 24)}`;
	const orgKey = `org:${row.request_digest.slice(0, 24)}`;
	const email = `authority-${row.request_digest.slice(0, 16)}@${row.normalized_domain}`;
	const syntheticSalt = await sha256(`${row.request_digest}:salt`);
	const disabledPasswordHash = await sha256(`${row.request_digest}:non-login-password`);
	const userId = 1;
	const tenantId = 1;
	const workspaceId = 1;
	const accountId = 1;
	const evidenceRef = await deriveCorrelationRef(c.env, 'domain-ownership-evidence', [1, 1, row.normalized_domain, row.domain_challenge_id, row.domain_challenge_token_hash].join('\n'));
	const tupleDigest = await stableDigest({ userId, tenantId, workspaceId, accountId, domain: row.normalized_domain, membershipAuthorityId: ids.membership, domainAuthorityId: ids.domainAuthority, delegationAuthorityId: ids.delegation, capability: 'mail_read', generation: 1 });
	const summary = JSON.stringify({ operation_id: row.operation_id, tuple_digest: tupleDigest, provider: 'google', capability: 'mail_read', broader_authority: false, credential_present: false, oauth_session_created: false, mailbox_accessed: false });
	const integrityHash = await stableDigest(summary);
	const missionId = `staging-authority:${row.operation_id}`;
	const authorization = c.req.header('authorization') || `StagingAuthority ${input.authority_secret}`;
	const authSessionRef = await deriveSessionRef(c.env, authorization);
	const requestId = c.req.header('cf-ray') || row.operation_id;
	const acceptanceCorrelationRef = await deriveCorrelationRef(c.env, 'domain-ownership-acceptance', [1, 1, row.domain_challenge_id, row.operation_id, requestId].join('\n'));
	try {
		await c.env.db.batch([
			c.env.db.prepare(`INSERT INTO user(user_id,email,type,password,salt,status) SELECT 1,?1,1,?2,?3,0 WHERE EXISTS(SELECT 1 FROM nexora_staging_bootstrap_operations WHERE singleton_id=1 AND state='READY_FOR_FIRST_AUTHORITY') AND (SELECT COUNT(*) FROM user)=0 AND (SELECT COUNT(*) FROM tenants)=0 AND (SELECT COUNT(*) FROM workspaces)=0`).bind(email, disabledPasswordHash, syntheticSalt),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO organizations(id,org_key,display_name) VALUES(1,?1,'NEXORA Staging Authority')`).bind(orgKey),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO tenants(id,org_id,tenant_key,display_name) VALUES(1,1,?1,'NEXORA Staging Tenant')`).bind(tenantKey),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO org_memberships(org_id,tenant_id,user_id,role_key) VALUES(1,1,1,'OWNER')`),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspaces(id,tenant_key,display_name,created_by_user_id) VALUES(1,?1,'NEXORA Staging',1)`).bind(tenantKey),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(1,1,'OWNER')`),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspace_membership_authorities(id,tenant_key,workspace_id,subject_user_id,granting_user_id,invitation_id,role,scope_json,state,authority_generation,activated_at,expires_at,reason) VALUES(?1,?2,1,1,1,?3,'OWNER','["workspace_visibility","account_state_visibility"]','active',1,CURRENT_TIMESTAMP,datetime('now','+365 days'),'staging_first_authority')`).bind(ids.membership, tenantKey, OPERATION_ID),
			abortOnZero(c),
			c.env.db.prepare(`UPDATE account SET provider='google',domain=?1,sync_status='needs_authorization',external_account_id=NULL WHERE account_id=1 AND user_id=1 AND is_del=0`).bind(row.normalized_domain),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspace_account_bindings(workspace_id,account_id,owner_user_id,subject_user_id,lifecycle_state) VALUES(1,1,1,1,'READY')`),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO nexora_domain_ownership_challenges(id,tenant_id,workspace_id,normalized_domain,challenge_name,challenge_token_hash,hmac_key_version,verification_status,administrator_authority_ref,idempotency_key,generation,expires_at,attempt,verification_evidence_ref,verification_operation_id,verified_at,consumed_at) VALUES(?1,1,1,?2,?3,?4,?5,'verified','staging-authority-tuple',?6,1,?7,1,?8,?6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(row.domain_challenge_id, row.normalized_domain, `_nexora-domain.${row.normalized_domain}`, row.domain_challenge_token_hash, String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || ''), OPERATION_ID, row.challenge_expires_at, evidenceRef),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspace_domains(workspace_id,domain,provider,authority_state,lifecycle_state,health_state) VALUES(1,?1,'dns_txt','VERIFIED','READY','READY')`).bind(row.normalized_domain),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO nexora_domain_ownership_verification_events(id,challenge_id,tenant_id,workspace_id,normalized_domain,generation,verification_operation_id,verification_evidence_ref,actor_user_id,auth_session_ref,hmac_key_version,request_id,runtime_deployment_id,acceptance_correlation_ref,result,observed_at) VALUES(?1,?2,1,1,?3,1,?4,?5,1,?6,?7,?8,?9,?10,'VERIFIED',CURRENT_TIMESTAMP)`).bind(ids.domainEvent, row.domain_challenge_id, row.normalized_domain, OPERATION_ID, evidenceRef, authSessionRef, String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || ''), requestId, row.worker_version, acceptanceCorrelationRef),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO nexora_domain_authorities(id,tenant_id,workspace_id,normalized_domain,verification_status,verification_method,verification_evidence_ref,administrator_authority_ref,generation) VALUES(?1,1,1,?2,'verified','DNS_TXT',?3,'staging-authority-tuple',1)`).bind(ids.domainAuthority, row.normalized_domain, evidenceRef),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspace_account_delegations(id,tenant_key,workspace_id,account_id,owner_user_id,subject_user_id,requester_user_id,scope_json,reason,state,owner_consent_at,owner_consent_by_user_id,approved_at,approved_by_user_id,activated_at,expires_at,authority_generation) VALUES(?1,?2,1,1,1,1,1,'["mail_read"]','staging_minimum_mail_read','active',CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP,datetime('now','+365 days'),1)`).bind(ids.delegation, tenantKey),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspace_account_delegation_authority_bindings(delegation_id,tenant_key,workspace_id,account_id,membership_authority_id,membership_authority_generation,domain_authority_id,domain_authority_generation) VALUES(?1,?2,1,1,?3,1,?4,1)`).bind(ids.delegation,tenantKey,ids.membership,ids.domainAuthority),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO nexora_audit_events(user_id,domain,action,object_type,object_ref,outcome,metadata_json,operation_id) VALUES(1,?1,'NEXORA_STAGING_AUTHORITY_TUPLE_CREATED','authority_tuple',?2,'VERIFIED',?3,?4)`).bind(row.normalized_domain, tupleDigest, summary, OPERATION_ID),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id,operation_id) VALUES(1,1,'NEXORA_STAGING_AUTHORITY_TUPLE_CREATED','authority_tuple',?1,'{}',?2,?3,?3)`).bind(tupleDigest, summary, OPERATION_ID),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,run_id,step_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,evidence_type,producer_type,producer_id_hash,integrity_hash,sensitivity,retention_class,observability_json) VALUES(?1,?2,?3,?4,1,1,'staging_authority_tuple','authority_tuple_ceremony','supported',?5,?6,CURRENT_TIMESTAMP,'authority_observation','controlled_system',?7,?8,'restricted_metadata','runtime_audit','{}')`).bind(ids.evidence, missionId, `${missionId}:run`, `${missionId}:step`, tupleDigest, summary, await sha256(row.worker_version), integrityHash),
			abortOnZero(c),
			c.env.db.prepare(`UPDATE nexora_staging_bootstrap_operations SET state='COMPLETE',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND state='FIRST_USER_CREATED'`),
			abortOnZero(c),
			c.env.db.prepare(`UPDATE nexora_staging_authority_tuple_operations SET state='TUPLE_CREATED',user_id=1,tenant_id=1,workspace_id=1,account_id=1,membership_authority_id=?1,domain_authority_id=?2,domain_authority_generation=1,delegation_authority_id=?3,delegation_authority_generation=1,authority_tuple_digest=?4,evidence_id=?5,updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND state='DNS_CHALLENGE_READY'`).bind(ids.membership, ids.domainAuthority, ids.delegation, tupleDigest, ids.evidence),
			abortOnZero(c),
		]);
	} catch {
		const winner = await existing(c);
		if (['TUPLE_CREATED','COMPLETE'].includes(winner?.state)) return { status: 200, body: secretResponse(winner, { replayed: true }) };
		return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_FINALIZE_FAILED' } };
	}
	const complete = await existing(c);
	return complete?.state === 'TUPLE_CREATED'
		? { status: 200, body: secretResponse(complete) }
		: { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_FINALIZE_INCOMPLETE' } };
}

async function verify(c, input) {
	const auth = await authenticateVerifier(c, input);
	if (auth.denied) return auth.denied;
	const row = await existing(c);
	if (!row) return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_NOT_PREPARED' } };
	if (row.state === 'COMPLETE') return { status: 200, body: secretResponse(row, { replayed: true }) };
	if (row.state !== 'TUPLE_CREATED') return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_NOT_CREATED' } };
	const proof = await c.env.db.prepare(`
		SELECT
		 (SELECT COUNT(*) FROM user WHERE user_id=?1 AND password<>'' AND salt<>'') AS users,
		 (SELECT COUNT(*) FROM organizations o JOIN tenants t ON t.org_id=o.id WHERE t.id=?2) AS organizations,
		 (SELECT COUNT(*) FROM tenants WHERE id=?2) AS tenants,
		 (SELECT COUNT(*) FROM org_memberships WHERE tenant_id=?2 AND user_id=?1 AND role_key='OWNER') AS org_memberships,
		 (SELECT COUNT(*) FROM workspaces WHERE id=?3 AND created_by_user_id=?1) AS workspaces,
		 (SELECT COUNT(*) FROM workspace_members WHERE workspace_id=?3 AND user_id=?1 AND role='OWNER') AS memberships,
		 (SELECT COUNT(*) FROM workspace_membership_authorities WHERE id=?4 AND workspace_id=?3 AND subject_user_id=?1 AND state='active' AND authority_generation=1) AS membership_authorities,
		 (SELECT COUNT(*) FROM nexora_domain_authorities WHERE id=?5 AND tenant_id=?2 AND workspace_id=?3 AND normalized_domain=?6 AND verification_status='verified' AND generation=1) AS domain_authorities,
		 (SELECT COUNT(*) FROM account WHERE account_id=?7 AND user_id=?1 AND provider='google' AND domain=?6 AND external_account_id IS NULL AND oauth_authorization_generation=0 AND is_del=0) AS accounts,
		 (SELECT COUNT(*) FROM workspace_account_bindings WHERE workspace_id=?3 AND account_id=?7 AND owner_user_id=?1 AND subject_user_id=?1 AND lifecycle_state='READY') AS account_bindings,
		 (SELECT COUNT(*) FROM workspace_domains WHERE workspace_id=?3 AND domain=?6 AND provider='dns_txt' AND authority_state='VERIFIED' AND lifecycle_state='READY') AS workspace_domains,
		 (SELECT COUNT(*) FROM nexora_domain_ownership_challenges WHERE id=(SELECT domain_challenge_id FROM nexora_staging_authority_tuple_operations WHERE singleton_id=1) AND tenant_id=?2 AND workspace_id=?3 AND normalized_domain=?6 AND verification_status='verified' AND generation=1 AND consumed_at IS NOT NULL) AS domain_challenges,
		 (SELECT COUNT(*) FROM nexora_domain_ownership_verification_events WHERE challenge_id=(SELECT domain_challenge_id FROM nexora_staging_authority_tuple_operations WHERE singleton_id=1) AND tenant_id=?2 AND workspace_id=?3 AND normalized_domain=?6 AND result='VERIFIED') AS domain_events,
		 (SELECT COUNT(*) FROM workspace_account_delegations d JOIN workspace_account_delegation_authority_bindings b ON b.delegation_id=d.id AND b.tenant_key=d.tenant_key AND b.workspace_id=d.workspace_id AND b.account_id=d.account_id WHERE d.id=?8 AND d.tenant_key=(SELECT tenant_key FROM tenants WHERE id=?2) AND d.workspace_id=?3 AND d.account_id=?7 AND d.owner_user_id=?1 AND d.subject_user_id=?1 AND d.requester_user_id=?1 AND d.state='active' AND d.scope_json='["mail_read"]' AND d.authority_generation=1 AND b.membership_authority_id=?4 AND b.membership_authority_generation=1 AND b.domain_authority_id=?5 AND b.domain_authority_generation=1) AS delegations,
		 (SELECT COUNT(*) FROM nexora_audit_events WHERE operation_id=?11 AND action='NEXORA_STAGING_AUTHORITY_TUPLE_CREATED' AND object_ref=?10 AND outcome='VERIFIED') AS audit_events,
		 (SELECT COUNT(*) FROM workspace_audit_events WHERE workspace_id=?3 AND operation_id=?11 AND action='NEXORA_STAGING_AUTHORITY_TUPLE_CREATED' AND object_ref=?10) AS workspace_audit_events,
		 (SELECT COUNT(*) FROM nexora_onboarding_authorization_sessions) AS oauth_sessions,
		 (SELECT COUNT(*) FROM nexora_onboarding_tokens) AS credential_refs,
		 (SELECT COUNT(*) FROM nexora_onboarding_provider_connections) AS provider_connections,
		 (SELECT COUNT(*) FROM nexora_connections) AS connections
	`).bind(row.user_id,row.tenant_id,row.workspace_id,row.membership_authority_id,row.domain_authority_id,row.normalized_domain,row.account_id,row.delegation_authority_id,row.evidence_id,row.authority_tuple_digest,OPERATION_ID).first();
	const expectedTupleDigest = await stableDigest({
		userId: row.user_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, accountId: row.account_id,
		domain: row.normalized_domain, membershipAuthorityId: row.membership_authority_id,
		domainAuthorityId: row.domain_authority_id, delegationAuthorityId: row.delegation_authority_id,
		capability: 'mail_read', generation: 1,
	});
	const expectedSummary = JSON.stringify({ operation_id: row.operation_id, tuple_digest: expectedTupleDigest, provider: 'google', capability: 'mail_read', broader_authority: false, credential_present: false, oauth_session_created: false, mailbox_accessed: false });
	const evidence = await c.env.db.prepare('SELECT reference_hash,summary_json,integrity_hash FROM mission_runtime_evidence WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status=\'supported\'').bind(row.evidence_id,row.tenant_id,row.workspace_id).first();
	const evidenceIntegrity = await stableDigest(expectedSummary);
	const required = ['users','organizations','tenants','org_memberships','workspaces','memberships','membership_authorities','domain_authorities','accounts','account_bindings','workspace_domains','domain_challenges','domain_events','delegations','audit_events','workspace_audit_events'];
	const forbidden = ['oauth_sessions','credential_refs','provider_connections','connections'];
	if (required.some(key => Number(proof?.[key]) !== 1)
		|| forbidden.some(key => Number(proof?.[key]) !== 0)
		|| row.authority_tuple_digest !== expectedTupleDigest
		|| evidence?.reference_hash !== expectedTupleDigest
		|| evidence?.summary_json !== expectedSummary
		|| evidence?.integrity_hash !== evidenceIntegrity) {
		return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_INDEPENDENT_VERIFICATION_FAILED' } };
	}
	const verificationId = crypto.randomUUID();
	const missionId = `staging-authority:${row.operation_id}`;
	const evidenceSetHash = await stableDigest([row.evidence_id, evidenceIntegrity]);
	try {
		await c.env.db.batch([
			c.env.db.prepare(`INSERT INTO mission_runtime_verifications(id,mission_id,run_id,tenant_id,workspace_id,state,evidence_id,verifier,policy_id,policy_version,evidence_set_hash,reason_codes_json,integrity_state) VALUES(?1,?2,?3,?4,?5,'verified',?6,'separately_scoped_staging_authority_verifier','staging_authority_tuple_v1',1,?7,'[]','valid')`).bind(verificationId, missionId, `${missionId}:run`, row.tenant_id, row.workspace_id, row.evidence_id, evidenceSetHash),
			abortOnZero(c),
			c.env.db.prepare(`UPDATE nexora_staging_authority_tuple_operations SET state='COMPLETE',verification_id=?1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND state='TUPLE_CREATED'`).bind(verificationId),
			abortOnZero(c),
		]);
	} catch {
		const winner = await existing(c);
		if (winner?.state === 'COMPLETE') return { status: 200, body: secretResponse(winner, { replayed: true }) };
		return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_VERIFICATION_COMMIT_FAILED' } };
	}
	return { status: 200, body: secretResponse(await existing(c)) };
}

async function oauthProvenance(c, input) {
	const auth = await authenticateVerifier(c, input);
	if (auth.denied) return auth.denied;
	const clientId = String(c.env.NEXORA_GOOGLE_OAUTH_CLIENT_ID || '');
	const redirectUri = String(c.env.NEXORA_GOOGLE_OAUTH_REDIRECT_URI || '');
	if (!clientId || !redirectUri) {
		return { status: 409, body: { error: 'STAGING_OAUTH_BINDING_INCOMPLETE' } };
	}
	let parsed;
	try { parsed = new URL(redirectUri); } catch { return { status: 409, body: { error: 'STAGING_OAUTH_REDIRECT_INVALID' } }; }
	return {
		status: 200,
		body: {
			clientIdFingerprint: await sha256(clientId),
			redirectUriFingerprint: await sha256(redirectUri),
			redirectOrigin: parsed.origin,
			redirectPath: parsed.pathname,
			secretBinding: 'NOT_INSPECTED_IN_RUNTIME',
			secretBindingInventoryRequired: true,
		},
	};
}

async function revoke(c, input) {
	const auth = await authenticateVerifier(c, input);
	if (auth.denied) return auth.denied;
	const row = await existing(c);
	if (!row) return { status: 404, body: { error: 'STAGING_AUTHORITY_TUPLE_NOT_PREPARED' } };
	if (row.state === 'REVOKED') return { status: 200, body: secretResponse(row, { replayed: true }) };
	if (!['TUPLE_CREATED','COMPLETE'].includes(row.state)) return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_NOT_REVOCABLE' } };
	const revocationEvidenceId = crypto.randomUUID();
	const missionId = `staging-authority:${row.operation_id}:revocation`;
	const summary = JSON.stringify({
		operation_id: row.operation_id, prior_tuple_digest: row.authority_tuple_digest,
		membership_authority_id: row.membership_authority_id, membership_generation: 2,
		domain_authority_id: row.domain_authority_id, domain_generation: Number(row.domain_authority_generation) + 1,
		delegation_authority_id: row.delegation_authority_id, delegation_generation: Number(row.delegation_authority_generation) + 1,
		state: 'REVOKED', credential_accessed: false, mailbox_mutated: false,
	});
	const referenceHash = await stableDigest(summary);
	const integrityHash = await stableDigest({ referenceHash, summary });
	try {
		await c.env.db.batch([
			c.env.db.prepare(`UPDATE workspace_membership_authorities SET state='revoked',authority_generation=authority_generation+1,revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND workspace_id=?2 AND subject_user_id=?3 AND state='active' AND authority_generation=1`).bind(row.membership_authority_id,row.workspace_id,row.user_id),
			abortOnZero(c),
			c.env.db.prepare(`UPDATE workspace_account_delegations SET state='revoked',authority_generation=authority_generation+1,revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND workspace_id=?2 AND account_id=?3 AND state='active' AND authority_generation=?4`).bind(row.delegation_authority_id,row.workspace_id,row.account_id,row.delegation_authority_generation),
			abortOnZero(c),
			c.env.db.prepare(`UPDATE nexora_domain_authorities SET verification_status='revoked',generation=generation+1,revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND verification_status='verified' AND generation=?4`).bind(row.domain_authority_id,row.tenant_id,row.workspace_id,row.domain_authority_generation),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO nexora_audit_events(user_id,domain,action,object_type,object_ref,outcome,metadata_json,operation_id) VALUES(?1,?2,'NEXORA_STAGING_AUTHORITY_TUPLE_REVOKED','authority_tuple',?3,'REVOKED',?4,?5)`).bind(row.user_id,row.normalized_domain,row.authority_tuple_digest,summary,`${OPERATION_ID}:revocation`),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id,operation_id) VALUES(?1,?2,'NEXORA_STAGING_AUTHORITY_TUPLE_REVOKED','authority_tuple',?3,'{}',?4,?5,?5)`).bind(row.workspace_id,row.user_id,row.authority_tuple_digest,summary,`${OPERATION_ID}:revocation`),
			abortOnZero(c),
			c.env.db.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,run_id,step_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,evidence_type,producer_type,producer_id_hash,integrity_hash,sensitivity,retention_class,observability_json) VALUES(?1,?2,?3,?4,?5,?6,'staging_authority_tuple_revocation','authority_tuple_revocation','supported',?7,?8,CURRENT_TIMESTAMP,'authority_revocation','controlled_system',?9,?10,'restricted_metadata','runtime_audit','{}')`).bind(revocationEvidenceId,missionId,`${missionId}:run`,`${missionId}:step`,row.tenant_id,row.workspace_id,referenceHash,summary,await sha256(row.worker_version),integrityHash),
			abortOnZero(c),
			c.env.db.prepare(`UPDATE nexora_staging_authority_tuple_operations SET state='REVOCATION_PENDING',domain_authority_generation=domain_authority_generation+1,delegation_authority_generation=delegation_authority_generation+1,revocation_evidence_id=?2,revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND state=?1`).bind(row.state,revocationEvidenceId),
			abortOnZero(c),
		]);
	} catch {
		return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_REVOCATION_FAILED' } };
	}
	return { status: 200, body: secretResponse(await existing(c)) };
}

async function verifyRevocation(c, input) {
	const auth = await authenticateVerifier(c, input);
	if (auth.denied) return auth.denied;
	const row = await existing(c);
	if (!row) return { status: 404, body: { error: 'STAGING_AUTHORITY_TUPLE_NOT_PREPARED' } };
	if (row.state === 'REVOKED') return { status: 200, body: secretResponse(row, { replayed: true }) };
	if (row.state !== 'REVOCATION_PENDING') return { status: 409, body: { error: 'STAGING_AUTHORITY_REVOCATION_NOT_PENDING' } };
	const proof = await c.env.db.prepare(`
		SELECT
		 (SELECT COUNT(*) FROM workspace_membership_authorities WHERE id=?1 AND workspace_id=?2 AND subject_user_id=?3 AND state='revoked' AND authority_generation=2 AND revoked_at IS NOT NULL) AS membership,
		 (SELECT COUNT(*) FROM workspace_account_delegations WHERE id=?4 AND workspace_id=?2 AND account_id=?5 AND state='revoked' AND authority_generation=?6 AND revoked_at IS NOT NULL) AS delegation,
		 (SELECT COUNT(*) FROM nexora_domain_authorities WHERE id=?7 AND tenant_id=?8 AND workspace_id=?2 AND verification_status='revoked' AND generation=?9 AND revoked_at IS NOT NULL) AS domain_authority
	`).bind(row.membership_authority_id,row.workspace_id,row.user_id,row.delegation_authority_id,row.account_id,row.delegation_authority_generation,row.domain_authority_id,row.tenant_id,row.domain_authority_generation).first();
	const evidence = await c.env.db.prepare(`SELECT reference_hash,summary_json,integrity_hash FROM mission_runtime_evidence WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status='supported' AND claim_key='staging_authority_tuple_revocation'`).bind(row.revocation_evidence_id,row.tenant_id,row.workspace_id).first();
	const expectedSummary = JSON.stringify({
		operation_id: row.operation_id, prior_tuple_digest: row.authority_tuple_digest,
		membership_authority_id: row.membership_authority_id, membership_generation: 2,
		domain_authority_id: row.domain_authority_id, domain_generation: Number(row.domain_authority_generation),
		delegation_authority_id: row.delegation_authority_id, delegation_generation: Number(row.delegation_authority_generation),
		state: 'REVOKED', credential_accessed: false, mailbox_mutated: false,
	});
	const expectedReferenceHash = await stableDigest(expectedSummary);
	const expectedIntegrityHash = await stableDigest({ referenceHash:expectedReferenceHash, summary:expectedSummary });
	if (Number(proof?.membership)!==1 || Number(proof?.delegation)!==1 || Number(proof?.domain_authority)!==1
		|| !evidence || evidence.summary_json !== expectedSummary
		|| evidence.reference_hash !== expectedReferenceHash || evidence.integrity_hash !== expectedIntegrityHash) {
		return { status:409, body:{ error:'STAGING_AUTHORITY_REVOCATION_INDEPENDENT_VERIFICATION_FAILED' } };
	}
	const verificationId = crypto.randomUUID();
	const missionId = `staging-authority:${row.operation_id}:revocation`;
	const evidenceSetHash = await stableDigest([row.revocation_evidence_id,evidence.integrity_hash]);
	try {
		await c.env.db.batch([
			c.env.db.prepare(`INSERT INTO mission_runtime_verifications(id,mission_id,run_id,tenant_id,workspace_id,state,evidence_id,verifier,policy_id,policy_version,evidence_set_hash,reason_codes_json,integrity_state) VALUES(?1,?2,?3,?4,?5,'verified',?6,'separately_scoped_staging_authority_revocation_verifier','staging_authority_revocation_v1',1,?7,'[]','valid')`).bind(verificationId,missionId,`${missionId}:run`,row.tenant_id,row.workspace_id,row.revocation_evidence_id,evidenceSetHash),
			abortOnZero(c),
			c.env.db.prepare(`UPDATE nexora_staging_authority_tuple_operations SET state='REVOKED',revocation_verification_id=?1,updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND state='REVOCATION_PENDING'`).bind(verificationId),
			abortOnZero(c),
		]);
	} catch {
		return { status:409, body:{ error:'STAGING_AUTHORITY_REVOCATION_VERIFICATION_COMMIT_FAILED' } };
	}
	return { status:200, body:secretResponse(await existing(c)) };
}

async function rollback(c, input) {
	const auth = await authenticate(c, input);
	if (auth.denied) return auth.denied;
	const row = await existing(c);
	if (!row) return { status: 404, body: { error: 'STAGING_AUTHORITY_TUPLE_NOT_PREPARED' } };
	if (row.state === 'REVOKED') return { status: 200, body: secretResponse(row, { replayed: true }) };
	if (row.state === 'COMPLETE') return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_COMPLETED_ROLLBACK_REQUIRES_CANONICAL_REVOCATION' } };
	if (row.state === 'TUPLE_CREATED') return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_CREATED_ROLLBACK_REQUIRES_CANONICAL_REVOCATION' } };
	const changed = await c.env.db.prepare(`UPDATE nexora_staging_authority_tuple_operations SET state='REVOKED',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND state IN ('IDENTITY_READY','DNS_CHALLENGE_READY')`).run();
	if (Number(changed.meta?.changes || 0) !== 1) return { status: 409, body: { error: 'STAGING_AUTHORITY_TUPLE_ROLLBACK_CONFLICT' } };
	return { status: 200, body: secretResponse(await existing(c)) };
}

export { normalizeDomain, stableDigest };
export default { prepare, finalize, verify, oauthProvenance, revoke, verifyRevocation, rollback };
