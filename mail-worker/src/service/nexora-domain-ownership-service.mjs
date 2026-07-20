import { v4 as uuid } from 'uuid';
import classificationService from './nexora-email-classification-service.mjs';
import workspaceAuthorityService from './nexora-workspace-authority-service.mjs';
import { deriveCorrelationRef, deriveSessionRef } from './nexora-session-ref-service.mjs';

const PUBLIC_MAILBOX_DOMAINS = new Set([
	'aol.com',
	'gmail.com',
	'googlemail.com',
	'hotmail.com',
	'icloud.com',
	'live.com',
	'me.com',
	'msn.com',
	'outlook.com',
	'proton.me',
	'protonmail.com',
	'yahoo.com'
]);

function assertScope(input) {
	const tenantId = Number(input?.tenantId);
	const workspaceId = Number(input?.workspaceId);
	if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error('tenantId is required');
	if (!Number.isInteger(workspaceId) || workspaceId <= 0) throw new Error('workspaceId is required');
	return { tenantId, workspaceId };
}

function assertDomain(input) {
	const domain = classificationService.normalizeDomain(input);
	if (!domain || !domain.includes('.') || domain.length > 253) throw new Error('valid domain is required');
	if (PUBLIC_MAILBOX_DOMAINS.has(domain)) throw new Error('public mailbox domains cannot bootstrap authority');
	return domain;
}

function authorityRef(actor) {
	return `admin:${actor.userId}`;
}

function randomToken() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function challengeName(domain) {
	return `_nexora-domain.${domain}`;
}

async function evidenceRef(env, scope, domain, challengeId, tokenHash) {
	return deriveCorrelationRef(env, 'domain-ownership-evidence', [
		scope.tenantId, scope.workspaceId, domain, challengeId, tokenHash
	].join('\n'));
}

function requestHeader(c, name) {
	try { return c.req?.header?.(name) || null; } catch { return null; }
}

async function serverVerificationContext(c, scope, challengeId, operationId) {
	const requestId = requestHeader(c, 'cf-ray') || uuid();
	const authorization = requestHeader(c, 'authorization');
	const authSessionRef = await deriveSessionRef(c.env, authorization);
	const acceptanceCorrelationRef = await deriveCorrelationRef(c.env, 'domain-ownership-acceptance', [
		scope.tenantId, scope.workspaceId, challengeId, operationId, requestId
	].join('\n'));
	const runtimeDeploymentId = String(c.env.CF_VERSION_METADATA?.id || '').trim();
	if (!runtimeDeploymentId) throw new Error('runtime deployment identity is not configured');
	return {
		requestId,
		authSessionRef,
		acceptanceCorrelationRef,
		runtimeDeploymentId
	};
}

async function workspaceAuthority(c, scope, actor) {
	return workspaceAuthorityService.assertWorkspaceCapability(c, actor, scope.workspaceId, 'domain:write');
}

function auditStatements(c, scope, actor, domain, action, objectRef, afterState, requestId) {
	const metadata = JSON.stringify({ domain, action, bodyPersisted: false, redactionLevel: 'BODYLESS' });
	return [
		c.env.db.prepare(
			`INSERT INTO nexora_audit_events(user_id,domain,action,object_type,object_ref,outcome,metadata_json)
			 VALUES(?1,?2,?3,'domain_ownership',?4,'RECORDED',?5)`
		).bind(actor.userId, domain, action, objectRef, metadata),
		c.env.db.prepare(
			`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id)
			 VALUES(?1,?2,?3,'domain_ownership',?4,'{}',?5,?6)`
		).bind(scope.workspaceId, actor.userId, action, objectRef, JSON.stringify(afterState), requestId)
	];
}

