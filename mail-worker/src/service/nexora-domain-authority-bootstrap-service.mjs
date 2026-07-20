import { v4 as uuid } from 'uuid';
import classificationService from './nexora-email-classification-service.mjs';
import workspaceAuthorityService from './nexora-workspace-authority-service.mjs';

const READY_DOMAIN_STATES = new Set(['READY', 'PARTIAL_WITH_REAL_BLOCKER']);
const VERIFIED_WORKSPACE_DOMAIN_AUTHORITY_STATES = new Set(['VERIFIED', 'AUTHORITY_VERIFIED', 'DOMAIN_VERIFIED']);

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
	return domain;
}

function authorityRef(actor) {
	return `admin:${actor.userId}`;
}

function evidenceRefFor(scope, domain, evidence, idempotencyKey) {
	return classificationService.stableFingerprint([
		'nexora-domain-authority-bootstrap-v1',
		scope.tenantId,
		scope.workspaceId,
		domain,
		evidence.kind,
		evidence.state || null,
		evidence.sourceId || null,
		idempotencyKey || null
	]);
}

async function workspaceExists(c, scope, actor) {
	return workspaceAuthorityService.assertWorkspaceCapability(c, actor, scope.workspaceId, 'domain:write');
}

async function findWorkspaceDomainEvidence(c, scope, domain) {
	const row = await c.env.db.prepare(
		`SELECT d.id,d.authority_state,d.lifecycle_state,d.health_state,d.created_at,d.updated_at,
		  e.id AS verification_event_id,e.verification_evidence_ref,e.generation AS ownership_generation
		 FROM workspace_domains d
		 JOIN nexora_domain_ownership_verification_events e
		  ON e.workspace_id=d.workspace_id AND e.normalized_domain=lower(d.domain) AND e.result='VERIFIED'
		 WHERE d.workspace_id=?1 AND lower(d.domain)=?2
		 ORDER BY e.generation DESC,e.created_at DESC
		 LIMIT 1`
	).bind(scope.workspaceId, domain).first();
	if (!row) return null;
	if (!VERIFIED_WORKSPACE_DOMAIN_AUTHORITY_STATES.has(row.authority_state)) return null;
	return {
		kind: 'workspace_domain',
		sourceId: String(row.verification_event_id),
		verificationEvidenceRef: row.verification_evidence_ref,
		state: `${row.authority_state}:${row.lifecycle_state}:${row.health_state}`,
			detail: {
			authorityState: row.authority_state,
			lifecycleState: row.lifecycle_state,
			healthState: row.health_state,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			ownershipGeneration: Number(row.ownership_generation)
		}
	};
}

async function findCloudMailDomainEvidence(c, domain) {
	const row = await c.env.db.prepare(
		`SELECT id,provisioning_state,zone_status,linkage_state,created_at,updated_at
		 FROM cloudmail_domains
		 WHERE lower(domain)=?1
		 LIMIT 1`
	).bind(domain).first();
	if (!row || !READY_DOMAIN_STATES.has(row.provisioning_state)) return null;
	return {
		kind: 'cloudmail_domain',
		sourceId: String(row.id),
		state: `${row.provisioning_state}:${row.zone_status}:${row.linkage_state}`,
		detail: {
			provisioningState: row.provisioning_state,
			zoneStatus: row.zone_status,
			linkageState: row.linkage_state,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}
	};
}

async function findWorkspaceAccountEvidence(c, scope, domain) {
	const row = await c.env.db.prepare(
		`SELECT a.account_id,a.provider,a.sync_status,a.last_successful_sync_at,a.last_message_received_at
		 FROM account a
		 JOIN workspace_account_bindings b ON b.account_id=a.account_id
		 WHERE b.workspace_id=?1
		  AND a.user_id=?2
		  AND a.is_del=0
		  AND lower(COALESCE(NULLIF(a.domain,''), substr(a.email, instr(a.email,'@') + 1)))=?3
		 ORDER BY a.last_successful_sync_at DESC, a.create_time DESC
		 LIMIT 1`
	).bind(scope.workspaceId, scope.tenantId, domain).first();
	if (!row) return null;
	return {
		kind: 'workspace_account_binding',
		sourceId: String(row.account_id),
		state: `${row.provider}:${row.sync_status}`,
		detail: {
			provider: row.provider,
			syncStatus: row.sync_status,
			lastSuccessfulSyncAt: row.last_successful_sync_at,
			lastMessageReceivedAt: row.last_message_received_at
		}
	};
}

