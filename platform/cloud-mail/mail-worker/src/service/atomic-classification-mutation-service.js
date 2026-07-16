import { digest, deriveProjection, MATERIALIZER_VERSION } from './unified-conversation-service.js';

export const PRIMARY_CATEGORY_DIMENSION = 'Category';

function checkedContext(context) {
  const required = ['tenantId', 'workspaceId', 'conversationId', 'sourceMessageId', 'sourceVersion', 'checkpointId', 'leaseOwner', 'leaseGeneration', 'destinationKey'];
  const missing = required.filter(key => context[key] === undefined || context[key] === null || String(context[key]).length === 0);
  if (missing.length) throw new Error(`classification_mutation_context_missing:${missing.join(',')}`);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(context.destinationKey)) throw new Error('classification_destination_invalid');
  return context;
}

export async function validateClassificationMutationContext(env, context) {
  checkedContext(context);
  const checkpoint = await env.db.prepare(`SELECT * FROM conversation_materialization_checkpoints WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='running' AND lease_owner=?4 AND lease_generation=?5 AND datetime(lease_until)>CURRENT_TIMESTAMP`).bind(context.checkpointId, context.tenantId, context.workspaceId, context.leaseOwner, context.leaseGeneration).first();
  if (!checkpoint) throw new Error('classification_mutation_checkpoint_fence_invalid');
  const source = await env.db.prepare(`SELECT m.conversation_id,m.source_version,m.account_id FROM conversation_messages m WHERE m.tenant_id=?1 AND m.workspace_id=?2 AND m.conversation_id=?3 AND m.source_message_id=?4 AND m.source_version=?5 AND m.lifecycle_state!='quarantined'`).bind(context.tenantId, context.workspaceId, context.conversationId, context.sourceMessageId, String(context.sourceVersion)).first();
  if (!source) throw new Error('classification_mutation_source_version_conflict');
  if (context.accountId != null && Number(source.account_id) !== Number(context.accountId)) throw new Error('classification_mutation_account_scope_conflict');
  return { ...context, checkpoint, source };
}