async function createDnsChallenge(c, scopeInput, input, actor) {
	const scope = assertScope(scopeInput);
	const domain = assertDomain(input?.domain);
	await workspaceAuthority(c, scope, actor);
	const token = randomToken();
	const tokenHash = await deriveCorrelationRef(c.env, 'dns-txt-token', token);
	const idempotencyKey = input?.idempotencyKey || classificationService.stableFingerprint([
		'nexora-domain-ownership-dns-challenge',
		scope.tenantId,
		scope.workspaceId,
		domain
	]);
	const id = uuid();
	const name = challengeName(domain);
	const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	const existing = await c.env.db.prepare(
		`SELECT id,verification_status,generation FROM nexora_domain_ownership_challenges
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3 AND idempotency_key=?4`
	).bind(scope.tenantId, scope.workspaceId, domain, idempotencyKey).first();
	if (existing) throw new Error('domain ownership challenge idempotency key has already been used');
	const latest = await c.env.db.prepare(
		`SELECT COALESCE(MAX(generation),0) AS generation FROM nexora_domain_ownership_challenges
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3`
	).bind(scope.tenantId, scope.workspaceId, domain).first();
	const generation = Number(latest?.generation || 0) + 1;
	await c.env.db.batch([c.env.db.prepare(
		`UPDATE nexora_domain_ownership_challenges SET superseded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3
		  AND verification_status='pending' AND consumed_at IS NULL AND superseded_at IS NULL`
	).bind(scope.tenantId, scope.workspaceId, domain), c.env.db.prepare(
		`INSERT INTO nexora_domain_ownership_challenges
		 (id,tenant_id,workspace_id,normalized_domain,challenge_name,challenge_token_hash,hmac_key_version,verification_status,administrator_authority_ref,idempotency_key,generation,expires_at)
		 VALUES(?1,?2,?3,?4,?5,?6,?7,'pending',?8,?9,?10,?11)`
	).bind(id, scope.tenantId, scope.workspaceId, domain, name, tokenHash, c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION, authorityRef(actor), idempotencyKey, generation, expiresAt),
		...auditStatements(c, scope, actor, domain, 'NEXORA_DOMAIN_OWNERSHIP_CHALLENGE_CREATED', id, { verificationStatus: 'pending', challengeName: name, expiresAt, generation }, idempotencyKey)
	]);
	const row = await c.env.db.prepare(
		`SELECT id,tenant_id,workspace_id,normalized_domain,challenge_name,verification_status,generation,expires_at,created_at,updated_at
		 FROM nexora_domain_ownership_challenges
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3 AND idempotency_key=?4`
	).bind(scope.tenantId, scope.workspaceId, domain, idempotencyKey).first();
	return {
		challenge: row,
		dnsRecord: {
			type: 'TXT',
			name,
			value: `nexora-domain-verification=${token}`,
			expiresAt
		},
		redactionLevel: 'BODYLESS'
	};
}

async function resolveTxt(name, fetchImpl = fetch) {
	const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
		headers: { accept: 'application/dns-json' }
	});
	if (!response.ok) throw new Error('dns txt resolver unavailable');
	const body = await response.json();
	return (body.Answer || []).map((answer) => String(answer.data || '').replace(/^"|"$/g, '').replace(/"\s+"/g, ''));
}