async function findEmailAggregateEvidence(c, scope, domain) {
	const row = await c.env.db.prepare(
		`SELECT COUNT(*) AS rows, MAX(create_time) AS latest
		 FROM email e
		 JOIN workspace_account_bindings b ON b.account_id=e.account_id
		 WHERE e.user_id=?1
		  AND b.workspace_id=?2
		  AND e.is_del=0
		  AND lower(COALESCE(NULLIF(e.account_domain,''), substr(e.account_email, instr(e.account_email,'@') + 1)))=?3`
	).bind(scope.tenantId, scope.workspaceId, domain).first();
	if (!row || Number(row.rows || 0) <= 0) return null;
	return {
		kind: 'email_aggregate',
		sourceId: null,
		state: `rows:${row.rows}`,
		detail: {
			rows: Number(row.rows || 0),
			latest: row.latest || null
		}
	};
}

async function resolveEvidence(c, scope, domain) {
	const workspaceDomain = await findWorkspaceDomainEvidence(c, scope, domain);
	if (!workspaceDomain) return null;
	const cloudMailDomain = await findCloudMailDomainEvidence(c, domain);
	const accountBinding = await findWorkspaceAccountEvidence(c, scope, domain);
	const emailAggregate = await findEmailAggregateEvidence(c, scope, domain);
	return {
		...workspaceDomain,
		detail: {
			...workspaceDomain.detail,
			supplemental: {
				cloudMailDomain: cloudMailDomain ? { state: cloudMailDomain.state, sourceId: cloudMailDomain.sourceId } : null,
				accountBinding: accountBinding ? { state: accountBinding.state, sourceId: accountBinding.sourceId } : null,
				emailAggregate: emailAggregate ? { state: emailAggregate.state, detail: emailAggregate.detail } : null
			}
		}
	};
}

function auditBootstrapStatements(c, scope, actor, domain, authorityId, evidenceRef, evidence, action = 'NEXORA_DOMAIN_AUTHORITY_BOOTSTRAPPED') {
	const metadata = JSON.stringify({
		authorityId,
		verificationEvidenceRef: evidenceRef,
		evidenceKind: evidence.kind,
		evidenceState: evidence.state,
		bodyPersisted: false
	});
	return [
		c.env.db.prepare(
			`INSERT INTO nexora_audit_events(user_id,domain,action,object_type,object_ref,outcome,metadata_json)
			 VALUES(?1,?2,?5,'nexora_domain_authority',?3,?6,?4)`
		).bind(actor.userId, domain, authorityId, metadata, action, action.endsWith('REVOKED') ? 'REVOKED' : 'VERIFIED'),
		c.env.db.prepare(
			`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id)
			 VALUES(?1,?2,?6,'nexora_domain_authority',?3,'{}',?4,?5)`
		).bind(scope.workspaceId, actor.userId, authorityId, JSON.stringify({ verificationStatus: action.endsWith('REVOKED') ? 'revoked' : 'verified', evidenceRef, evidenceKind: evidence.kind }), evidenceRef, action)
	];
}

function conditionalRevocationAuditStatements(c, scope, actor, domain, authorityId, evidenceRef, evidence, expectedGeneration) {
	const action = 'NEXORA_DOMAIN_AUTHORITY_REVOKED';
	const metadata = JSON.stringify({ authorityId, verificationEvidenceRef: evidenceRef, evidenceKind: evidence.kind, evidenceState: evidence.state, bodyPersisted: false });
	return [
		c.env.db.prepare(
			`INSERT INTO nexora_audit_events(user_id,domain,action,object_type,object_ref,outcome,metadata_json)
			 SELECT ?1,?2,?3,'nexora_domain_authority',a.id,'REVOKED',?4
			 FROM nexora_domain_authorities a WHERE a.id=?5 AND a.tenant_id=?6 AND a.workspace_id=?7
			  AND a.generation=?8 AND a.verification_status='revoked' AND a.revoked_at IS NOT NULL AND a.verification_evidence_ref=?9`
		).bind(actor.userId, domain, action, metadata, authorityId, scope.tenantId, scope.workspaceId, expectedGeneration + 1, evidenceRef),
		c.env.db.prepare(
			`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id)
			 SELECT ?1,?2,?3,'nexora_domain_authority',a.id,'{}',?4,?5
			 FROM nexora_domain_authorities a WHERE a.id=?6 AND a.tenant_id=?7 AND a.workspace_id=?1
			  AND a.generation=?8 AND a.verification_status='revoked' AND a.revoked_at IS NOT NULL AND a.verification_evidence_ref=?5`
		).bind(scope.workspaceId, actor.userId, action, JSON.stringify({ verificationStatus: 'revoked', evidenceRef, evidenceKind: evidence.kind }), evidenceRef, authorityId, scope.tenantId, expectedGeneration + 1)
	];
}

