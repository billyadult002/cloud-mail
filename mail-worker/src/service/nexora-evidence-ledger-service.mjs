const encoder = new TextEncoder();
const HEX_64 = /^[a-f0-9]{64}$/;
const SENSITIVE_EVIDENCE_KEYS = new Set([
	'body', 'text', 'snippet', 'subject', 'headers', 'accesstoken', 'access_token',
	'refreshtoken', 'refresh_token', 'cookie', 'sessioncookie', 'session_cookie',
	'authorization', 'pkceverifier', 'pkce_verifier', 'clientsecret', 'client_secret'
]);

function normalizeCanonical(value, inArray = false) {
	if (value === undefined) return inArray ? null : undefined;
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('canonical value must contain finite numbers');
		return value;
	}
	if (Array.isArray(value)) return value.map((item) => normalizeCanonical(item, true));
	if (typeof value === 'object') {
		const normalized = {};
		for (const key of Object.keys(value).sort()) {
			const item = normalizeCanonical(value[key], false);
			if (item !== undefined) normalized[key] = item;
		}
		return normalized;
	}
	throw new Error('canonical value contains an unsupported type');
}

export function canonicalize(value) {
	if (value === undefined) throw new Error('canonical input is required');
	return JSON.stringify(normalizeCanonical(value));
}

