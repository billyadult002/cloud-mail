import { digest } from './unified-conversation-service';
import { ensureCheckpoint, claimCheckpoint } from './unified-conversation-backfill-service';
import {
  validateClassificationMutationContext,
  loadCurrentClassificationState,
  computeVirtualReplacementCategorySet,
  buildAtomicClassificationBatch,
  commitAtomicClassificationMutation,
  interpretAtomicCommit,
  releaseCheckpointLeaseConditionally
} from './atomic-classification-mutation-service';

export const HISTORICAL_DIAGNOSIS_NOT_REPRODUCED_AT_CURRENT_SNAPSHOT = 'HISTORICAL_DIAGNOSIS_NOT_REPRODUCED_AT_CURRENT_SNAPSHOT';
export const LINKED_RETRY_CONTRACT_VERSION = 'sender-bulk-reconciliation-v1-linked-atomic';

export async function loadReconciliationMatrix(env, { originalOperationId }) {
  const rows = (await env.db.prepare(`SELECT i.id original_item_id,i.operation_id,i.tenant_id,i.workspace_id,i.conversation_id,i.account_id,i.source_message_id,i.state original_item_state,i.error_code,o.normalized_sender,o.destination_key,
    (SELECT m.source_version FROM conversation_messages m WHERE m.tenant_id=i.tenant_id AND m.workspace_id=i.workspace_id AND m.conversation_id=i.conversation_id AND m.source_message_id=i.source_message_id AND m.lifecycle_state!='quarantined' ORDER BY m.observed_at DESC LIMIT 1) source_version,
    (SELECT group_concat(f.value_key,'|') FROM conversation_facet_heads h JOIN conversation_facet_results f ON f.id=h.current_result_id WHERE h.tenant_id=i.tenant_id AND h.workspace_id=i.workspace_id AND h.conversation_id=i.conversation_id AND h.dimension_key='Category' AND f.status='supported') current_category_keys,
    (SELECT id FROM conversation_facet_snapshots s WHERE s.tenant_id=i.tenant_id AND s.workspace_id=i.workspace_id AND s.conversation_id=i.conversation_id ORDER BY generation DESC LIMIT 1) snapshot_id,
    (SELECT id FROM conversation_projections p WHERE p.tenant_id=i.tenant_id AND p.workspace_id=i.workspace_id AND p.conversation_id=i.conversation_id AND p.state='current') projection_id,
    (SELECT canonical_folder_key FROM conversation_projections p WHERE p.tenant_id=i.tenant_id AND p.workspace_id=i.workspace_id AND p.conversation_id=i.conversation_id AND p.state='current') canonical_folder_key,
    (SELECT COUNT(*) FROM conversation_processing_receipts r WHERE r.tenant_id=i.tenant_id AND r.workspace_id=i.workspace_id AND r.conversation_id=i.conversation_id) receipt_count
   FROM conversation_sender_bulk_items i JOIN conversation_sender_bulk_operations o ON o.id=i.operation_id
   WHERE i.operation_id=?1 ORDER BY i.id`).bind(originalOperationId).all()).results || [];
  return rows.map(row => {
    const categories = String(row.current_category_keys || '').split('|').filter(Boolean).sort();
    const currentPromotions = categories.includes('promotions');
    const eligible = Boolean(row.source_version && row.projection_id && !currentPromotions);
    return { ...row, current_category_keys: categories, current_promotions: currentPromotions, all_mail: row.canonical_folder_key !== 'trash', current_eligibility: eligible ? 'eligible_for_linked_atomic_retry' : 'not_eligible_at_current_snapshot', disposition: eligible ? 'retry_atomic_promotions' : 'retain_ineligible', historical_diagnosis_code: HISTORICAL_DIAGNOSIS_NOT_REPRODUCED_AT_CURRENT_SNAPSHOT };
  });
}

