import { v4 as uuid } from 'uuid';
import classificationService from './nexora-email-classification-service.mjs';

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
	const row = await c.env.db.prepare(
		`SELECT w.id,w.tenant_key,w.display_name,w.created_by_user_id,m.role
		 FROM workspaces w
		 JOIN workspace_members m ON m.workspace_id=w.id
		 WHERE w.id=?1 AND m.user_id=?2
		 LIMIT 1`
	).bind(scope.workspaceId, actor.userId).first();
	if (!row) throw new Error('workspace authority is required');
	return row;
}

async function findWorkspaceDomainEvidence(c, scope, domain) {
	const row = await c.env.db.prepare(
		`SELECT id,authority_state,lifecycle_state,health_state,created_at,updated_at
		 FROM workspace_domains
		 WHERE workspace_id=?1 AND lower(domain)=?2
		 LIMIT 1`
	).bind(scope.workspaceId, domain).first();
	if (!row) return null;
	if (!VERIFIED_WORKSPACE_DOMAIN_AUTHORITY_STATES.has(row.authority_state)) return null;
	return {
		kind: 'workspace_domain',
		sourceId: String(row.id),
		state: `${row.authority_state}:${row.lifecycle_state}:${row.health_state}`,
		detail: {
			authorityState: row.authority_state,
			lifecycleState: row.lifecycle_state,
			healthState: row.health_state,
			createdAt: row.created_at,
			updatedAt: row.updated_at
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

async function auditBootstrap(c, scope, actor, domain, authorityId, evidenceRef, evidence) {
	const metadata = JSON.stringify({
		authorityId,
		verificationEvidenceRef: evidenceRef,
		evidenceKind: evidence.kind,
		evidenceState: evidence.state,
		bodyPersisted: false
	});
	await c.env.db.batch([
		c.env.db.prepare(
			`INSERT INTO nexora_audit_events(user_id,domain,action,object_type,object_ref,outcome,metadata_json)
			 VALUES(?1,?2,'NEXORA_DOMAIN_AUTHORITY_BOOTSTRAPPED','nexora_domain_authority',?3,'VERIFIED',?4)`
		).bind(actor.userId, domain, authorityId, metadata),
		c.env.db.prepare(
			`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id)
			 VALUES(?1,?2,'NEXORA_DOMAIN_AUTHORITY_BOOTSTRAPPED','nexora_domain_authority',?3,'{}',?4,?5)`
		).bind(scope.workspaceId, actor.userId, authorityId, JSON.stringify({ verificationStatus: 'verified', evidenceRef, evidenceKind: evidence.kind }), evidenceRef)
	]);
}

async function bootstrapVerifiedDomainAuthority(c, scopeInput, input, actor) {
	const scope = assertScope(scopeInput);
	const domain = assertDomain(input?.domain || input?.customerDomain);
	await workspaceExists(c, scope, actor);
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
	const verificationEvidenceRef = input?.verificationEvidenceRef || evidenceRefFor(scope, domain, evidence, idempotencyKey);
	const administratorAuthorityRef = authorityRef(actor);
	const authorityId = uuid();
	await c.env.db.prepare(
		`INSERT INTO nexora_domain_authorities
		 (id,tenant_id,workspace_id,normalized_domain,verification_status,verification_method,verification_evidence_ref,administrator_authority_ref,generation)
		 VALUES(?1,?2,?3,?4,'verified','NEXORA_BOOTSTRAP_EXISTING_AUTHORITY',?5,?6,
		  COALESCE((SELECT generation+1 FROM nexora_domain_authorities WHERE tenant_id=?2 AND workspace_id=?3 AND normalized_domain=?4),1))
		 ON CONFLICT(tenant_id,workspace_id,normalized_domain) DO UPDATE SET
		  verification_status='verified',
		  verification_method='NEXORA_BOOTSTRAP_EXISTING_AUTHORITY',
		  verification_evidence_ref=excluded.verification_evidence_ref,
		  administrator_authority_ref=excluded.administrator_authority_ref,
		  revoked_at=NULL,
		  generation=excluded.generation,
		  updated_at=CURRENT_TIMESTAMP`
	).bind(
		authorityId,
		scope.tenantId,
		scope.workspaceId,
		domain,
		verificationEvidenceRef,
		administratorAuthorityRef
	).run();
	const row = await c.env.db.prepare(
		`SELECT id,tenant_id,workspace_id,normalized_domain,verification_status,verification_method,verification_evidence_ref,administrator_authority_ref,generation,created_at,updated_at
		 FROM nexora_domain_authorities
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3`
	).bind(scope.tenantId, scope.workspaceId, domain).first();
	await auditBootstrap(c, scope, actor, domain, row.id, verificationEvidenceRef, evidence);
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

export default { bootstrapVerifiedDomainAuthority };