async function bootstrapVerifiedDomainAuthority(c, scopeInput, input, actor) {
	const scope = assertScope(scopeInput);
	const domain = assertDomain(input?.domain || input?.customerDomain);
	await workspaceExists(c, scope, actor);
	const existing = await c.env.db.prepare(
		`SELECT id,generation,verification_status,revoked_at FROM nexora_domain_authorities
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3`
	).bind(scope.tenantId, scope.workspaceId, domain).first();
	if (existing?.revoked_at || existing?.verification_status === 'revoked') throw new Error('revoked domain authority requires explicit re-verification');
	const evidence = await resolveEvidence(c, scope, domain);
	if (!evidence) throw new Error('domain bootstrap evidence is required');
	const idempotencyKey = input?.idempotencyKey || classificationService.stableFingerprint([
		'nexora-domain-authority-bootstrap',
		scope.tenantId,
		scope.workspaceId,
		domain,
		evidence.kind,
		evidence.sourceId || null
	]);
	if (input?.verificationEvidenceRef || input?.verification_evidence_ref) throw new Error('verification evidence is derived exclusively from server authority');
	const verificationEvidenceRef = evidence.verificationEvidenceRef;
	const administratorAuthorityRef = authorityRef(actor);
	const authorityId = uuid();
	const statements = [c.env.db.prepare(
		`INSERT INTO nexora_domain_authorities
		 (id,tenant_id,workspace_id,normalized_domain,verification_status,verification_method,verification_evidence_ref,administrator_authority_ref,generation)
		 VALUES(?1,?2,?3,?4,'verified','NEXORA_BOOTSTRAP_EXISTING_AUTHORITY',?5,?6,
		  COALESCE((SELECT generation+1 FROM nexora_domain_authorities WHERE tenant_id=?2 AND workspace_id=?3 AND normalized_domain=?4),1))
		 ON CONFLICT(tenant_id,workspace_id,normalized_domain) DO UPDATE SET
		  verification_status='verified',
		  verification_method='NEXORA_BOOTSTRAP_EXISTING_AUTHORITY',
		  verification_evidence_ref=excluded.verification_evidence_ref,
		  administrator_authority_ref=excluded.administrator_authority_ref,
		  generation=excluded.generation,
		  updated_at=CURRENT_TIMESTAMP
		 WHERE nexora_domain_authorities.revoked_at IS NULL AND nexora_domain_authorities.verification_status!='revoked'`
	).bind(
		authorityId,
		scope.tenantId,
		scope.workspaceId,
		domain,
		verificationEvidenceRef,
		administratorAuthorityRef
	)];
	const persistedAuthorityId = existing?.id || authorityId;
	statements.push(...auditBootstrapStatements(c, scope, actor, domain, persistedAuthorityId, verificationEvidenceRef, evidence));
	await c.env.db.batch(statements);
	const row = await c.env.db.prepare(
		`SELECT id,tenant_id,workspace_id,normalized_domain,verification_status,verification_method,verification_evidence_ref,administrator_authority_ref,generation,revoked_at,created_at,updated_at
		 FROM nexora_domain_authorities
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3`
	).bind(scope.tenantId, scope.workspaceId, domain).first();
	if (!row || row.revoked_at || row.verification_status !== 'verified') throw new Error('domain authority bootstrap was not committed');
	return {
		authority: row,
		evidence: {
			kind: evidence.kind,
			state: evidence.state,
			verificationEvidenceRef,
			redactionLevel: 'BODYLESS'
		}
	};
}