export async function loadCurrentClassificationState(env, context) {
  const aggregate = await env.db.prepare(`SELECT * FROM conversation_aggregates WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(context.conversationId, context.tenantId, context.workspaceId).first();
  if (!aggregate) throw new Error('classification_mutation_conversation_missing');
  const [heads, snapshot, projection, commitments, messages, missions] = await Promise.all([
    env.db.prepare(`SELECT h.dimension_key,h.value_key,h.current_result_id,h.current_result_version,f.* FROM conversation_facet_heads h JOIN conversation_facet_results f ON f.id=h.current_result_id WHERE h.tenant_id=?1 AND h.workspace_id=?2 AND h.conversation_id=?3 AND f.status='supported'`).bind(context.tenantId, context.workspaceId, context.conversationId).all(),
    env.db.prepare(`SELECT * FROM conversation_facet_snapshots WHERE tenant_id=?1 AND workspace_id=?2 AND conversation_id=?3 ORDER BY generation DESC LIMIT 1`).bind(context.tenantId, context.workspaceId, context.conversationId).first(),
    env.db.prepare(`SELECT * FROM conversation_projections WHERE tenant_id=?1 AND workspace_id=?2 AND conversation_id=?3 AND state='current'`).bind(context.tenantId, context.workspaceId, context.conversationId).first(),
    env.db.prepare(`SELECT c.* FROM conversation_commitment_heads h JOIN conversation_commitments c ON c.id=h.current_commitment_id WHERE h.tenant_id=?1 AND h.workspace_id=?2 AND h.conversation_id=?3 AND c.verification_state='verified'`).bind(context.tenantId, context.workspaceId, context.conversationId).all(),
    env.db.prepare(`SELECT m.source_message_id,m.provider_key,m.account_id,e.subject,e.text,e.content,e.send_email,e.to_email,e.create_time,e.is_del,(SELECT COUNT(*) FROM attachments x WHERE x.email_id=e.email_id) attachment_count,s.folder_key,s.is_read,s.is_vip,s.is_starred FROM conversation_messages m JOIN email e ON e.email_id=m.source_message_id JOIN mail_canonical_state s ON s.tenant_id=m.tenant_id AND s.workspace_id=m.workspace_id AND s.account_id=m.account_id AND s.message_id=m.source_message_id WHERE m.tenant_id=?1 AND m.workspace_id=?2 AND m.conversation_id=?3 AND m.lifecycle_state!='quarantined' ORDER BY e.create_time DESC,e.email_id DESC`).bind(context.tenantId, context.workspaceId, context.conversationId).all(),
    env.db.prepare(`SELECT mission_id id FROM conversation_mission_provenance WHERE tenant_id=?1 AND workspace_id=?2 AND conversation_id=?3 AND verification_state='verified'`).bind(context.tenantId, context.workspaceId, context.conversationId).all()
  ]);
  return { aggregate, heads: heads.results || [], snapshot, projection, commitments: commitments.results || [], messages: messages.results || [], missions: missions.results || [] };
}

export function computeVirtualReplacementCategorySet({ current, destinationKey }) {
  const categoryHeads = current.heads.filter(head => head.dimension_key === PRIMARY_CATEGORY_DIMENSION);
  const unrelatedFacets = current.heads.filter(head => head.dimension_key !== PRIMARY_CATEGORY_DIMENSION);
  const beforeCategories = categoryHeads.map(head => head.value_key).sort();
  const retainedResultIds = unrelatedFacets.map(head => head.current_result_id).sort();
  return {
    categoryFamily: PRIMARY_CATEGORY_DIMENSION,
    beforeCategories,
    afterCategories: [destinationKey],
    removedCategories: beforeCategories.filter(value => value !== destinationKey),
    alreadyInDestination: beforeCategories.length === 1 && beforeCategories[0] === destinationKey,
    retainedResultIds,
    unrelatedFacets
  };
}

function displayFromMessages(current) {
  const latest = current.messages[0] || {};
  return {
    title: latest.subject || 'Conversation',
    preview: String(latest.text || latest.content || '').slice(0, 280),
    messageCount: current.messages.length,
    unreadCount: current.messages.reduce((count, row) => count + Number(Number(row.is_read) === 0), 0),
    hasAttachments: current.messages.some(row => Number(row.attachment_count) > 0),
    membershipKeys: [current.messages.some(row => Number(row.is_vip) === 1) ? 'vip' : null, current.messages.some(row => Number(row.is_read) === 0) ? 'unread' : null, current.messages.some(row => Number(row.is_starred) === 1) ? 'starred' : null, current.messages.some(row => Number(row.attachment_count) > 0) ? 'attachments' : null].filter(Boolean),
    canonicalFolderKey: latest.folder_key || (latest.is_del ? 'trash' : 'inbox'),
    sourceNavigation: current.messages.map(row => ({ provider: row.provider_key || 'unknown', account_id: Number(row.account_id), message_id: Number(row.source_message_id) })),
    searchDocument: current.messages.flatMap(row => [row.subject, row.send_email, row.to_email, String(row.text || row.content || '').slice(0, 1000)]).filter(Boolean).join(' ')
  };
}

async function projectionPlan(env, context, current, virtual, facet) {
  const facets = [...virtual.unrelatedFacets, facet];
  const derived = deriveProjection({ aggregate: current.aggregate, facets, commitments: current.commitments, missions: current.missions, display: displayFromMessages(current) });
  const version = Number(current.projection?.projection_version || 0) + 1;
  const id = `projection:${await digest({ conversationId: context.conversationId, version, aggregateVersion: current.aggregate.aggregate_version, derived })}`;
  const integrity = await digest(derived);
  const statements = [];
  if (current.projection) statements.push(env.db.prepare(`UPDATE conversation_projections SET state='superseded',supersedes_id=?1 WHERE id=?2 AND state='current'`).bind(id, current.projection.id));
  statements.push(env.db.prepare(`INSERT INTO conversation_projections(id,tenant_id,workspace_id,conversation_id,projection_version,aggregate_version,materializer_version,title,preview,last_observed_at,message_count,unread_count,has_attachments,membership_keys_json,category_keys_json,facet_summary_json,active_commitment_ids_json,commitment_states_json,action_required,waiting_for_me,waiting_for_others,mission_ids_json,ranking_score,risk_key,canonical_folder_key,source_navigation_json,search_document,integrity_hash,materialization_checkpoint_id,materialization_generation,state,supersedes_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,'current',?31)`).bind(id, context.tenantId, context.workspaceId, context.conversationId, version, current.aggregate.aggregate_version, MATERIALIZER_VERSION, derived.title, derived.preview, derived.last_observed_at, derived.message_count, derived.unread_count, derived.has_attachments, JSON.stringify(derived.membership_keys), JSON.stringify(derived.category_keys), JSON.stringify(derived.facet_summary), JSON.stringify(derived.active_commitment_ids), JSON.stringify(derived.commitment_states), derived.action_required, derived.waiting_for_me, derived.waiting_for_others, JSON.stringify(derived.mission_ids), derived.ranking_score, derived.risk_key, derived.canonical_folder_key, JSON.stringify(derived.source_navigation), derived.search_document, integrity, context.checkpointId, context.leaseGeneration, current.projection?.id || null));
  return { id, derived, statements };
}

export async function buildAtomicClassificationBatch(env, validated, current, virtual, item = {}) {
  const mutationId = item.operationId || validated.mutationId || `classification:${validated.conversationId}`;
  // Evidence is immutable per observed source version. A later category action
  // must bind to the verified evidence already present for that source rather
  // than attempting a duplicate insert under conversation_evidence's unique key.
  const existingEvidence = item.existingEvidenceId ? null : await env.db.prepare(`SELECT id,integrity_hash FROM conversation_evidence WHERE tenant_id=?1 AND workspace_id=?2 AND source_message_id=?3 AND source_version=?4 AND verification_state='verified' ORDER BY created_at DESC LIMIT 1`).bind(validated.tenantId, validated.workspaceId, validated.sourceMessageId, String(item.evidenceSourceVersion || validated.sourceVersion)).first();
  const evidenceHash = item.existingEvidenceHash || existingEvidence?.integrity_hash || await digest({ mutationId, conversationId: validated.conversationId, sourceVersion: validated.sourceVersion, beforeCategories: virtual.beforeCategories, afterCategories: virtual.afterCategories });
  const evidenceId = item.existingEvidenceId || existingEvidence?.id || `classification-evidence:${await digest({ mutationId, conversationId: validated.conversationId, sourceVersion: validated.sourceVersion })}`;
  const versionRow = await env.db.prepare(`SELECT COALESCE(MAX(result_version),0) version FROM conversation_facet_results WHERE tenant_id=?1 AND workspace_id=?2 AND conversation_id=?3 AND dimension_key=?4`).bind(validated.tenantId, validated.workspaceId, validated.conversationId, PRIMARY_CATEGORY_DIMENSION).first();
  const version = Number(versionRow?.version || 0) + 1;
  const facetId = `classification-facet:${await digest({ operationId: item.operationId, conversationId: validated.conversationId, destination: validated.destinationKey, version })}`;
  const evidenceSetHash = await digest([evidenceId]);
  const facet = { id: facetId, dimension_key: PRIMARY_CATEGORY_DIMENSION, value_key: validated.destinationKey, confidence: 1, status: 'supported', explanation_code: 'explicit_primary_category_replacement' };
  const projection = await projectionPlan(env, validated, current, virtual, facet);
  const generation = Number(current.aggregate.facet_generation || 0) + 1;
  const snapshotId = `classification-snapshot:${await digest({ operationId: item.operationId, conversationId: validated.conversationId, generation })}`;
  // `conversation_evidence` is deliberately reusable immutable source
  // evidence. The sender-bulk ledger is a separate append-only operation
  // receipt, so its primary key must be operation/item-scoped rather than the
  // shared source evidence ID.
  const senderBulkEvidenceId = item.operationId
    ? `sender-bulk-evidence:${await digest({ operationId: item.operationId, itemId: item.itemId, evidenceId })}`
    : null;
  const afterState = { categories: virtual.afterCategories, projection_id: projection.id, all_mail_retained: projection.derived.canonical_folder_key !== 'trash' };
  const statements = [
    ...(item.existingEvidenceId || existingEvidence ? [] : [env.db.prepare(`INSERT INTO conversation_evidence(id,tenant_id,workspace_id,source_type,source_message_id,source_version,content_digest,integrity_hash,verification_state,observed_at) VALUES(?1,?2,?3,'primary_category_mutation',?4,?5,?6,?7,'verified',CURRENT_TIMESTAMP)`).bind(evidenceId, validated.tenantId, validated.workspaceId, validated.sourceMessageId, String(item.evidenceSourceVersion || validated.sourceVersion), evidenceHash, evidenceHash)]),
    env.db.prepare(`DELETE FROM conversation_facet_heads WHERE tenant_id=?1 AND workspace_id=?2 AND conversation_id=?3 AND dimension_key=?4`).bind(validated.tenantId, validated.workspaceId, validated.conversationId, PRIMARY_CATEGORY_DIMENSION),
    env.db.prepare(`INSERT INTO conversation_facet_results(id,tenant_id,workspace_id,conversation_id,dimension_key,value_key,result_version,classifier_key,classifier_version,input_digest,confidence,status,explanation_code,evidence_ids_json,evidence_set_hash,observed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'nexora_primary_category_contract',?8,?9,1,'supported','explicit_primary_category_replacement',?10,?11,CURRENT_TIMESTAMP)`).bind(facetId, validated.tenantId, validated.workspaceId, validated.conversationId, PRIMARY_CATEGORY_DIMENSION, validated.destinationKey, version, item.contractVersion, evidenceHash, JSON.stringify([evidenceId]), evidenceSetHash),
    env.db.prepare(`INSERT INTO conversation_facet_heads(tenant_id,workspace_id,conversation_id,dimension_key,value_key,current_result_id,current_result_version) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(validated.tenantId, validated.workspaceId, validated.conversationId, PRIMARY_CATEGORY_DIMENSION, validated.destinationKey, facetId, version),
    env.db.prepare(`UPDATE conversation_aggregates SET facet_generation=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND tenant_id=?3 AND workspace_id=?4`).bind(generation, validated.conversationId, validated.tenantId, validated.workspaceId),
    env.db.prepare(`INSERT INTO conversation_facet_snapshots(id,tenant_id,workspace_id,conversation_id,generation,input_digest,active_result_ids_json,evidence_ids_json,evidence_set_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(snapshotId, validated.tenantId, validated.workspaceId, validated.conversationId, generation, evidenceHash, JSON.stringify([...virtual.retainedResultIds, facetId].sort()), JSON.stringify([evidenceId]), evidenceSetHash),
    ...projection.statements
  ];
  if (item.operationId) statements.push(
    env.db.prepare(`INSERT INTO conversation_sender_bulk_items(id,operation_id,tenant_id,workspace_id,conversation_id,account_id,source_message_id,prior_category_keys_json,resulting_projection_id,provider_result,state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'not_requested','completed')`).bind(item.itemId, item.operationId, validated.tenantId, validated.workspaceId, validated.conversationId, validated.accountId, validated.sourceMessageId, JSON.stringify(virtual.beforeCategories), projection.id),
    env.db.prepare(`INSERT INTO conversation_sender_bulk_evidence(id,operation_id,tenant_id,workspace_id,conversation_id,source_message_id,evidence_hash,before_state_json,after_state_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(senderBulkEvidenceId, item.operationId, validated.tenantId, validated.workspaceId, validated.conversationId, validated.sourceMessageId, evidenceHash, JSON.stringify({ categories: virtual.beforeCategories, projection_id: current.projection?.id || null, source_evidence_id: evidenceId }), JSON.stringify(afterState)),
    env.db.prepare(`INSERT INTO conversation_sender_bulk_audit(id,operation_id,tenant_id,workspace_id,event_type,detail_json) VALUES(?1,?2,?3,?4,'item_atomically_committed',?5)`).bind(`sender-bulk-item-audit:${item.itemId}`, item.operationId, validated.tenantId, validated.workspaceId, JSON.stringify({ conversation_id: validated.conversationId, source_version: String(validated.sourceVersion), before_categories: virtual.beforeCategories, after_categories: virtual.afterCategories, projection_id: projection.id })),
    env.db.prepare(`UPDATE conversation_sender_bulk_operations SET completed_conversations=completed_conversations+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='running'`).bind(item.operationId, validated.tenantId, validated.workspaceId)
  );
  if (!item.operationId) statements.push(env.db.prepare(`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id) VALUES(?1,?2,'primary_category_materialized','conversation',?3,?4,?5,?6)`).bind(validated.workspaceId, validated.tenantId, validated.conversationId, JSON.stringify({ categories: virtual.beforeCategories }), JSON.stringify(afterState), mutationId));
  return { statements, evidenceId, senderBulkEvidenceId, evidenceHash, facetId, snapshotId, projectionId: projection.id, afterState };
}

export async function commitAtomicClassificationMutation(env, plan) {
  await env.db.batch(plan.statements);
  return plan;
}

export async function interpretAtomicCommit(execute) {
  try { return { committed: true, result: await execute() }; }
  catch (error) { return { committed: false, error }; }
}

export async function releaseCheckpointLeaseConditionally(env, { checkpointId, leaseOwner, leaseGeneration, nextState = 'ready' }) {
  const result = await env.db.prepare(`UPDATE conversation_materialization_checkpoints SET state=?1,lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND lease_owner=?3 AND lease_generation=?4 AND state='running'`).bind(nextState, checkpointId, leaseOwner, leaseGeneration).run();
  return Number(result.meta?.changes || 0) === 1;
}
