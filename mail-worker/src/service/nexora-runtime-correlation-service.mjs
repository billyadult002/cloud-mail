import { canonicalize, sha256Hex, verifyEvidenceChain } from './nexora-evidence-ledger-service.mjs';
import { deriveCorrelationRef, deriveSessionRef } from './nexora-session-ref-service.mjs';

const PLATFORMS = new Set(['DESKTOP', 'IOS_PHYSICAL']);
const SESSION_TTL_SECONDS = 600;

function uuid() {
	return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function bytesToHex(bytes) {
	return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function secureRandom() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

function safePositiveInteger(value, name) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} is required`);
	return parsed;
}

export function deriveActorScope(actor, input = {}) {
	const tenantId = safePositiveInteger(actor?.userId, 'authenticated actor');
	const requestedTenant = input.tenantId ?? input.tenant_id;
	if (requestedTenant !== undefined && Number(requestedTenant) !== tenantId) {
		throw new Error('tenant scope must match authenticated actor');
	}
	const requestedWorkspace = input.workspaceId ?? input.workspace_id;
	if (requestedWorkspace !== undefined) throw new Error('workspace scope is server-derived');
	return { tenantId };
}

function buildAllowlist(env) {
	let parsed;
	try {
		parsed = JSON.parse(env.NEXORA_ACCEPTANCE_BUILDS_JSON || '[]');
	} catch {
		throw new Error('acceptance build allowlist is invalid');
	}
	if (!Array.isArray(parsed)) throw new Error('acceptance build allowlist is invalid');
	return parsed;
}

export function normalizeBuild(env, input = {}) {
	for (const field of [
		'artifactDigest', 'artifact_digest', 'signingIdentity', 'signing_identity',
		'signingKeyVersion', 'signing_key_version', 'policyVersion', 'policy_version',
		'allowlistPolicyVersion', 'allowlist_policy_version'
	]) {
		if (input[field] !== undefined) throw new Error(`${field} is server-derived build authority`);
	}
	const platform = String(input.platform || '').trim().toUpperCase();
	if (!PLATFORMS.has(platform)) throw new Error('unsupported acceptance platform');
	const buildId = String(input.buildId ?? input.build_id ?? '').trim();
	const buildVersion = String(input.buildVersion ?? input.build_version ?? '').trim();
	if (!buildId || !buildVersion || buildId.length > 128 || buildVersion.length > 64) throw new Error('build identity is required');
	const now = Date.now();
	const entry = buildAllowlist(env).find((candidate) =>
		String(candidate.platform || '').toUpperCase() === platform &&
		String(candidate.buildId ?? candidate.build_id ?? '') === buildId &&
		String(candidate.buildVersion ?? candidate.build_version ?? '') === buildVersion
	);
	if (!entry) throw new Error('acceptance build is not allowlisted');
	if (entry.revoked === true) throw new Error('acceptance build is revoked');
	const validFrom = Date.parse(entry.validFrom ?? entry.valid_from ?? '');
	const validUntil = Date.parse(entry.validUntil ?? entry.valid_until ?? '');
	if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil) || now < validFrom || now >= validUntil) {
		throw new Error('acceptance build validity is missing or inactive');
	}
	const expected = {
		artifactDigest: String(entry.artifactDigest ?? entry.artifact_digest ?? '').toLowerCase(),
		sourceCommit: String(entry.sourceCommit ?? entry.source_commit ?? '').toLowerCase(),
		signingIdentity: String(entry.signingIdentity ?? entry.signing_identity ?? ''),
		signingKeyVersion: String(entry.signingKeyVersion ?? entry.signing_key_version ?? '')
	};
	if (!/^[a-f0-9]{64}$/.test(expected.artifactDigest) || !/^[a-f0-9]{40}$/.test(expected.sourceCommit) ||
		!expected.signingIdentity || !expected.signingKeyVersion) throw new Error('acceptance build immutable identity is invalid');
	const claimedSourceCommit = String(input.sourceCommit ?? input.source_commit ?? '').toLowerCase();
	if (claimedSourceCommit && claimedSourceCommit !== expected.sourceCommit) throw new Error('acceptance build source commit mismatch');
	return { platform, buildId, buildVersion, ...expected, policyVersion: String(entry.policyVersion ?? entry.policy_version ?? 'v1') };
}

function deploymentId(env) {
	const id = String(env.CF_VERSION_METADATA?.id || '').trim();
	if (!id) throw new Error('runtime deployment identity is not configured');
	return id;
}

function requestId(c) {
	return String(c.req.header('cf-ray') || uuid());
}

export async function hashSecret(env, value) {
	return deriveCorrelationRef(env, 'acceptance-challenge', value);
}

function constantTimeEqual(left, right) {
	const a = String(left || '');
	const b = String(right || '');
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	return mismatch === 0;
}

async function requireSessionContinuity(c, session) {
	if (String(session.hmac_key_version || '') !== String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || '')) {
		throw new Error('acceptance HMAC key version continuity denied');
	}
	const authorization = c.req.header('authorization');
	if (!authorization) throw new Error('authenticated session reference is required');
	const currentAuthSessionRef = await deriveSessionRef(c.env, authorization);
	if (!constantTimeEqual(session.auth_session_ref, currentAuthSessionRef)) throw new Error('acceptance auth session continuity denied');
	const currentDeploymentId = deploymentId(c.env);
	if (currentDeploymentId !== session.runtime_deployment_id) throw new Error('acceptance deployment continuity denied');
	const build = normalizeBuild(c.env, {
		platform: session.platform,
		buildId: session.build_id,
		buildVersion: session.build_version,
		sourceCommit: session.source_commit
	});
	if (build.artifactDigest !== session.artifact_digest || build.sourceCommit !== session.source_commit ||
		build.signingIdentity !== session.signing_identity || build.signingKeyVersion !== session.signing_key_version ||
		build.policyVersion !== session.allowlist_policy_version) throw new Error('acceptance build authority continuity denied');
	return { currentAuthSessionRef, currentDeploymentId, build };
}

function evidenceIdentity(row) {
	return {
		tenantId: Number(row.tenant_id),
		workspaceId: Number(row.workspace_id),
		customerDomain: row.customer_domain,
		provider: row.provider,
		canonicalAccountId: Number(row.canonical_account_id),
		canonicalMessageId: String(row.canonical_message_id)
	};
}

async function loadExactClassificationLineage(c, session, classificationId) {
	const row = await c.env.db.prepare(
		`SELECT c.id,c.tenant_id,c.workspace_id,c.canonical_account_id,c.canonical_message_id,c.provider_account_hash,
		 c.message_fingerprint,c.current_event_id,c.current_evidence_id,c.evidence_ref,c.generation,
		 e.run_id,e.customer_domain,e.provider,e.canonical_message_id AS event_canonical_message_id,
		 e.message_fingerprint AS event_message_fingerprint,e.generation AS event_generation,e.decision_digest,
		 v.id AS evidence_id,v.entry_digest,v.payload_digest,
		 r.actor_user_id,r.auth_session_ref AS run_auth_session_ref,r.runtime_deployment_id AS run_deployment_id,
		 r.acceptance_correlation_ref,r.domain_authority_id,r.authority_generation,r.authority_evidence_ref,
		 h.latest_generation,h.latest_event_id,h.latest_evidence_id,h.latest_entry_digest
		 FROM nexora_email_classifications c
		 JOIN nexora_email_classification_events e ON e.id=c.current_event_id AND e.classification_id=c.id
		 JOIN nexora_email_classification_evidence_v2 v ON v.id=c.current_evidence_id AND v.event_id=e.id AND v.run_id=e.run_id
		 JOIN nexora_classification_runs r ON r.id=e.run_id AND r.tenant_id=c.tenant_id AND r.workspace_id=c.workspace_id
		 JOIN nexora_classification_ledger_heads h ON h.tenant_id=c.tenant_id AND h.workspace_id=c.workspace_id
		  AND h.customer_domain=e.customer_domain AND h.provider=e.provider AND h.canonical_account_id=c.canonical_account_id
		  AND h.canonical_message_id=c.canonical_message_id
		 WHERE c.id=?1 AND c.tenant_id=?2 AND c.workspace_id=?3 AND c.canonical_account_id=?4
		  AND r.actor_user_id=?2 AND r.auth_session_ref=?5 AND r.runtime_deployment_id=?6
		  AND r.acceptance_correlation_ref=?7
		 LIMIT 1`
	).bind(
		classificationId, session.tenant_id, session.workspace_id, session.canonical_account_id,
		session.auth_session_ref, session.runtime_deployment_id, session.id
	).first();
	if (!row) throw new Error('classification correlation lineage denied');
	const verified = await verifyEvidenceChain(c.env.db, evidenceIdentity(row));
	if (!verified.valid || row.current_event_id !== verified.head.latest_event_id ||
		row.current_evidence_id !== verified.head.latest_evidence_id || row.evidence_ref !== verified.head.latest_entry_digest ||
		row.latest_event_id !== verified.head.latest_event_id || row.latest_evidence_id !== verified.head.latest_evidence_id ||
		row.latest_entry_digest !== verified.head.latest_entry_digest || Number(row.generation) !== Number(verified.head.latest_generation)) {
		throw new Error('classification correlation evidence head mismatch');
	}
	return { row, verified };
}

async function correlationDigests(session, lineage, eventId, request) {
	const row = lineage.row;
	const authorityTuple = {
		session: {
			id: session.id, tenantId: Number(session.tenant_id), workspaceId: Number(session.workspace_id),
			actorUserId: Number(session.actor_user_id), canonicalAccountId: Number(session.canonical_account_id),
			platform: session.platform, buildId: session.build_id, buildVersion: session.build_version,
			artifactDigest: session.artifact_digest, sourceCommit: session.source_commit,
			signingIdentity: session.signing_identity, signingKeyVersion: session.signing_key_version,
			runtimeDeploymentId: session.runtime_deployment_id, authSessionRef: session.auth_session_ref
		},
		classification: {
			id: row.id, generation: Number(row.generation), messageFingerprint: row.message_fingerprint,
			currentEventId: row.current_event_id, currentEvidenceId: row.current_evidence_id,
			evidenceEntryDigest: row.entry_digest, decisionDigest: row.decision_digest, payloadDigest: row.payload_digest
		},
		run: {
			id: row.run_id, domainAuthorityId: row.domain_authority_id,
			authorityGeneration: Number(row.authority_generation), authorityEvidenceRef: row.authority_evidence_ref
		}
	};
	const authorityTupleDigest = await sha256Hex(canonicalize(authorityTuple));
	const eventDigest = await sha256Hex(canonicalize({ authorityTupleDigest, eventId, requestId: request }));
	return { authorityTupleDigest, eventDigest };
}

async function resolveAccountAuthority(c, tenantId, accountId) {
	const candidates = await c.env.db.prepare(
		`SELECT DISTINCT a.account_id,b.workspace_id,m.role
		 FROM account a
		 JOIN workspace_account_bindings b ON b.account_id=a.account_id
		 JOIN workspace_members m ON m.workspace_id=b.workspace_id AND m.user_id=a.user_id
		 WHERE a.account_id=?1 AND a.user_id=?2 AND a.is_del=0
		 ORDER BY b.workspace_id`
	).bind(accountId, tenantId).all();
	const rows = candidates.results || [];
	if (rows.length === 0) throw new Error('account authority denied');
	if (rows.length !== 1) throw new Error('account workspace authority is ambiguous');
	return {
		workspaceId: safePositiveInteger(rows[0].workspace_id, 'server workspace authority'),
		role: rows[0].role,
		canonicalAccountId: Number(rows[0].account_id)
	};
}

export function redactAcceptanceRow(row) {
	return {
		id: row.id,
		tenantId: Number(row.tenant_id),
		workspaceId: Number(row.workspace_id),
		actorUserId: Number(row.actor_user_id),
		canonicalAccountId: Number(row.canonical_account_id ?? row.account_id),
		platform: row.platform,
		buildId: row.build_id,
		buildVersion: row.build_version,
		artifactDigest: row.artifact_digest,
		sourceCommit: row.source_commit,
		signingIdentity: row.signing_identity,
		signingKeyVersion: row.signing_key_version,
		allowlistPolicyVersion: row.allowlist_policy_version,
		runtimeDeploymentId: row.runtime_deployment_id ?? row.runtime_release_id,
		status: row.status,
		requestId: row.consumed_request_id || row.request_id,
		serverTimestamp: row.occurred_at || row.consumed_at || row.issued_at,
		issuedAt: row.issued_at,
		expiresAt: row.expires_at,
		consumedAt: row.consumed_at || null
	};
}

async function createSession(c, input = {}) {
	const actor = c.get('user');
	const actorScope = deriveActorScope(actor, input);
	const requestedActor = input.actorUserId ?? input.actor_user_id;
	if (requestedActor !== undefined) throw new Error('actor identity is server-derived');
	for (const forbidden of ['runtimeDeploymentId', 'runtime_deployment_id', 'authSessionRef', 'auth_session_ref', 'requestId', 'request_id', 'issuedAt', 'issued_at']) {
		if (input[forbidden] !== undefined) throw new Error(`${forbidden} is server-derived`);
	}
	const accountId = safePositiveInteger(input.accountId ?? input.account_id ?? input.canonicalAccountId ?? input.canonical_account_id, 'accountId');
	const account = await resolveAccountAuthority(c, actorScope.tenantId, accountId);
	const scope = { tenantId: actorScope.tenantId, workspaceId: account.workspaceId };
	const build = normalizeBuild(c.env, input);
	const runtimeDeploymentId = deploymentId(c.env);
	const idempotencyKey = String(input.idempotencyKey ?? input.idempotency_key ?? '').trim();
	if (!idempotencyKey || idempotencyKey.length > 160) throw new Error('invalid idempotency key');
	const existing = await c.env.db.prepare(
		`SELECT * FROM nexora_runtime_acceptance_sessions
		 WHERE tenant_id=?1 AND workspace_id=?2 AND actor_user_id=?1 AND idempotency_key=?3 LIMIT 1`
	).bind(scope.tenantId, scope.workspaceId, idempotencyKey).first();
	if (existing) {
		const same = Number(existing.canonical_account_id) === account.canonicalAccountId &&
			existing.platform === build.platform && existing.build_id === build.buildId && existing.build_version === build.buildVersion &&
			existing.artifact_digest === build.artifactDigest && existing.source_commit === build.sourceCommit &&
				existing.signing_identity === build.signingIdentity && existing.signing_key_version === build.signingKeyVersion &&
				existing.runtime_deployment_id === runtimeDeploymentId &&
				existing.hmac_key_version === String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || '');
		if (!same) throw new Error('acceptance session idempotency conflict');
		return { ...redactAcceptanceRow(existing), challenge: null, idempotentReplay: true };
	}
	const id = uuid();
	const challenge = secureRandom();
	const challengeHash = await deriveCorrelationRef(c.env, 'acceptance-challenge', challenge);
	const authorization = c.req.header('authorization');
	if (!authorization) throw new Error('authenticated session reference is required');
	const authSessionRef = await deriveSessionRef(c.env, authorization);
	const correlationRequestId = requestId(c);
	const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
	await c.env.db.prepare(
		`INSERT INTO nexora_runtime_acceptance_sessions
			 (id,tenant_id,workspace_id,actor_user_id,canonical_account_id,platform,build_id,build_version,artifact_digest,source_commit,signing_identity,signing_key_version,allowlist_policy_version,runtime_deployment_id,challenge_hash,auth_session_ref,hmac_key_version,request_id,idempotency_key,status,expires_at)
			 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,'ISSUED',?20)`
	).bind(id, scope.tenantId, scope.workspaceId, scope.tenantId, account.canonicalAccountId, build.platform, build.buildId, build.buildVersion, build.artifactDigest, build.sourceCommit, build.signingIdentity, build.signingKeyVersion, build.policyVersion, runtimeDeploymentId, challengeHash, authSessionRef, c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION, correlationRequestId, idempotencyKey, expiresAt).run();
	return {
		id,
		challenge,
		status: 'ISSUED',
		workspaceId: scope.workspaceId,
		canonicalAccountId: account.canonicalAccountId,
		requestId: correlationRequestId,
		serverTimestamp: new Date().toISOString(),
		expiresAt,
		platform: build.platform,
		buildId: build.buildId,
		buildVersion: build.buildVersion,
		artifactDigest: build.artifactDigest,
		sourceCommit: build.sourceCommit,
		signingIdentity: build.signingIdentity,
		signingKeyVersion: build.signingKeyVersion,
		allowlistPolicyVersion: build.policyVersion,
		runtimeDeploymentId
	};
}

async function consumeSession(c, input = {}) {
	const actor = c.get('user');
	const actorId = safePositiveInteger(actor?.userId, 'authenticated actor');
	const sessionId = String(input.sessionId ?? input.session_id ?? '').trim();
	const challenge = String(input.challenge || '');
	const classificationId = String(input.classificationId ?? input.classification_id ?? '').trim();
	if (!sessionId || !challenge || !classificationId) throw new Error('sessionId, challenge, and classificationId are required');
	const session = await c.env.db.prepare(
		`SELECT * FROM nexora_runtime_acceptance_sessions
		 WHERE id=?1 AND actor_user_id=?2 AND tenant_id=?2 LIMIT 1`
	).bind(sessionId, actorId).first();
	if (!session) throw new Error('acceptance session not found');
	if (session.status !== 'ISSUED') throw new Error('acceptance session already consumed or inactive');
	if (new Date(session.expires_at).getTime() <= Date.now()) throw new Error('acceptance session expired');
	await requireSessionContinuity(c, session);
	const suppliedHash = await deriveCorrelationRef(c.env, 'acceptance-challenge', challenge);
	if (!constantTimeEqual(session.challenge_hash, suppliedHash)) throw new Error('acceptance challenge denied');
	const lineage = await loadExactClassificationLineage(c, session, classificationId);
	const classification = lineage.row;
	const correlationRequestId = requestId(c);
	const eventId = uuid();
	const { authorityTupleDigest, eventDigest } = await correlationDigests(session, lineage, eventId, correlationRequestId);
	const statements = [
		c.env.db.prepare(
			`UPDATE nexora_runtime_acceptance_sessions
			 SET status='CONSUMED',consumed_at=CURRENT_TIMESTAMP,consumed_request_id=?3
			 WHERE id=?1 AND actor_user_id=?2 AND status='ISSUED' AND expires_at>CURRENT_TIMESTAMP`
		).bind(sessionId, actorId, correlationRequestId),
		c.env.db.prepare(
			`INSERT INTO nexora_runtime_correlation_events
				 (id,acceptance_session_id,tenant_id,workspace_id,actor_user_id,canonical_account_id,classification_id,classification_evidence_ref,message_fingerprint,platform,build_id,build_version,artifact_digest,source_commit,signing_identity,signing_key_version,allowlist_policy_version,runtime_deployment_id,auth_session_ref,hmac_key_version,request_id,event_type,authority_tuple_digest,event_digest)
				 SELECT ?1,s.id,s.tenant_id,s.workspace_id,s.actor_user_id,s.canonical_account_id,?2,?3,?4,s.platform,s.build_id,s.build_version,s.artifact_digest,s.source_commit,s.signing_identity,s.signing_key_version,s.allowlist_policy_version,s.runtime_deployment_id,s.auth_session_ref,s.hmac_key_version,?5,'CLASSIFICATION_OBSERVED',?6,?7
			 FROM nexora_runtime_acceptance_sessions s
			 WHERE s.id=?8 AND s.actor_user_id=?9 AND s.status='CONSUMED' AND s.consumed_request_id=?5
			  AND EXISTS (SELECT 1 FROM nexora_email_classifications c WHERE c.id=?2 AND c.tenant_id=s.tenant_id AND c.workspace_id=s.workspace_id)`
		).bind(eventId, classification.id, classification.current_evidence_id, classification.message_fingerprint, correlationRequestId, authorityTupleDigest, eventDigest, sessionId, actorId)
	];
	const results = await c.env.db.batch(statements);
	if (Number(results?.[0]?.meta?.changes || 0) !== 1 || Number(results?.[1]?.meta?.changes || 0) !== 1) {
		throw new Error('acceptance session replay or atomic correlation failure');
	}
	return { id: sessionId, eventId, status: 'CONSUMED', classificationId: classification.id, classificationEvidenceRef: classification.current_evidence_id, messageFingerprint: classification.message_fingerprint, authorityTupleDigest, eventDigest, requestId: correlationRequestId };
}

async function getSession(c, sessionId) {
	const actorId = safePositiveInteger(c.get('user')?.userId, 'authenticated actor');
	const row = await c.env.db.prepare(
		`SELECT s.*,e.id event_id,e.classification_id,e.classification_evidence_ref,e.message_fingerprint,e.authority_tuple_digest,e.event_digest,e.request_id AS event_request_id,e.occurred_at
		 FROM nexora_runtime_acceptance_sessions s
		 LEFT JOIN nexora_runtime_correlation_events e ON e.acceptance_session_id=s.id
		 WHERE s.id=?1 AND s.actor_user_id=?2 AND s.tenant_id=?2 LIMIT 1`
	).bind(String(sessionId), actorId).first();
	if (!row) throw new Error('acceptance session not found');
	await requireSessionContinuity(c, row);
	if (row.event_id) {
		const lineage = await loadExactClassificationLineage(c, row, row.classification_id);
		if (row.classification_evidence_ref !== lineage.row.current_evidence_id || row.message_fingerprint !== lineage.row.message_fingerprint) {
			throw new Error('acceptance receipt classification lineage mismatch');
		}
		const expected = await correlationDigests(row, lineage, row.event_id, row.event_request_id);
		if (!constantTimeEqual(row.authority_tuple_digest, expected.authorityTupleDigest) ||
			!constantTimeEqual(row.event_digest, expected.eventDigest)) {
			throw new Error('acceptance receipt digest mismatch');
		}
	}
	return {
		...redactAcceptanceRow(row),
		correlation: row.event_id ? {
			eventId: row.event_id,
			classificationId: row.classification_id,
			classificationEvidenceRef: row.classification_evidence_ref,
			messageFingerprint: row.message_fingerprint,
			authorityTupleDigest: row.authority_tuple_digest,
			eventDigest: row.event_digest,
			occurredAt: row.occurred_at
		} : null
	};
}

export default { createSession, consumeSession, getSession, hashSecret };