async function revokeDomainAuthority(c, scopeInput, input, actor) {
	const scope = assertScope(scopeInput);
	const domain = assertDomain(input?.domain || input?.customerDomain);
	await workspaceExists(c, scope, actor);
	const expectedGeneration = Number(input?.expectedGeneration ?? input?.expected_generation);
	if (!Number.isInteger(expectedGeneration) || expectedGeneration <= 0) throw new Error('expectedGeneration is required');
	const idempotencyKey = String(input?.idempotencyKey || input?.idempotency_key || '').trim();
	if (!idempotencyKey) throw new Error('idempotencyKey is required');
	const authority = await c.env.db.prepare(
		`SELECT id,generation,verification_status,revoked_at FROM nexora_domain_authorities
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3`
	).bind(scope.tenantId, scope.workspaceId, domain).first();
	if (!authority) throw new Error('domain authority is required');
	if (authority.revoked_at || authority.verification_status === 'revoked') {
		const replayEvidenceRef = classificationService.stableFingerprint(['nexora-domain-authority-revocation-v1', scope.tenantId, scope.workspaceId, domain, authority.id, expectedGeneration, idempotencyKey]);
		const recorded = await c.env.db.prepare(
			`SELECT object_ref FROM workspace_audit_events WHERE workspace_id=?1 AND action='NEXORA_DOMAIN_AUTHORITY_REVOKED'
			 AND object_ref=?2 AND request_id=?3 LIMIT 1`
		).bind(scope.workspaceId, authority.id, replayEvidenceRef).first();
		if (Number(authority.generation) === expectedGeneration + 1 && recorded) return { authority, evidence: { verificationEvidenceRef: replayEvidenceRef, redactionLevel: 'BODYLESS' }, idempotent: true };
		throw new Error('domain authority is already revoked');
	}
	if (Number(authority.generation) !== expectedGeneration) throw new Error('domain authority generation conflict');
	const evidence = { kind: 'domain_authority_revocation', state: `revoked:${expectedGeneration + 1}` };
	const evidenceRef = classificationService.stableFingerprint(['nexora-domain-authority-revocation-v1', scope.tenantId, scope.workspaceId, domain, authority.id, expectedGeneration, idempotencyKey]);
	const results = await c.env.db.batch([
		c.env.db.prepare(
			`UPDATE nexora_domain_authorities SET verification_status='revoked',revoked_at=CURRENT_TIMESTAMP,
			 generation=generation+1,verification_evidence_ref=?5,updated_at=CURRENT_TIMESTAMP
			 WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND generation=?4
			  AND verification_status='verified' AND revoked_at IS NULL`
		).bind(authority.id, scope.tenantId, scope.workspaceId, expectedGeneration, evidenceRef),
		c.env.db.prepare(
			`UPDATE workspace_domains SET authority_state='REVOKED',lifecycle_state='BLOCKED',health_state='BLOCKED',updated_at=CURRENT_TIMESTAMP
			 WHERE workspace_id=?1 AND lower(domain)=?2 AND authority_state='VERIFIED'
			  AND EXISTS (SELECT 1 FROM nexora_domain_authorities a WHERE a.id=?3 AND a.tenant_id=?4 AND a.workspace_id=?1
			   AND a.generation=?5 AND a.verification_status='revoked' AND a.revoked_at IS NOT NULL AND a.verification_evidence_ref=?6)`
		).bind(scope.workspaceId, domain, authority.id, scope.tenantId, expectedGeneration + 1, evidenceRef),
		...conditionalRevocationAuditStatements(c, scope, actor, domain, authority.id, evidenceRef, evidence, expectedGeneration)
	]);
	if (Number(results[0]?.meta?.changes || 0) !== 1) throw new Error('domain authority generation conflict');
	const row = await c.env.db.prepare(
		`SELECT id,tenant_id,workspace_id,normalized_domain,verification_status,verification_method,verification_evidence_ref,administrator_authority_ref,generation,revoked_at,created_at,updated_at
		 FROM nexora_domain_authorities WHERE id=?1`
	).bind(authority.id).first();
	if (!row?.revoked_at || row.verification_status !== 'revoked' || Number(row.generation) !== expectedGeneration + 1) throw new Error('domain authority revocation was not committed');
	return { authority: row, evidence: { verificationEvidenceRef: evidenceRef, redactionLevel: 'BODYLESS' }, idempotent: false };
}

export default { bootstrapVerifiedDomainAuthority, revokeDomainAuthority };