export async function sha256Hex(value) {
	if (value === undefined) throw new Error('digest input is required');
	const bytes = encoder.encode(typeof value === 'string' ? value : canonicalize(value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function integrityInput(run, event) {
	return {
		scope: { tenantId: Number(run.tenantId), workspaceId: Number(run.workspaceId) },
		authority: {
			id: run.domainAuthorityId,
			generation: Number(run.authorityGeneration),
			evidenceRef: run.authorityEvidenceRef
		},
		actor: { userId: Number(run.actorUserId), authSessionRef: run.authSessionRef, hmacKeyVersion: run.hmacKeyVersion },
		runtime: {
			requestId: run.requestId,
			deploymentId: run.runtimeDeploymentId,
			acceptanceCorrelationRef: run.acceptanceCorrelationRef,
			clientKind: run.clientKind
		},
		account: { canonicalAccountId: Number(run.canonicalAccountId), providerAccountHash: run.providerAccountHash },
		message: {
			customerDomain: event.customerDomain,
			provider: event.provider,
			canonicalMessageId: String(event.canonicalMessageId),
			messageFingerprint: event.messageFingerprint,
			sourceCreatedAt: event.sourceCreatedAt,
			provenanceRef: event.provenanceRef
		},
		classifier: { version: run.classifierVersion, rulesVersion: run.rulesVersion, modelVersion: run.modelVersion || null }
	};
}

function integrityDecision(run, event) {
	return {
		classificationId: event.classificationId,
		generation: Number(event.generation),
		identity: integrityInput(run, event).message,
		primaryCategory: event.primaryCategory,
		vipRelationship: Boolean(event.vipRelationship),
		priorityLevel: event.priorityLevel,
		requiresAction: Boolean(event.requiresAction),
		timeSensitive: Boolean(event.timeSensitive),
		unread: Boolean(event.unread),
		starred: Boolean(event.starred),
		hasAttachment: Boolean(event.hasAttachment),
		confidence: Number(event.confidence),
		reasonCodes: JSON.parse(event.reasonCodesJson),
		conflictingSignals: JSON.parse(event.conflictingSignalsJson),
		authoritySource: event.authoritySource,
		vipAuthorityRef: event.vipAuthorityRef || null,
		userOverrideRef: event.userOverrideRef || null,
		administratorOverrideRef: event.administratorOverrideRef || null
	};
}

export async function computeEvidenceIntegrity(input) {
	const { run = {}, event = {}, evidence = {}, head = {} } = input || {};
	const payload = JSON.parse(required(evidence.canonicalPayloadJson, 'evidence.canonicalPayloadJson'));
	assertBodylessEvidence(payload);
	const canonicalPayloadJson = canonicalize(payload);
	if (canonicalPayloadJson !== evidence.canonicalPayloadJson) throw new Error('evidence payload must use canonical JSON');
	const inputDigest = await sha256Hex(integrityInput(run, event));
	const decisionDigest = await sha256Hex(integrityDecision(run, event));
	const payloadDigest = await sha256Hex(canonicalPayloadJson);
	const entryDigest = await sha256Hex({
		run: integrityInput(run, event),
		event: {
			id: event.id,
			classificationId: event.classificationId,
			generation: Number(event.generation),
			previousEventId: event.previousEventId || null,
			previousEntryDigest: event.previousEntryDigest || null,
			decisionDigest
		},
		evidence: {
			id: event.evidenceId,
			payloadDigest,
			observedAt: evidence.observedAt,
			redactionLevel: 'BODYLESS',
			bodyPersisted: false
		},
		head: {
			expectedGeneration: Number(head.expectedGeneration),
			expectedEntryDigest: head.expectedEntryDigest || null
		}
	});
	return { inputDigest, decisionDigest, payloadDigest, entryDigest, canonicalPayloadJson };
}

function required(value, name) {
	if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
	return value;
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
	return number;
}

function booleanInteger(value) {
	return value ? 1 : 0;
}

function digest(value, name) {
	if (!HEX_64.test(String(value || ''))) throw new Error(`${name} must be a lowercase SHA-256 digest`);
	return value;
}

function assertBodylessEvidence(value) {
	if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('evidence payload must be an object');
	if (value.bodyPersisted !== false) throw new Error('evidence bodyPersisted must be false');
	const visit = (candidate) => {
		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item);
			return;
		}
		if (!candidate || typeof candidate !== 'object') return;
		for (const [key, item] of Object.entries(candidate)) {
			if (SENSITIVE_EVIDENCE_KEYS.has(key.toLowerCase())) throw new Error(`sensitive evidence key is forbidden: ${key}`);
			visit(item);
		}
	};
	visit(value);
}

function validateInput(input) {
	const { run = {}, event = {}, evidence = {}, head = {} } = input || {};
	positiveInteger(run.tenantId, 'run.tenantId');
	positiveInteger(run.workspaceId, 'run.workspaceId');
	positiveInteger(run.actorUserId, 'run.actorUserId');
	positiveInteger(run.canonicalAccountId, 'run.canonicalAccountId');
	positiveInteger(run.authorityGeneration, 'run.authorityGeneration');
	positiveInteger(event.generation, 'event.generation');
	for (const [name, value] of Object.entries({
		'run.id': run.id,
		'run.domainAuthorityId': run.domainAuthorityId,
		'run.authorityEvidenceRef': run.authorityEvidenceRef,
		'run.authSessionRef': run.authSessionRef,
		'run.hmacKeyVersion': run.hmacKeyVersion,
		'run.providerAccountHash': run.providerAccountHash,
		'run.requestId': run.requestId,
		'run.runtimeDeploymentId': run.runtimeDeploymentId,
		'run.acceptanceCorrelationRef': run.acceptanceCorrelationRef,
		'run.clientKind': run.clientKind,
		'run.classifierVersion': run.classifierVersion,
		'run.rulesVersion': run.rulesVersion,
		'run.idempotencyKey': run.idempotencyKey,
		'run.startedAt': run.startedAt,
		'event.id': event.id,
		'event.classificationId': event.classificationId,
		'event.customerDomain': event.customerDomain,
		'event.provider': event.provider,
		'event.canonicalMessageId': event.canonicalMessageId,
		'event.messageFingerprint': event.messageFingerprint,
		'event.sourceCreatedAt': event.sourceCreatedAt,
		'event.provenanceRef': event.provenanceRef,
		'event.primaryCategory': event.primaryCategory,
		'event.priorityLevel': event.priorityLevel,
		'event.authoritySource': event.authoritySource,
		'event.evidenceId': event.evidenceId,
		'event.idempotencyKey': event.idempotencyKey,
		'event.classifiedAt': event.classifiedAt,
		'evidence.canonicalPayloadJson': evidence.canonicalPayloadJson,
		'evidence.observedAt': evidence.observedAt
	})) required(value, name);
	if (!['DESKTOP', 'IOS_PHYSICAL', 'SERVICE'].includes(run.clientKind)) throw new Error('run.clientKind is invalid');
	digest(run.inputDigest, 'run.inputDigest');
	digest(event.decisionDigest, 'event.decisionDigest');
	digest(evidence.payloadDigest, 'evidence.payloadDigest');
	digest(evidence.entryDigest, 'evidence.entryDigest');
	if (!Number.isInteger(Number(head.expectedGeneration)) || Number(head.expectedGeneration) < 0) throw new Error('head.expectedGeneration must be a non-negative integer');
	if (event.generation !== Number(head.expectedGeneration) + 1) throw new Error('event.generation must advance the ledger head by one');
	if ((event.previousEntryDigest || null) !== (head.expectedEntryDigest || null)) throw new Error('event.previousEntryDigest must match the expected ledger head');
	if (event.generation === 1 && (event.previousEventId || event.previousEntryDigest)) throw new Error('first event must use the genesis lineage');
	if (event.generation > 1 && (!event.previousEventId || !event.previousEntryDigest)) throw new Error('successor event must reference its predecessor');
	JSON.parse(event.reasonCodesJson);
	JSON.parse(event.conflictingSignalsJson);
	assertBodylessEvidence(JSON.parse(evidence.canonicalPayloadJson));
	return { run, event, evidence, head };
}

export function buildAtomicLedgerStatements(db, input) {
	if (!db?.prepare) throw new Error('D1 database is required');
	const { run, event, evidence, head } = validateInput(input);
	const identity = [run.tenantId, run.workspaceId, event.customerDomain, event.provider, run.canonicalAccountId, event.canonicalMessageId];
	return [
		db.prepare(`INSERT OR IGNORE INTO nexora_classification_ledger_heads
		 (tenant_id,workspace_id,customer_domain,provider,canonical_account_id,canonical_message_id)
		 VALUES(?1,?2,?3,?4,?5,?6)`).bind(...identity),
		db.prepare(`UPDATE nexora_classification_ledger_heads
		 SET latest_generation=?7,latest_event_id=?8,latest_evidence_id=?9,latest_entry_digest=?10,updated_at=?11
		 WHERE tenant_id=?1 AND workspace_id=?2 AND customer_domain=?3 AND provider=?4 AND canonical_account_id=?5 AND canonical_message_id=?6
		  AND latest_generation=?12 AND latest_entry_digest IS ?13`).bind(
			...identity, event.generation, event.id, event.evidenceId, evidence.entryDigest, event.classifiedAt,
			Number(head.expectedGeneration), head.expectedEntryDigest || null
		),
		db.prepare(`INSERT INTO nexora_classification_runs
		 (id,tenant_id,workspace_id,domain_authority_id,authority_generation,authority_evidence_ref,actor_user_id,auth_session_ref,hmac_key_version,canonical_account_id,provider_account_hash,request_id,runtime_deployment_id,acceptance_correlation_ref,client_kind,classifier_version,rules_version,model_version,input_digest,idempotency_key,status,started_at,completed_at)
		 SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,'COMPLETED',?21,?22 WHERE changes()=1`).bind(
			run.id, run.tenantId, run.workspaceId, run.domainAuthorityId, run.authorityGeneration,
			run.authorityEvidenceRef, run.actorUserId, run.authSessionRef, run.hmacKeyVersion, run.canonicalAccountId,
			run.providerAccountHash, run.requestId, run.runtimeDeploymentId, run.acceptanceCorrelationRef,
			run.clientKind, run.classifierVersion, run.rulesVersion, run.modelVersion || null, run.inputDigest,
			run.idempotencyKey, run.startedAt, event.classifiedAt
		),
		db.prepare(`INSERT INTO nexora_email_classification_events
		 (id,run_id,classification_id,tenant_id,workspace_id,customer_domain,provider,provider_account_hash,canonical_account_id,canonical_message_id,message_fingerprint,source_created_at,provenance_ref,generation,previous_event_id,previous_entry_digest,primary_category,vip_relationship,priority_level,requires_action,time_sensitive,unread,starred,has_attachment,confidence,reason_codes_json,conflicting_signals_json,authority_source,vip_authority_ref,user_override_ref,administrator_override_ref,decision_digest,evidence_id,idempotency_key,classified_at)
		 SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35
		 WHERE EXISTS(SELECT 1 FROM nexora_classification_runs WHERE id=?2)`).bind(
			event.id, run.id, event.classificationId, run.tenantId, run.workspaceId, event.customerDomain,
			event.provider, run.providerAccountHash, run.canonicalAccountId, event.canonicalMessageId,
			event.messageFingerprint, event.sourceCreatedAt, event.provenanceRef, event.generation,
			event.previousEventId || null, event.previousEntryDigest || null, event.primaryCategory,
			booleanInteger(event.vipRelationship), event.priorityLevel, booleanInteger(event.requiresAction),
			booleanInteger(event.timeSensitive), booleanInteger(event.unread), booleanInteger(event.starred),
			booleanInteger(event.hasAttachment), Number(event.confidence), event.reasonCodesJson,
			event.conflictingSignalsJson, event.authoritySource, event.vipAuthorityRef || null,
			event.userOverrideRef || null, event.administratorOverrideRef || null, event.decisionDigest, event.evidenceId,
			event.idempotencyKey, event.classifiedAt
		),
		db.prepare(`INSERT INTO nexora_email_classification_evidence_v2
		 (id,event_id,run_id,classification_id,tenant_id,workspace_id,customer_domain,provider,provider_account_hash,canonical_account_id,canonical_message_id,message_fingerprint,source_created_at,provenance_ref,generation,evidence_kind,canonical_payload_json,payload_digest,previous_entry_digest,entry_digest,redaction_level,body_persisted,observed_at)
		 SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'CLASSIFICATION_DECISION',?16,?17,?18,?19,'BODYLESS',0,?20
		 WHERE EXISTS(SELECT 1 FROM nexora_email_classification_events WHERE id=?2 AND evidence_id=?1)`).bind(
			event.evidenceId, event.id, run.id, event.classificationId, run.tenantId, run.workspaceId,
			event.customerDomain, event.provider, run.providerAccountHash, run.canonicalAccountId,
			event.canonicalMessageId, event.messageFingerprint, event.sourceCreatedAt, event.provenanceRef,
			event.generation, evidence.canonicalPayloadJson, evidence.payloadDigest,
			event.previousEntryDigest || null, evidence.entryDigest, evidence.observedAt
		),
		db.prepare(`INSERT INTO nexora_email_classifications
		 (id,tenant_id,workspace_id,provider,provider_account_hash,customer_domain,message_fingerprint,thread_fingerprint,primary_category,vip_relationship,priority_level,requires_action,time_sensitive,unread,starred,has_attachment,confidence,reason_codes_json,conflicting_signals_json,classifier_version,rules_version,model_version,authority_source,vip_authority_ref,user_override_ref,administrator_override_ref,evidence_ref,idempotency_key,generation,classified_at,updated_at,current_event_id,current_evidence_id,canonical_message_id,canonical_account_id,source_created_at,provenance_ref)
		 SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?30,?31,?32,?33,?34,?35,?36
		 WHERE EXISTS(SELECT 1 FROM nexora_email_classification_evidence_v2 WHERE id=?32 AND event_id=?31)
		 ON CONFLICT(tenant_id,workspace_id,customer_domain,provider,provider_account_hash,message_fingerprint) DO UPDATE SET
		 primary_category=excluded.primary_category,vip_relationship=excluded.vip_relationship,priority_level=excluded.priority_level,
		 requires_action=excluded.requires_action,time_sensitive=excluded.time_sensitive,unread=excluded.unread,starred=excluded.starred,
		 has_attachment=excluded.has_attachment,confidence=excluded.confidence,reason_codes_json=excluded.reason_codes_json,
		 conflicting_signals_json=excluded.conflicting_signals_json,classifier_version=excluded.classifier_version,
		 rules_version=excluded.rules_version,model_version=excluded.model_version,authority_source=excluded.authority_source,
		 evidence_ref=excluded.evidence_ref,idempotency_key=excluded.idempotency_key,generation=excluded.generation,
		 classified_at=excluded.classified_at,updated_at=excluded.updated_at,current_event_id=excluded.current_event_id,
		 current_evidence_id=excluded.current_evidence_id,canonical_message_id=excluded.canonical_message_id,
		 canonical_account_id=excluded.canonical_account_id,source_created_at=excluded.source_created_at,provenance_ref=excluded.provenance_ref`).bind(
			event.classificationId, run.tenantId, run.workspaceId, event.provider, run.providerAccountHash,
			event.customerDomain, event.messageFingerprint, event.threadFingerprint || null, event.primaryCategory,
			booleanInteger(event.vipRelationship), event.priorityLevel, booleanInteger(event.requiresAction),
			booleanInteger(event.timeSensitive), booleanInteger(event.unread), booleanInteger(event.starred),
			booleanInteger(event.hasAttachment), Number(event.confidence), event.reasonCodesJson,
			event.conflictingSignalsJson, run.classifierVersion, run.rulesVersion, run.modelVersion || null,
			event.authoritySource, event.vipAuthorityRef || null, event.userOverrideRef || null,
			event.administratorOverrideRef || null, evidence.entryDigest, event.idempotencyKey, event.generation,
			event.classifiedAt, event.id, event.evidenceId, event.canonicalMessageId, run.canonicalAccountId,
			event.sourceCreatedAt, event.provenanceRef
		)
	];
}

export async function readEvidenceChain(db, identity) {
	if (!db?.prepare) throw new Error('D1 database is required');
	const tenantId = positiveInteger(identity?.tenantId, 'identity.tenantId');
	const workspaceId = positiveInteger(identity?.workspaceId, 'identity.workspaceId');
	const canonicalAccountId = positiveInteger(identity?.canonicalAccountId, 'identity.canonicalAccountId');
	const customerDomain = required(identity?.customerDomain, 'identity.customerDomain');
	const provider = required(identity?.provider, 'identity.provider');
	const canonicalMessageId = required(identity?.canonicalMessageId, 'identity.canonicalMessageId');
	const bindings = [tenantId, workspaceId, customerDomain, provider, canonicalAccountId, canonicalMessageId];
	const rows = await db.prepare(`SELECT
	 e.id AS event_id,e.run_id,e.classification_id,e.tenant_id,e.workspace_id,e.customer_domain,e.provider,
	 e.provider_account_hash,e.canonical_account_id,e.canonical_message_id,e.message_fingerprint,e.source_created_at,
	 e.provenance_ref,e.generation,e.previous_event_id,e.previous_entry_digest,e.primary_category,e.vip_relationship,
	 e.priority_level,e.requires_action,e.time_sensitive,e.unread,e.starred,e.has_attachment,e.confidence,
	 e.reason_codes_json,e.conflicting_signals_json,e.authority_source,e.vip_authority_ref,e.user_override_ref,
	 e.administrator_override_ref,e.decision_digest,e.evidence_id,e.idempotency_key AS event_idempotency_key,e.classified_at,
	 v.canonical_payload_json,v.payload_digest,v.previous_entry_digest AS evidence_previous_entry_digest,v.entry_digest,
	 v.redaction_level,v.body_persisted,v.observed_at,v.created_at AS evidence_created_at,
	 v.tenant_id AS evidence_tenant_id,v.workspace_id AS evidence_workspace_id,v.customer_domain AS evidence_customer_domain,
	 v.provider AS evidence_provider,v.provider_account_hash AS evidence_provider_account_hash,
	 v.canonical_account_id AS evidence_canonical_account_id,v.canonical_message_id AS evidence_canonical_message_id,
	 v.message_fingerprint AS evidence_message_fingerprint,v.source_created_at AS evidence_source_created_at,
	 v.provenance_ref AS evidence_provenance_ref,v.generation AS evidence_generation,v.classification_id AS evidence_classification_id,
	 r.domain_authority_id,r.authority_generation,r.authority_evidence_ref,r.actor_user_id,r.auth_session_ref,r.hmac_key_version,
	 r.canonical_account_id AS run_canonical_account_id,r.provider_account_hash AS run_provider_account_hash,
	 r.request_id,r.runtime_deployment_id,r.acceptance_correlation_ref,r.client_kind,r.classifier_version,r.rules_version,
	 r.model_version,r.input_digest,r.idempotency_key AS run_idempotency_key,r.status AS run_status,r.started_at,r.completed_at
	 FROM nexora_email_classification_events e
	 JOIN nexora_email_classification_evidence_v2 v ON v.event_id=e.id AND v.run_id=e.run_id AND v.classification_id=e.classification_id
	 JOIN nexora_classification_runs r ON r.id=e.run_id AND r.tenant_id=e.tenant_id AND r.workspace_id=e.workspace_id
	 WHERE e.tenant_id=?1 AND e.workspace_id=?2 AND e.customer_domain=?3 AND e.provider=?4
	  AND e.canonical_account_id=?5 AND e.canonical_message_id=?6
	 ORDER BY e.generation ASC`).bind(...bindings).all();
	const head = await db.prepare(`SELECT latest_generation,latest_event_id,latest_evidence_id,latest_entry_digest,updated_at
	 FROM nexora_classification_ledger_heads
	 WHERE tenant_id=?1 AND workspace_id=?2 AND customer_domain=?3 AND provider=?4
	  AND canonical_account_id=?5 AND canonical_message_id=?6`).bind(...bindings).first();
	return { entries: rows.results || [], head: head || null };
}

function rowToIntegrityInput(row) {
	return {
		run: {
			tenantId: row.tenant_id, workspaceId: row.workspace_id, domainAuthorityId: row.domain_authority_id,
			authorityGeneration: row.authority_generation, authorityEvidenceRef: row.authority_evidence_ref,
			actorUserId: row.actor_user_id, authSessionRef: row.auth_session_ref, hmacKeyVersion: row.hmac_key_version,
			canonicalAccountId: row.run_canonical_account_id, providerAccountHash: row.run_provider_account_hash,
			requestId: row.request_id, runtimeDeploymentId: row.runtime_deployment_id,
			acceptanceCorrelationRef: row.acceptance_correlation_ref, clientKind: row.client_kind,
			classifierVersion: row.classifier_version, rulesVersion: row.rules_version, modelVersion: row.model_version
		},
		event: {
			id: row.event_id, classificationId: row.classification_id, customerDomain: row.customer_domain,
			provider: row.provider, canonicalMessageId: row.canonical_message_id,
			messageFingerprint: row.message_fingerprint, sourceCreatedAt: row.source_created_at,
			provenanceRef: row.provenance_ref, generation: Number(row.generation),
			previousEventId: row.previous_event_id, previousEntryDigest: row.previous_entry_digest,
			primaryCategory: row.primary_category, vipRelationship: Boolean(row.vip_relationship),
			priorityLevel: row.priority_level, requiresAction: Boolean(row.requires_action),
			timeSensitive: Boolean(row.time_sensitive), unread: Boolean(row.unread), starred: Boolean(row.starred),
			hasAttachment: Boolean(row.has_attachment), confidence: Number(row.confidence),
			reasonCodesJson: row.reason_codes_json, conflictingSignalsJson: row.conflicting_signals_json,
			authoritySource: row.authority_source, vipAuthorityRef: row.vip_authority_ref,
			userOverrideRef: row.user_override_ref, administratorOverrideRef: row.administrator_override_ref,
			evidenceId: row.evidence_id
		},
		evidence: { canonicalPayloadJson: row.canonical_payload_json, observedAt: row.observed_at },
		head: { expectedGeneration: Number(row.generation) - 1, expectedEntryDigest: row.previous_entry_digest || null }
	};
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) throw new Error(`classification evidence integrity mismatch: ${label}`);
}

