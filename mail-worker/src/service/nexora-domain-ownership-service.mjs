import { v4 as uuid } from 'uuid';
import classificationService from './nexora-email-classification-service.mjs';

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

function evidenceRef(scope, domain, challengeId, tokenHash) {
	return classificationService.stableFingerprint([
		'nexora-domain-ownership-dns-txt-v1',
		scope.tenantId,
		scope.workspaceId,
		domain,
		challengeId,
		tokenHash
	]);
}

async function workspaceAuthority(c, scope) {
	const row = await c.env.db.prepare(
		`SELECT w.id,w.tenant_key,w.display_name,m.role
		 FROM workspaces w
		 JOIN workspace_members m ON m.workspace_id=w.id
		 WHERE w.id=?1 AND m.user_id=?2
		 LIMIT 1`
	).bind(scope.workspaceId, scope.tenantId).first();
	if (!row) throw new Error('workspace authority is required');
	return row;
}

async function audit(c, scope, actor, domain, action, objectRef, afterState, requestId) {
	const metadata = JSON.stringify({ domain, action, bodyPersisted: false, redactionLevel: 'BODYLESS' });
	await c.env.db.batch([
		c.env.db.prepare(
			`INSERT INTO nexora_audit_events(user_id,domain,action,object_type,object_ref,outcome,metadata_json)
			 VALUES(?1,?2,?3,'domain_ownership',?4,'RECORDED',?5)`
		).bind(actor.userId, domain, action, objectRef, metadata),
		c.env.db.prepare(
			`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id)
			 VALUES(?1,?2,?3,'domain_ownership',?4,'{}',?5,?6)`
		).bind(scope.workspaceId, actor.userId, action, objectRef, JSON.stringify(afterState), requestId)
	]);
}

async function createDnsChallenge(c, scopeInput, input, actor) {
	const scope = assertScope(scopeInput);
	const domain = assertDomain(input?.domain);
	await workspaceAuthority(c, scope);
	const token = randomToken();
	const tokenHash = classificationService.stableFingerprint(['dns-txt-token', token]);
	const idempotencyKey = input?.idempotencyKey || classificationService.stableFingerprint([
		'nexora-domain-ownership-dns-challenge',
		scope.tenantId,
		scope.workspaceId,
		domain
	]);
	const id = uuid();
	const name = challengeName(domain);
	const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	await c.env.db.prepare(
		`INSERT INTO nexora_domain_ownership_challenges
		 (id,tenant_id,workspace_id,normalized_domain,challenge_name,challenge_token_hash,verification_status,administrator_authority_ref,idempotency_key,expires_at)
		 VALUES(?1,?2,?3,?4,?5,?6,'pending',?7,?8,?9)
		 ON CONFLICT(tenant_id,workspace_id,normalized_domain,idempotency_key) DO UPDATE SET
		  verification_status=CASE WHEN verification_status='verified' THEN verification_status ELSE 'pending' END,
		  challenge_name=excluded.challenge_name,
		  challenge_token_hash=excluded.challenge_token_hash,
		  administrator_authority_ref=excluded.administrator_authority_ref,
		  expires_at=excluded.expires_at,
		  updated_at=CURRENT_TIMESTAMP`
	).bind(id, scope.tenantId, scope.workspaceId, domain, name, tokenHash, authorityRef(actor), idempotencyKey, expiresAt).run();
	const row = await c.env.db.prepare(
		`SELECT id,tenant_id,workspace_id,normalized_domain,challenge_name,verification_status,expires_at,created_at,updated_at
		 FROM nexora_domain_ownership_challenges
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3 AND idempotency_key=?4`
	).bind(scope.tenantId, scope.workspaceId, domain, idempotencyKey).first();
	await audit(c, scope, actor, domain, 'NEXORA_DOMAIN_OWNERSHIP_CHALLENGE_CREATED', row.id, { verificationStatus: row.verification_status, challengeName: row.challenge_name, expiresAt: row.expires_at }, idempotencyKey);
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
	await workspaceAuthority(c, scope);
	const challenge = await c.env.db.prepare(
		`SELECT * FROM nexora_domain_ownership_challenges
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3 AND verification_status='pending'
		 ORDER BY created_at DESC LIMIT 1`
	).bind(scope.tenantId, scope.workspaceId, domain).first();
	if (!challenge) throw new Error('pending domain ownership challenge is required');
	if (Date.parse(challenge.expires_at) <= Date.now()) {
		await c.env.db.prepare(
			`UPDATE nexora_domain_ownership_challenges SET verification_status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=?1`
		).bind(challenge.id).run();
		throw new Error('domain ownership challenge expired');
	}
	const answers = await resolveTxt(challenge.challenge_name, fetchImpl);
	const matched = answers.some((answer) => classificationService.stableFingerprint(['dns-txt-token', answer.replace(/^nexora-domain-verification=/, '')]) === challenge.challenge_token_hash);
	await c.env.db.prepare(
		`UPDATE nexora_domain_ownership_challenges
		 SET attempt=attempt+1,verification_status=?2,verification_evidence_ref=CASE WHEN ?2='verified' THEN ?3 ELSE verification_evidence_ref END,verified_at=CASE WHEN ?2='verified' THEN CURRENT_TIMESTAMP ELSE verified_at END,updated_at=CURRENT_TIMESTAMP
		 WHERE id=?1 AND verification_status='pending'`
	).bind(challenge.id, matched ? 'verified' : 'failed', matched ? evidenceRef(scope, domain, challenge.id, challenge.challenge_token_hash) : null).run();
	if (!matched) throw new Error('domain ownership txt record not verified');
	const verificationEvidenceRef = evidenceRef(scope, domain, challenge.id, challenge.challenge_token_hash);
	await c.env.db.prepare(
		`INSERT INTO workspace_domains(workspace_id,domain,provider,authority_state,lifecycle_state,health_state)
		 VALUES(?1,?2,'dns_txt','VERIFIED','READY','READY')
		 ON CONFLICT(domain) DO UPDATE SET
		  workspace_id=excluded.workspace_id,
		  provider='dns_txt',
		  authority_state='VERIFIED',
		  lifecycle_state='READY',
		  health_state='READY',
		  updated_at=CURRENT_TIMESTAMP`
	).bind(scope.workspaceId, domain).run();
	const workspaceDomain = await c.env.db.prepare(
		`SELECT id,workspace_id,domain,provider,authority_state,lifecycle_state,health_state,created_at,updated_at
		 FROM workspace_domains WHERE workspace_id=?1 AND lower(domain)=?2 LIMIT 1`
	).bind(scope.workspaceId, domain).first();
	await audit(c, scope, actor, domain, 'NEXORA_DOMAIN_OWNERSHIP_VERIFIED', workspaceDomain.id, { verificationStatus: 'verified', verificationMethod: 'DNS_TXT', verificationEvidenceRef }, verificationEvidenceRef);
	return {
		workspaceDomain,
		verification: {
			method: 'DNS_TXT',
			verificationEvidenceRef,
			challengeId: challenge.id,
			redactionLevel: 'BODYLESS'
		}
	};
}

export { PUBLIC_MAILBOX_DOMAINS, assertDomain, resolveTxt };
export default { createDnsChallenge, verifyDnsChallenge };