async function verifyDnsChallenge(c, scopeInput, input, actor, fetchImpl = fetch) {
	const scope = assertScope(scopeInput);
	const domain = assertDomain(input?.domain);
	await workspaceAuthority(c, scope, actor);
	const challengeId = String(input?.challengeId || input?.challenge_id || '').trim();
	const expectedGeneration = Number(input?.expectedGeneration ?? input?.expected_generation);
	if (!challengeId) throw new Error('challengeId is required');
	if (!Number.isInteger(expectedGeneration) || expectedGeneration <= 0) throw new Error('expectedGeneration is required');
	const challenge = await c.env.db.prepare(
		`SELECT * FROM nexora_domain_ownership_challenges
		 WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND normalized_domain=?4
		  AND generation=?5 AND verification_status='pending' AND consumed_at IS NULL AND superseded_at IS NULL
		 LIMIT 1`
	).bind(challengeId, scope.tenantId, scope.workspaceId, domain, expectedGeneration).first();
	if (!challenge) throw new Error('pending domain ownership challenge is required');
	if (String(challenge.hmac_key_version || '') !== String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || '')) {
		throw new Error('domain ownership challenge HMAC key version continuity denied; issue a new challenge');
	}
	if (Date.parse(challenge.expires_at) <= Date.now()) {
		await c.env.db.prepare(
			`UPDATE nexora_domain_ownership_challenges SET verification_status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=?1`
		).bind(challenge.id).run();
		throw new Error('domain ownership challenge expired');
	}
	const answers = await resolveTxt(challenge.challenge_name, fetchImpl);
	let matched = false;
	for (const answer of answers) {
		const candidateHash = await deriveCorrelationRef(c.env, 'dns-txt-token', answer.replace(/^nexora-domain-verification=/, ''));
		if (candidateHash === challenge.challenge_token_hash) {
			matched = true;
			break;
		}
	}
	if (!matched) {
		await c.env.db.prepare(
			`UPDATE nexora_domain_ownership_challenges SET attempt=attempt+1,updated_at=CURRENT_TIMESTAMP
			 WHERE id=?1 AND generation=?2 AND verification_status='pending' AND consumed_at IS NULL`
		).bind(challenge.id, expectedGeneration).run();
		throw new Error('domain ownership txt record not verified');
	}
	const verificationEvidenceRef = await evidenceRef(c.env, scope, domain, challenge.id, challenge.challenge_token_hash);
	const verificationOperationId = String(input?.idempotencyKey || input?.idempotency_key || '').trim();
	if (!verificationOperationId) throw new Error('verification idempotencyKey is required');
	for (const field of ['authSessionRef', 'auth_session_ref', 'requestId', 'request_id', 'runtimeDeploymentId', 'runtime_deployment_id', 'acceptanceCorrelationRef', 'acceptance_correlation_ref']) {
		if (input?.[field] !== undefined) throw new Error('verification correlation is derived exclusively from server context');
	}
	const serverContext = await serverVerificationContext(c, scope, challenge.id, verificationOperationId);
	const existingDomain = await c.env.db.prepare(
		`SELECT workspace_id FROM workspace_domains WHERE lower(domain)=?1 LIMIT 1`
	).bind(domain).first();
	if (existingDomain && Number(existingDomain.workspace_id) !== scope.workspaceId) {
		throw new Error('domain is already bound to another workspace');
	}
	const statements = [c.env.db.prepare(
		`UPDATE nexora_domain_ownership_challenges
		 SET attempt=attempt+1,verification_status='verified',verification_evidence_ref=?3,
		  verification_operation_id=?4,verified_at=CURRENT_TIMESTAMP,consumed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
		 WHERE id=?1 AND generation=?2 AND verification_status='pending' AND consumed_at IS NULL AND superseded_at IS NULL`
	).bind(challenge.id, expectedGeneration, verificationEvidenceRef, verificationOperationId), c.env.db.prepare(
		`INSERT INTO workspace_domains(workspace_id,domain,provider,authority_state,lifecycle_state,health_state)
		 VALUES(?1,?2,'dns_txt','VERIFIED','READY','READY')
		 ON CONFLICT(domain) DO UPDATE SET
		  workspace_id=CASE WHEN workspace_domains.workspace_id=excluded.workspace_id THEN workspace_domains.workspace_id ELSE NULL END,
		  provider='dns_txt',
		  authority_state='VERIFIED',
		  lifecycle_state='READY',
		  health_state='READY',
		  updated_at=CURRENT_TIMESTAMP`
	).bind(scope.workspaceId, domain)];
	statements.push(c.env.db.prepare(
		`INSERT INTO nexora_domain_ownership_verification_events
		 (id,challenge_id,tenant_id,workspace_id,normalized_domain,generation,verification_operation_id,
		  verification_evidence_ref,actor_user_id,auth_session_ref,hmac_key_version,request_id,runtime_deployment_id,acceptance_correlation_ref,result,observed_at)
		 SELECT ?1,q.id,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'VERIFIED',CURRENT_TIMESTAMP
		 FROM (SELECT c.id FROM nexora_domain_ownership_challenges c
		  WHERE c.id=?2 AND c.tenant_id=?3 AND c.workspace_id=?4 AND c.generation=?6
		   AND c.verification_status='verified' AND c.consumed_at IS NOT NULL AND c.verification_operation_id=?7
		  UNION ALL SELECT NULL WHERE NOT EXISTS (
		   SELECT 1 FROM nexora_domain_ownership_challenges c WHERE c.id=?2 AND c.tenant_id=?3 AND c.workspace_id=?4
		    AND c.generation=?6 AND c.verification_status='verified' AND c.consumed_at IS NOT NULL AND c.verification_operation_id=?7
		  )) q`
	).bind(uuid(), challenge.id, scope.tenantId, scope.workspaceId, domain, expectedGeneration, verificationOperationId,
		verificationEvidenceRef, actor.userId, serverContext.authSessionRef, c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION,
		serverContext.requestId, serverContext.runtimeDeploymentId, serverContext.acceptanceCorrelationRef));
	statements.push(...auditStatements(c, scope, actor, domain, 'NEXORA_DOMAIN_OWNERSHIP_VERIFIED', challenge.id, { verificationStatus: 'verified', verificationMethod: 'DNS_TXT', verificationEvidenceRef, challengeId: challenge.id, generation: expectedGeneration }, verificationEvidenceRef));
	await c.env.db.batch(statements);
	const workspaceDomain = await c.env.db.prepare(
		`SELECT id,workspace_id,domain,provider,authority_state,lifecycle_state,health_state,created_at,updated_at
		 FROM workspace_domains WHERE workspace_id=?1 AND lower(domain)=?2 LIMIT 1`
	).bind(scope.workspaceId, domain).first();
	if (!workspaceDomain) throw new Error('domain ownership binding was not committed');
	return {
		workspaceDomain,
		verification: {
			method: 'DNS_TXT',
			verificationEvidenceRef,
			challengeId: challenge.id,
			generation: expectedGeneration,
			redactionLevel: 'BODYLESS'
		}
	};
}

export { PUBLIC_MAILBOX_DOMAINS, assertDomain, resolveTxt };
export default { createDnsChallenge, verifyDnsChallenge };
