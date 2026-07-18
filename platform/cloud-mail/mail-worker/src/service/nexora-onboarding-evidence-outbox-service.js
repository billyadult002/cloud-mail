// Canonical callback Evidence delivery. This adapter is intentionally thin: the only
// Evidence ledger is mission_runtime_evidence, whose tenant/workspace/reference uniqueness
// provides duplicate suppression. Verification remains exclusively in durable-mission-runtime.
import { hash } from './durable-mission-runtime-service.js';

// Single fenced persistence seam used by delivery and production-shaped tests.
// It never accepts a caller-selected owner/fence as authority; those values are
// matched against the durable lease in the conditional UPDATE.
async function commitEvidenceDeliveryResult(c, scope, { outboxId, owner, fencingToken, status, canonicalEvidenceReference = null, expectedStatus = 'CLAIMED' }) {
	if (!['DELIVERED', 'RETRY_SCHEDULED'].includes(status)) return { committed: false, reason: 'EVIDENCE_RESULT_STATUS_INVALID' };
	const columns = await c.env.db.prepare(`PRAGMA table_info(nexora_onboarding_evidence_outbox)`).all();
	const hasCanonicalReference = (columns.results || []).some(row => row.name === 'canonical_evidence_reference');
	const existing = await c.env.db.prepare(`SELECT status,commit_result_id${hasCanonicalReference ? ',canonical_evidence_reference' : ''} FROM nexora_onboarding_evidence_outbox WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(outboxId, scope.tenantId, scope.workspaceId).first();
	const storedReference = hasCanonicalReference ? existing?.canonical_evidence_reference || null : existing?.commit_result_id ? `evidence:${existing.commit_result_id}` : null;
	if (existing?.status === status && status === 'DELIVERED') {
		if ((storedReference || null) === (canonicalEvidenceReference || null)) return { committed: true, status, canonicalEvidenceReference, idempotent: true };
		return { committed: false, reason: 'EVIDENCE_RESULT_CANONICAL_REFERENCE_CONFLICT' };
	}
	const updateSql = hasCanonicalReference ? `UPDATE nexora_onboarding_evidence_outbox SET status=?1,canonical_evidence_reference=COALESCE(?8,canonical_evidence_reference),delivered_at=CASE WHEN ?1='DELIVERED' THEN CURRENT_TIMESTAMP ELSE delivered_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND tenant_id=?3 AND workspace_id=?4 AND status=?5 AND (canonical_evidence_reference IS NULL OR canonical_evidence_reference=?8) AND EXISTS (SELECT 1 FROM nexora_onboarding_evidence_delivery_leases WHERE outbox_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND owner=?6 AND fencing_token=?7 AND lease_expires_at>CURRENT_TIMESTAMP)` : `UPDATE nexora_onboarding_evidence_outbox SET status=?1,delivered_at=CASE WHEN ?1='DELIVERED' THEN CURRENT_TIMESTAMP ELSE delivered_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND tenant_id=?3 AND workspace_id=?4 AND status=?5 AND EXISTS (SELECT 1 FROM nexora_onboarding_evidence_delivery_leases WHERE outbox_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND owner=?6 AND fencing_token=?7 AND lease_expires_at>CURRENT_TIMESTAMP)`;
	const update = c.env.db.prepare(updateSql);
	const result = hasCanonicalReference
		? await update.bind(status, outboxId, scope.tenantId, scope.workspaceId, expectedStatus, owner, fencingToken, canonicalEvidenceReference).run()
		: await update.bind(status, outboxId, scope.tenantId, scope.workspaceId, expectedStatus, owner, fencingToken).run();
	return result.meta?.changes ? { committed: true, status, canonicalEvidenceReference } : { committed: false, reason: 'EVIDENCE_RESULT_STALE_FENCE' };
}

async function deliverEvidenceOutbox(c, scope, { outboxId, leaseOwner = 'evidence-worker', leaseSeconds = 60, expectedFencingToken = null, expectedMissionId = null, expectedProvider = null, expectedCommitResultId = null, expectedTokenGeneration = null, expectedProviderConnectionGeneration = null, expectedEvidencePayloadHash = null, expectedAuthorizationSessionId = null, expectedCallbackCorrelationId = null, expectedReplacementSessionId = null, expectedReplacementCorrelationId = null, expectedCheckpointLineage = null }) {
	const preflight = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_evidence_outbox WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(outboxId, scope.tenantId, scope.workspaceId).first();
	if (!preflight) return { delivered: false, reason: 'EVIDENCE_OUTBOX_NOT_FOUND' };
	if (expectedFencingToken != null) {
		const currentLease = await c.env.db.prepare(`SELECT owner,fencing_token,lease_expires_at FROM nexora_onboarding_evidence_delivery_leases WHERE outbox_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(outboxId, scope.tenantId, scope.workspaceId).first();
		if (!currentLease || currentLease.owner !== leaseOwner || Number(currentLease.fencing_token) !== Number(expectedFencingToken) || !currentLease.lease_expires_at || Date.parse(currentLease.lease_expires_at) <= Date.now()) return { delivered: false, reason: 'EVIDENCE_OUTBOX_STALE_FENCE' };
	}
	const preflightPayload = JSON.parse(preflight.payload_json || '{}');
	if (expectedEvidencePayloadHash) {
		const actualPayloadHash = await hash(preflightPayload);
		if (actualPayloadHash !== expectedEvidencePayloadHash) return { delivered: false, reason: 'EVIDENCE_PAYLOAD_CONFLICT' };
	}
	if (expectedMissionId && expectedMissionId !== preflight.onboarding_mission_id) return { delivered: false, reason: 'EVIDENCE_MISSION_LINEAGE_MISMATCH' };
	if (expectedCommitResultId && expectedCommitResultId !== preflight.commit_result_id) return { delivered: false, reason: 'EVIDENCE_COMMIT_RESULT_LINEAGE_MISMATCH' };
	if (expectedProvider && expectedProvider !== preflightPayload.provider) return { delivered: false, reason: 'EVIDENCE_PROVIDER_LINEAGE_MISMATCH' };
	if (expectedTokenGeneration != null && Number(expectedTokenGeneration) !== Number(preflightPayload.token_generation)) return { delivered: false, reason: 'EVIDENCE_TOKEN_GENERATION_MISMATCH' };
	if (expectedProviderConnectionGeneration != null && Number(expectedProviderConnectionGeneration) !== Number(preflightPayload.provider_connection_generation)) return { delivered: false, reason: 'EVIDENCE_PROVIDER_CONNECTION_GENERATION_MISMATCH' };
	for (const [expected, key, reason] of [
		[expectedAuthorizationSessionId, 'authorization_session_id', 'EVIDENCE_AUTHORIZATION_SESSION_LINEAGE_MISMATCH'],
		[expectedCallbackCorrelationId, 'callback_correlation_id', 'EVIDENCE_CALLBACK_CORRELATION_LINEAGE_MISMATCH'],
		[expectedReplacementSessionId, 'replacement_session_id', 'EVIDENCE_REPLACEMENT_SESSION_LINEAGE_MISMATCH'],
		[expectedReplacementCorrelationId, 'replacement_correlation_id', 'EVIDENCE_REPLACEMENT_CORRELATION_LINEAGE_MISMATCH'],
		[expectedCheckpointLineage, 'checkpoint_lineage', 'EVIDENCE_CHECKPOINT_LINEAGE_MISMATCH'],
	]) if (expected != null && String(expected) !== String(preflightPayload[key])) return { delivered: false, reason };
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_evidence_delivery_leases(outbox_id,tenant_id,workspace_id) VALUES(?1,?2,?3)`).bind(outboxId, scope.tenantId, scope.workspaceId).run();
	const lease = await c.env.db.prepare(`SELECT fencing_token FROM nexora_onboarding_evidence_delivery_leases WHERE outbox_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(outboxId, scope.tenantId, scope.workspaceId).first();
	const claimed = await c.env.db.prepare(`UPDATE nexora_onboarding_evidence_delivery_leases SET owner=?2,fencing_token=fencing_token+1,lease_expires_at=datetime('now',?3),attempt=attempt+1,updated_at=CURRENT_TIMESTAMP WHERE outbox_id=?1 AND tenant_id=?4 AND workspace_id=?5 AND (owner IS NULL OR lease_expires_at<CURRENT_TIMESTAMP OR owner=?2)`).bind(outboxId, leaseOwner, `+${Math.max(15, Math.min(300, leaseSeconds))} seconds`, scope.tenantId, scope.workspaceId).run();
	if (!claimed.meta?.changes) return { delivered: false, reason: 'EVIDENCE_OUTBOX_LEASE_NOT_CURRENT' };
	const fence = Number(lease?.fencing_token || 0) + 1;
	const outboxClaim = await c.env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET status='CLAIMED',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status IN ('PENDING','RETRYING','RETRY_SCHEDULED','CLAIMED')`).bind(outboxId, scope.tenantId, scope.workspaceId).run();
	if (!outboxClaim.meta?.changes) return { delivered: false, reason: 'EVIDENCE_OUTBOX_NOT_CLAIMABLE', fencingToken: fence };
	if (!claimed.meta?.changes) return { delivered: false, reason: 'EVIDENCE_OUTBOX_NOT_CLAIMABLE' };
	const outbox = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_evidence_outbox WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(outboxId, scope.tenantId, scope.workspaceId).first();
	if (!outbox) return { delivered: false, reason: 'EVIDENCE_OUTBOX_NOT_FOUND' };
	const payload = JSON.parse(outbox.payload_json || '{}');
	const evidenceKey = `nexora:callback:${outbox.commit_result_id}`;
	const referenceHash = await hash({ evidenceKey, commit_result_id: outbox.commit_result_id, mission_id: outbox.onboarding_mission_id, tenant_id: outbox.tenant_id, workspace_id: outbox.workspace_id, event_type: outbox.event_type, payload });
	const evidenceId = `evidence:${outbox.commit_result_id}`;
	try {
		await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_evidence(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,expires_at) VALUES(?1,?2,?3,'nexora_callback',NULL,?4,?5,'nexora_callback_outcome','nexora_callback','supported',?6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL)`).bind(evidenceId, outbox.onboarding_mission_id, payload.run_id || `outbox:${outbox.id}`, scope.tenantId, scope.workspaceId, referenceHash).run();
		const row = await c.env.db.prepare(`SELECT id FROM mission_runtime_evidence WHERE tenant_id=?1 AND workspace_id=?2 AND reference_hash=?3`).bind(scope.tenantId, scope.workspaceId, referenceHash).first();
		const committed = await commitEvidenceDeliveryResult(c, scope, { outboxId, owner: leaseOwner, fencingToken: fence, status: 'DELIVERED', canonicalEvidenceReference: row?.id || evidenceId });
		if (!committed.committed) return { delivered: false, reason: committed.reason, fencingToken: fence };
		return { delivered: true, evidenceId: row?.id || evidenceId, idempotencyKey: evidenceKey };
	} catch {
		await commitEvidenceDeliveryResult(c, scope, { outboxId, owner: leaseOwner, fencingToken: fence, status: 'RETRY_SCHEDULED' });
		return { delivered: false, reason: 'EVIDENCE_DELIVERY_RETRY_SCHEDULED' };
	}
}

export { commitEvidenceDeliveryResult };
export default { deliverEvidenceOutbox, commitEvidenceDeliveryResult };