export async function appendReconciliationRecord(env, { matrixRow, deploymentRef, correctiveAttemptId = null }) {
  const currentState = { categories: matrixRow.current_category_keys, snapshot_id: matrixRow.snapshot_id || null, projection_id: matrixRow.projection_id || null, all_mail: matrixRow.all_mail, receipt_count: Number(matrixRow.receipt_count || 0), original_item_state: matrixRow.original_item_state, original_error: matrixRow.error_code || null };
  const authorityState = { source_version: matrixRow.source_version || null, current_eligibility: matrixRow.current_eligibility, normalized_sender: matrixRow.normalized_sender, destination_key: matrixRow.destination_key };
  const evidenceHash = await digest({ originalOperationId: matrixRow.operation_id, originalItemId: matrixRow.original_item_id, currentState, authorityState, deploymentRef, correctiveAttemptId, disposition: matrixRow.disposition });
  const id = `sender-bulk-reconciliation:${await digest({ originalItemId: matrixRow.original_item_id, sourceVersion: matrixRow.source_version || 'missing', disposition: matrixRow.disposition, deploymentRef })}`;
  await env.db.prepare(`INSERT OR IGNORE INTO conversation_sender_bulk_reconciliations(id,original_operation_id,original_item_id,tenant_id,workspace_id,conversation_id,account_id,source_message_id,source_version,historical_diagnosis_code,current_state_json,authority_state_json,disposition,disposition_reason_code,corrective_attempt_id,deployment_ref,evidence_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`).bind(id,matrixRow.operation_id,matrixRow.original_item_id,matrixRow.tenant_id,matrixRow.workspace_id,matrixRow.conversation_id,matrixRow.account_id,matrixRow.source_message_id,matrixRow.source_version||'missing',matrixRow.historical_diagnosis_code,JSON.stringify(currentState),JSON.stringify(authorityState),matrixRow.disposition,matrixRow.current_eligibility,correctiveAttemptId,deploymentRef,evidenceHash).run();
  const persisted = await env.db.prepare(`SELECT id,corrective_attempt_id,evidence_hash FROM conversation_sender_bulk_reconciliations WHERE original_operation_id=?1 AND original_item_id=?2 AND source_version=?3 AND disposition=?4`).bind(matrixRow.operation_id,matrixRow.original_item_id,matrixRow.source_version || 'missing',matrixRow.disposition).first();
  if (!persisted || (correctiveAttemptId && persisted.corrective_attempt_id !== correctiveAttemptId) || persisted.evidence_hash !== evidenceHash) throw new Error('sender_bulk_reconciliation_lineage_conflict');
  return { id, evidence_hash: evidenceHash, disposition: matrixRow.disposition };
}

async function ensureReconciliationRecord(env, { matrixRow, deploymentRef, correctiveAttemptId }) {
  // The disposition is immutable by source version. A later corrective attempt
  // links through the separate append-only attempt ledger instead of trying to
  // re-hash or replace that disposition record.
  const prior = await env.db.prepare(`SELECT id,evidence_hash FROM conversation_sender_bulk_reconciliations WHERE original_operation_id=?1 AND original_item_id=?2 AND source_version=?3 AND disposition=?4`).bind(matrixRow.operation_id,matrixRow.original_item_id,matrixRow.source_version || 'missing',matrixRow.disposition).first();
  if (prior) return { id: prior.id, evidence_hash: prior.evidence_hash, disposition: matrixRow.disposition, existing: true };
  try {
    return await appendReconciliationRecord(env, { matrixRow, deploymentRef, correctiveAttemptId });
  } catch (error) {
    if (!String(error?.message || error).includes('sender_bulk_reconciliation_lineage_conflict')) throw error;
    const existing = await env.db.prepare(`SELECT id,evidence_hash FROM conversation_sender_bulk_reconciliations WHERE original_operation_id=?1 AND original_item_id=?2 AND source_version=?3 AND disposition=?4`).bind(matrixRow.operation_id,matrixRow.original_item_id,matrixRow.source_version || 'missing',matrixRow.disposition).first();
    if (!existing) throw error;
    return { id: existing.id, evidence_hash: existing.evidence_hash, disposition: matrixRow.disposition, existing: true };
  }
}