export async function verifyEvidenceChain(db, identity) {
	const chain = await readEvidenceChain(db, identity);
	if (!chain.head) throw new Error('classification evidence integrity mismatch: ledger head missing');
	if (!chain.entries.length) throw new Error('classification evidence integrity mismatch: evidence chain empty');
	let previous = null;
	for (let index = 0; index < chain.entries.length; index += 1) {
		const row = chain.entries[index];
		const generation = index + 1;
		assertEqual(Number(row.generation), generation, 'generation gap');
		assertEqual(row.previous_event_id || null, previous?.event_id || null, 'previous event');
		assertEqual(row.previous_entry_digest || null, previous?.entry_digest || null, 'previous entry digest');
		assertEqual(row.evidence_previous_entry_digest || null, row.previous_entry_digest || null, 'evidence previous entry digest');
		for (const [eventField, evidenceField] of [
			['tenant_id', 'evidence_tenant_id'], ['workspace_id', 'evidence_workspace_id'],
			['customer_domain', 'evidence_customer_domain'], ['provider', 'evidence_provider'],
			['provider_account_hash', 'evidence_provider_account_hash'], ['canonical_account_id', 'evidence_canonical_account_id'],
			['canonical_message_id', 'evidence_canonical_message_id'], ['message_fingerprint', 'evidence_message_fingerprint'],
			['source_created_at', 'evidence_source_created_at'], ['provenance_ref', 'evidence_provenance_ref'],
			['generation', 'evidence_generation'], ['classification_id', 'evidence_classification_id']
		]) assertEqual(String(row[eventField]), String(row[evidenceField]), `tuple ${eventField}`);
		assertEqual(Number(row.canonical_account_id), Number(row.run_canonical_account_id), 'run account');
		assertEqual(row.provider_account_hash, row.run_provider_account_hash, 'run provider account');
		assertEqual(row.run_status, 'COMPLETED', 'run status');
		assertEqual(row.redaction_level, 'BODYLESS', 'redaction level');
		assertEqual(Number(row.body_persisted), 0, 'body persisted');
		const computed = await computeEvidenceIntegrity(rowToIntegrityInput(row));
		assertEqual(row.input_digest, computed.inputDigest, 'input digest');
		assertEqual(row.decision_digest, computed.decisionDigest, 'decision digest');
		assertEqual(row.payload_digest, computed.payloadDigest, 'payload digest');
		assertEqual(row.entry_digest, computed.entryDigest, 'entry digest');
		previous = row;
	}
	const last = chain.entries.at(-1);
	assertEqual(Number(chain.head.latest_generation), Number(last.generation), 'head generation');
	assertEqual(chain.head.latest_event_id, last.event_id, 'head event');
	assertEqual(chain.head.latest_evidence_id, last.evidence_id, 'head evidence');
	assertEqual(chain.head.latest_entry_digest, last.entry_digest, 'head digest');
	return { valid: true, entries: chain.entries, head: chain.head };
}