async function appendRetryAttemptLineage(env, { reconciliation, matrixRow, attemptId }) {
  const evidenceHash = await digest({ reconciliationId: reconciliation.id, reconciliationEvidenceHash: reconciliation.evidence_hash, attemptId, sourceVersion: matrixRow.source_version });
  const id = `sender-bulk-reconciliation-attempt:${await digest({ reconciliationId: reconciliation.id, attemptId })}`;
  await env.db.prepare(`INSERT OR IGNORE INTO conversation_sender_bulk_reconciliation_attempts(id,reconciliation_id,corrective_attempt_id,tenant_id,workspace_id,original_operation_id,original_item_id,evidence_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`).bind(id,reconciliation.id,attemptId,matrixRow.tenant_id,matrixRow.workspace_id,matrixRow.operation_id,matrixRow.original_item_id,evidenceHash).run();
  const persisted = await env.db.prepare(`SELECT id,evidence_hash FROM conversation_sender_bulk_reconciliation_attempts WHERE reconciliation_id=?1 AND corrective_attempt_id=?2`).bind(reconciliation.id,attemptId).first();
  if (!persisted || persisted.evidence_hash !== evidenceHash) throw new Error('sender_bulk_reconciliation_attempt_lineage_conflict');
  return { id, evidence_hash: evidenceHash };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function linkedRetryPreflight({ original, matrix, workspaceId, actorUserId }) {
  if (!original || Number(original.tenant_id) !== Number(actorUserId) || Number(original.workspace_id) !== Number(workspaceId)) throw new Error('sender_bulk_linked_retry_original_scope_mismatch');
  if (original.destination_type !== 'classification' || original.destination_key !== 'promotions') throw new Error('sender_bulk_linked_retry_destination_not_supported');
  if (!matrix.length) throw new Error('sender_bulk_linked_retry_empty_matrix');
  if (matrix.some(row => Number(row.tenant_id) !== Number(actorUserId) || Number(row.workspace_id) !== Number(workspaceId) || row.operation_id !== original.id)) throw new Error('sender_bulk_linked_retry_matrix_scope_mismatch');
  if (matrix.some(row => row.disposition !== 'retry_atomic_promotions' || row.current_eligibility !== 'eligible_for_linked_atomic_retry')) throw new Error('sender_bulk_linked_retry_current_state_not_eligible');
  return matrix;
}

async function classifyLinkedRetryItem(env, { operation, row, checkpoint }) {
  const context = await validateClassificationMutationContext(env, {
    tenantId: operation.tenant_id, workspaceId: operation.workspace_id, conversationId: row.conversation_id,
    accountId: row.account_id, sourceMessageId: row.source_message_id, sourceVersion: row.source_version,
    checkpointId: checkpoint.id, leaseOwner: checkpoint.lease_owner, leaseGeneration: checkpoint.lease_generation,
    destinationKey: operation.destination_key
  });
  const current = await loadCurrentClassificationState(env, context);
  const virtual = computeVirtualReplacementCategorySet({ current, destinationKey: operation.destination_key });
  const plan = await buildAtomicClassificationBatch(env, context, current, virtual, {
    operationId: operation.id,
    itemId: `${operation.id}:${row.conversation_id}`,
    contractVersion: LINKED_RETRY_CONTRACT_VERSION
  });
  const committed = await interpretAtomicCommit(() => commitAtomicClassificationMutation(env, plan));
  if (!committed.committed) throw committed.error;
  return plan;
}

async function persistLinkedRetryFailure(env, operation, row, error) {
  await env.db.batch([
    env.db.prepare(`INSERT OR REPLACE INTO conversation_sender_bulk_items(id,operation_id,tenant_id,workspace_id,conversation_id,account_id,source_message_id,prior_category_keys_json,state,error_code) VALUES(?1,?2,?3,?4,?5,?6,?7,'[]','failed',?8)`).bind(`${operation.id}:${row.conversation_id}`, operation.id, operation.tenant_id, operation.workspace_id, row.conversation_id, row.account_id, row.source_message_id, String(error?.message || error).slice(0, 120)),
    env.db.prepare(`UPDATE conversation_sender_bulk_operations SET failed_conversations=failed_conversations+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='running'`).bind(operation.id)
  ]);
}

export async function executeLinkedAtomicRetry(env, { originalOperationId, workspaceId, actorUserId, deploymentRef, idempotencyKey }) {
  if (!idempotencyKey) throw new Error('sender_bulk_linked_retry_idempotency_key_required');
  const original = await env.db.prepare(`SELECT * FROM conversation_sender_bulk_operations WHERE id=?1`).bind(originalOperationId).first();
  const matrix = await loadReconciliationMatrix(env, { originalOperationId });
  linkedRetryPreflight({ original, matrix, workspaceId, actorUserId });
  const sourceVersions = matrix.map(row => [row.original_item_id, String(row.source_version)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const attemptId = `sender-bulk-retry:${await digest({ originalOperationId, workspaceId, actorUserId, deploymentRef, sourceVersions, idempotencyKey })}`;
  const requestHash = await digest(stable({ originalOperationId, workspaceId, actorUserId, deploymentRef, sourceVersions }));
  const operation = {
    id: attemptId, tenant_id: Number(actorUserId), workspace_id: Number(workspaceId), actor_user_id: Number(actorUserId), normalized_sender: original.normalized_sender,
    sender_identity_hash: original.sender_identity_hash, account_scope: JSON.parse(original.account_scope_json || '[]'), destination_type: original.destination_type,
    destination_key: original.destination_key, mission_id: `sender-bulk-retry-mission:${attemptId}`, action_id: `sender-bulk-retry-action:${attemptId}`
  };
  const inserted = await env.db.prepare(`INSERT OR IGNORE INTO conversation_sender_bulk_operations(id,tenant_id,workspace_id,actor_user_id,normalized_sender,sender_identity_hash,account_scope_json,destination_type,destination_key,future_message_policy,request_hash,idempotency_key,expected_boundary,state,total_conversations,mission_id,action_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'one_time_scope',?10,?11,?12,'running',?13,?14,?15)`).bind(operation.id,operation.tenant_id,operation.workspace_id,operation.actor_user_id,operation.normalized_sender,operation.sender_identity_hash,JSON.stringify(operation.account_scope),operation.destination_type,operation.destination_key,requestHash,idempotencyKey,originalOperationId,matrix.length,operation.mission_id,operation.action_id).run();
  const existing = await env.db.prepare(`SELECT * FROM conversation_sender_bulk_operations WHERE tenant_id=?1 AND workspace_id=?2 AND idempotency_key=?3`).bind(operation.tenant_id, operation.workspace_id, idempotencyKey).first();
  if (!existing || existing.id !== attemptId) throw new Error('sender_bulk_linked_retry_idempotency_conflict');
  if (existing.state === 'completed' || existing.state === 'partial' || existing.state === 'failed') return JSON.parse(existing.result_json || JSON.stringify({ operation_id: existing.id, state: existing.state, idempotent: true }));
  if (Number(inserted.meta?.changes || 0) !== 1) return { operation_id: existing.id, original_operation_id: originalOperationId, state: existing.state, idempotent: true, retry_in_progress: true };
  for (const row of matrix) {
    const reconciliation = await ensureReconciliationRecord(env, { matrixRow: row, deploymentRef, correctiveAttemptId: attemptId });
    await appendRetryAttemptLineage(env, { reconciliation, matrixRow: row, attemptId });
  }
  const checkpointId = await ensureCheckpoint(env, operation.tenant_id, operation.workspace_id);
  const leaseOwner = `sender-bulk-linked-retry:${attemptId}`;
  const checkpoint = await claimCheckpoint(env, checkpointId, leaseOwner);
  if (!checkpoint) throw new Error('sender_bulk_linked_retry_materialization_fence_unavailable');
  let completed = 0;
  let failed = 0;
  const projectionIds = [];
  try {
    for (const row of matrix) {
      try {
        const plan = await classifyLinkedRetryItem(env, { operation, row, checkpoint });
        completed += 1;
        projectionIds.push(plan.projectionId);
      } catch (error) {
        failed += 1;
        await persistLinkedRetryFailure(env, operation, row, error);
      }
    }
  } finally {
    await releaseCheckpointLeaseConditionally(env, { checkpointId: checkpoint.id, leaseOwner, leaseGeneration: checkpoint.lease_generation });
  }
  const state = failed ? 'partial' : 'completed';
  const outcome = { operation_id: attemptId, original_operation_id: originalOperationId, state, total: matrix.length, completed, failed, destination: { type: 'classification', key: 'promotions' }, contract_version: LINKED_RETRY_CONTRACT_VERSION, projection_ids: projectionIds, provider_sync: { state: 'not_requested', reason: 'NEXORA classification does not assert a provider label operation' }, idempotent: false };
  await env.db.batch([
    env.db.prepare(`UPDATE conversation_sender_bulk_operations SET state=?1,completed_conversations=?2,failed_conversations=?3,outcome_id=?4,result_json=?5,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?6 AND state='running'`).bind(state,completed,failed,`sender-bulk-retry-outcome:${attemptId}`,JSON.stringify(outcome),attemptId),
    env.db.prepare(`INSERT INTO conversation_sender_bulk_audit(id,operation_id,tenant_id,workspace_id,event_type,detail_json) VALUES(?1,?2,?3,?4,'linked_retry_completed',?5)`).bind(`sender-bulk-linked-retry-audit:${attemptId}`,attemptId,operation.tenant_id,operation.workspace_id,JSON.stringify(outcome)),
    env.db.prepare(`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id) VALUES(?1,?2,'sender_bulk_linked_atomic_retry','conversation_sender_bulk_operation',?3,?4,?5,?6)`).bind(operation.workspace_id,operation.actor_user_id,attemptId,JSON.stringify({ original_operation_id: originalOperationId }),JSON.stringify(outcome),attemptId)
  ]);
  return outcome;
}

export default { loadReconciliationMatrix, appendReconciliationRecord, executeLinkedAtomicRetry };