export async function verifyClassificationEvidence(db, scopeInput) {
	if (!db?.prepare) throw new Error('D1 database is required');
	const tenantId = positiveInteger(scopeInput?.tenantId, 'scope.tenantId');
	const workspaceId = positiveInteger(scopeInput?.workspaceId, 'scope.workspaceId');
	const canonicalAccountId = positiveInteger(scopeInput?.canonicalAccountId, 'scope.canonicalAccountId');
	const classificationId = required(scopeInput?.classificationId, 'scope.classificationId');
	const projection = await db.prepare(`SELECT id,tenant_id,workspace_id,customer_domain,provider,canonical_account_id,
	 canonical_message_id,message_fingerprint,current_event_id,current_evidence_id,evidence_ref,generation
	 FROM nexora_email_classifications
	 WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND canonical_account_id=?4
	  AND current_event_id IS NOT NULL AND current_evidence_id IS NOT NULL
	 LIMIT 1`).bind(classificationId, tenantId, workspaceId, canonicalAccountId).first();
	if (!projection) throw new Error('classification evidence authority denied');
	const verified = await verifyEvidenceChain(db, {
		tenantId,
		workspaceId,
		customerDomain: projection.customer_domain,
		provider: projection.provider,
		canonicalAccountId,
		canonicalMessageId: projection.canonical_message_id
	});
	const last = verified.entries.at(-1);
	assertEqual(last.classification_id, projection.id, 'current classification');
	assertEqual(verified.head.latest_event_id, projection.current_event_id, 'projection event');
	assertEqual(verified.head.latest_evidence_id, projection.current_evidence_id, 'projection evidence');
	assertEqual(verified.head.latest_entry_digest, projection.evidence_ref, 'projection evidence ref');
	assertEqual(Number(verified.head.latest_generation), Number(projection.generation), 'projection generation');
	assertEqual(last.message_fingerprint, projection.message_fingerprint, 'projection message fingerprint');
	return {
		valid: true,
		classificationId: projection.id,
		eventId: verified.head.latest_event_id,
		evidenceId: verified.head.latest_evidence_id,
		evidenceRef: verified.head.latest_entry_digest,
		messageFingerprint: projection.message_fingerprint,
		canonicalMessageId: String(projection.canonical_message_id),
		canonicalAccountId,
		generation: Number(verified.head.latest_generation)
	};
}

export default { canonicalize, sha256Hex, computeEvidenceIntegrity, buildAtomicLedgerStatements, readEvidenceChain, verifyEvidenceChain, verifyClassificationEvidence };
