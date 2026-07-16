import enterpriseAuthorityService from './enterprise-authority-service';
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

const CONTRACT_VERSION = 'sender-bulk-classification-v2-atomic';
const SYSTEM_CATEGORIES = ['primary', 'promotions', 'social', 'updates', 'forums'];
const MAILBOX_DESTINATIONS = ['inbox', 'done', 'junk', 'trash'];
const WORKFLOW_DESTINATIONS = ['follow_up', 'todo', 'action_required', 'waiting_for_me', 'waiting_for_others'];
const CATEGORY_LABELS = { primary: { en: 'Primary', zh: '主要' }, promotions: { en: 'Promotions', zh: '促销' }, social: { en: 'Social', zh: '社交' }, updates: { en: 'Updates', zh: '更新' }, forums: { en: 'Forums', zh: '论坛' } };

const normalizeSender = value => String(value || '').trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1').trim();
const safeCategory = value => /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(String(value || ''));
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);

// A sender action must serialize with projection materialization, but a short
// overlapping backfill must not turn a normal tap into a terminal failure.
// This remains a shared fence: it never steals an active lease or allows two
// writers to materialize the same projection concurrently.
const waitForFence = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function claimCheckpointWithRetry(env, checkpointId, leaseOwner, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const checkpoint = await claimCheckpoint(env, checkpointId, leaseOwner);
    if (checkpoint) return checkpoint;
    if (attempt + 1 < attempts) await waitForFence(250 * (attempt + 1));
  }
  return null;
}

async function assertWorkspace(c, { workspaceId, actorUserId }) {
  const member = await c.env.db.prepare(`SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2 AND role IN ('OWNER','ADMIN','MAIL_ADMIN')`).bind(workspaceId, actorUserId).first();
  if (!member) throw new Error('sender_bulk_workspace_authority_required');
  return member;
}

async function authorizedAccounts(c, { workspaceId, actorUserId, requested = [] }) {
  const rows = (await c.env.db.prepare(`SELECT DISTINCT account_id FROM workspace_account_bindings WHERE workspace_id=?1 AND subject_user_id=?2 AND lifecycle_state='READY'`).bind(workspaceId, actorUserId).all()).results || [];
  const allowed = [];
  for (const row of rows) {
    const accountId = Number(row.account_id);
    if (requested.length && !requested.includes(accountId)) continue;
    const authority = await enterpriseAuthorityService.resolveAccountAuthority(c, { workspaceId, actingUserId: actorUserId, accountId, capability: 'account_state_visibility' });
    if (authority.allowed) allowed.push(accountId);
  }
  return [...new Set(allowed)].sort((left, right) => left - right);
}

async function categoryDestinations(c, { tenantId, workspaceId }) {
  const rows = (await c.env.db.prepare(`SELECT DISTINCT f.value_key FROM conversation_facet_heads h JOIN conversation_facet_results f ON f.id=h.current_result_id WHERE h.tenant_id=?1 AND h.workspace_id=?2 AND h.dimension_key='Category' AND f.status='supported'`).bind(tenantId, workspaceId).all()).results || [];
  const keys = [...new Set([...SYSTEM_CATEGORIES, ...rows.map(row => String(row.value_key)).filter(safeCategory)])].sort((left, right) => SYSTEM_CATEGORIES.indexOf(left) - SYSTEM_CATEGORIES.indexOf(right) || left.localeCompare(right));
  return keys.map(key => ({ id: `classification:${key}`, type: 'classification', key, icon: key === 'promotions' ? 'tag.fill' : 'tag', title: CATEGORY_LABELS[key]?.en || key.replace(/[_-]/g, ' '), title_zh: CATEGORY_LABELS[key]?.zh || key, enabled: true, disabled_reason: null, reversible: true, provider_effect: 'nexora_classification_only' }));
}

async function destinationContract(c, { tenantId, workspaceId, actorUserId, normalizedSender, accountIds = [] }) {
  await assertWorkspace(c, { workspaceId, actorUserId });
  const scope = await authorizedAccounts(c, { workspaceId, actorUserId, requested: accountIds });
  if (!scope.length) throw new Error('sender_bulk_no_authorized_accounts');
  const sender = normalizeSender(normalizedSender);
  if (!sender || !sender.includes('@')) throw new Error('sender_bulk_exact_normalized_sender_required');
  const placeholders = scope.map((_, index) => `?${index + 4}`).join(',');
  const count = await c.env.db.prepare(`SELECT COUNT(DISTINCT m.conversation_id) count FROM conversation_messages m JOIN email e ON e.email_id=m.source_message_id WHERE m.tenant_id=?1 AND m.workspace_id=?2 AND m.account_id IN (${placeholders}) AND m.lifecycle_state!='quarantined' AND lower(trim(e.send_email))=?3`).bind(tenantId, workspaceId, sender, ...scope).first();
  return {
    contract_version: CONTRACT_VERSION,
    normalized_sender: sender,
    sender_matching: 'exact_normalized_address_only',
    account_scope: scope,
    affected_conversation_count: Number(count?.count || 0),
    future_message_behavior: 'one_time_scope_no_sender_rule_created',
    sections: [
      { id: 'mailbox', title: 'Mailbox', title_zh: '邮箱', destinations: MAILBOX_DESTINATIONS.map(key => ({ id: `mailbox:${key}`, type: 'mailbox', key, icon: key === 'trash' ? 'trash' : 'folder', title: { done: 'Archive', junk: 'Junk', trash: 'Trash', inbox: 'Inbox' }[key], title_zh: { done: '归档', junk: '垃圾邮件', trash: '废纸篓', inbox: '收件箱' }[key], enabled: false, disabled_reason: 'provider_bulk_mailbox_effect_not_implemented', reversible: key !== 'trash', requires_confirmation: ['junk', 'trash'].includes(key), provider_effect: 'unavailable' })) },
      { id: 'workflow', title: 'Workflow', title_zh: '工作流', destinations: WORKFLOW_DESTINATIONS.map(key => ({ id: `workflow:${key}`, type: 'workflow', key, icon: 'checklist', title: key.replace(/_/g, ' '), title_zh: key, enabled: false, disabled_reason: 'evidence_bound_commitment_transition_required', reversible: false, provider_effect: 'not_applicable' })) },
      { id: 'classification', title: 'Categories', title_zh: '分类', destinations: await categoryDestinations(c, { tenantId, workspaceId }) }
    ]
  };
}

async function eligible(c, { tenantId, workspaceId, sender, accountScope, destination = null }) {
  const placeholders = accountScope.map((_, index) => `?${index + 4}`).join(',');
  const destinationClause = destination ? ` AND NOT EXISTS(SELECT 1 FROM conversation_facet_heads h JOIN conversation_facet_results f ON f.id=h.current_result_id WHERE h.tenant_id=m.tenant_id AND h.workspace_id=m.workspace_id AND h.conversation_id=m.conversation_id AND h.dimension_key='Category' AND f.status='supported' AND f.value_key=?${accountScope.length + 4})` : '';
  const rows = (await c.env.db.prepare(`SELECT m.conversation_id,m.account_id,m.source_message_id,m.source_version,e.create_time FROM conversation_messages m JOIN email e ON e.email_id=m.source_message_id WHERE m.tenant_id=?1 AND m.workspace_id=?2 AND m.account_id IN (${placeholders}) AND m.lifecycle_state!='quarantined' AND lower(trim(e.send_email))=?3${destinationClause} ORDER BY m.conversation_id,e.create_time DESC,e.email_id DESC`).bind(tenantId, workspaceId, sender, ...accountScope, ...(destination ? [destination] : [])).all()).results || [];
  const byConversation = new Map();
  for (const row of rows) if (!byConversation.has(row.conversation_id)) byConversation.set(row.conversation_id, row);
  return [...byConversation.values()];
}

async function classifyItemAtomically(env, { operation, row, checkpoint }) {
  const context = await validateClassificationMutationContext(env, {
    tenantId: operation.tenant_id, workspaceId: operation.workspace_id, conversationId: row.conversation_id,
    accountId: row.account_id, sourceMessageId: row.source_message_id, sourceVersion: row.source_version,
    checkpointId: checkpoint.id, leaseOwner: checkpoint.lease_owner, leaseGeneration: checkpoint.lease_generation,
    destinationKey: operation.destination_key
  });
  const current = await loadCurrentClassificationState(env, context);
  const virtual = computeVirtualReplacementCategorySet({ current, destinationKey: operation.destination_key });
  const plan = await buildAtomicClassificationBatch(env, context, current, virtual, { operationId: operation.id, itemId: `${operation.id}:${row.conversation_id}`, contractVersion: CONTRACT_VERSION });
  const commit = await interpretAtomicCommit(() => commitAtomicClassificationMutation(env, plan));
  if (!commit.committed) throw commit.error;
  return { prior: virtual.beforeCategories, projectionId: plan.projectionId, evidenceId: plan.evidenceId, afterState: plan.afterState };
}

async function preview(c, input) {
  const tenantId = input.actorUserId;
  const workspaceId = Number(input.workspaceId);
  const contract = await destinationContract(c, { tenantId, workspaceId, actorUserId: tenantId, normalizedSender: input.normalizedSender, accountIds: (input.accountIds || []).map(Number) });
  const destination = contract.sections.flatMap(section => section.destinations).find(item => item.type === input.destinationType && item.key === input.destinationKey);
  if (!destination) throw new Error('sender_bulk_destination_unknown');
  const allScope = destination.type === 'classification' ? await eligible(c, { tenantId, workspaceId, sender: contract.normalized_sender, accountScope: contract.account_scope }) : [];
  const items = destination.type === 'classification' ? await eligible(c, { tenantId, workspaceId, sender: contract.normalized_sender, accountScope: contract.account_scope, destination: destination.key }) : [];
  const historical = await c.env.db.prepare(`SELECT COUNT(DISTINCT i.conversation_id) unresolved,COUNT(DISTINCT CASE WHEN i.state='failed' THEN i.conversation_id END) failed_items,COUNT(DISTINCT CASE WHEN i.state='failed' AND EXISTS(SELECT 1 FROM conversation_facet_heads h JOIN conversation_facet_results f ON f.id=h.current_result_id WHERE h.tenant_id=i.tenant_id AND h.workspace_id=i.workspace_id AND h.conversation_id=i.conversation_id AND h.dimension_key='Category' AND f.status='supported' AND f.value_key=?4) THEN i.conversation_id END) orphan_destination_facets FROM conversation_sender_bulk_items i JOIN conversation_sender_bulk_operations o ON o.id=i.operation_id WHERE i.tenant_id=?1 AND i.workspace_id=?2 AND o.normalized_sender=?3 AND o.destination_type='classification' AND o.destination_key=?4 AND i.state!='completed'`).bind(tenantId, workspaceId, contract.normalized_sender, destination.key).first();
  const diagnostics = {
    original_authorized_scope: allScope.length,
    currently_eligible_scope: items.length,
    already_correctly_in_destination: Math.max(0, allScope.length - items.length),
    unresolved_historical_items: Number(historical?.unresolved || 0),
    failed_historical_items: Number(historical?.failed_items || 0),
    orphan_destination_facets: Number(historical?.orphan_destination_facets || 0),
    items_requiring_reconciliation: Number(historical?.unresolved || 0),
    items_requiring_new_mutation: items.length
  };
  return { ...contract, affected_conversation_count: items.length, scope_diagnostics: diagnostics, destination, requires_confirmation: Boolean(destination.requires_confirmation || items.length > 100 || contract.account_scope.length > 1) };
}

async function persistFailedItem(env, operation, row, error) {
  await env.db.batch([
    env.db.prepare(`INSERT OR REPLACE INTO conversation_sender_bulk_items(id,operation_id,tenant_id,workspace_id,conversation_id,account_id,source_message_id,prior_category_keys_json,state,error_code) VALUES(?1,?2,?3,?4,?5,?6,?7,'[]','failed',?8)`).bind(`${operation.id}:${row.conversation_id}`, operation.id, operation.tenant_id, operation.workspace_id, row.conversation_id, row.account_id, row.source_message_id, String(error?.message || error).slice(0, 120)),
    env.db.prepare(`UPDATE conversation_sender_bulk_operations SET failed_conversations=failed_conversations+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='running'`).bind(operation.id, operation.tenant_id, operation.workspace_id)
  ]);
}

async function execute(c, input) {
  const actorUserId = input.actorUserId;
  const workspaceId = Number(input.workspaceId);
  const tenantId = actorUserId;
  const previewed = await preview(c, { ...input, actorUserId });
  const destination = previewed.destination;
  if (!destination.enabled) throw new Error(`sender_bulk_destination_unavailable:${destination.disabled_reason}`);
  if (destination.type !== 'classification') throw new Error('sender_bulk_destination_not_implemented');
  if (Boolean(input.confirmed) !== true && previewed.requires_confirmation) throw new Error('sender_bulk_confirmation_required');
  const idempotencyKey = String(input.idempotencyKey || '');
  if (!idempotencyKey) throw new Error('sender_bulk_idempotency_key_required');
  const requestHash = await digest(stable({ workspaceId, normalizedSender: previewed.normalized_sender, accountScope: previewed.account_scope, destination: destination.id, future: 'one_time_scope', boundary: input.expectedBoundary || null }));
  const prior = await c.env.db.prepare(`SELECT * FROM conversation_sender_bulk_operations WHERE tenant_id=?1 AND workspace_id=?2 AND idempotency_key=?3`).bind(tenantId, workspaceId, idempotencyKey).first();
  if (prior) {
    if (prior.request_hash !== requestHash) throw new Error('sender_bulk_idempotency_payload_mismatch');
    return JSON.parse(prior.result_json || JSON.stringify({ operation_id: prior.id, state: prior.state, idempotent: true }));
  }
  const id = `sender-bulk:${await digest({ tenantId, workspaceId, idempotencyKey })}`;
  const operation = { id, tenant_id: tenantId, workspace_id: workspaceId, actor_user_id: actorUserId, normalized_sender: previewed.normalized_sender, account_scope: previewed.account_scope, destination_key: destination.key };
  const items = await eligible(c, { tenantId, workspaceId, sender: previewed.normalized_sender, accountScope: previewed.account_scope, destination: destination.key });
  const missionId = `sender-bulk-mission:${id}`;
  const actionId = `sender-bulk-action:${id}`;
  const checkpointId = await ensureCheckpoint(c.env, tenantId, workspaceId);
  const leaseOwner = `sender-bulk:${id}`;
  const checkpoint = await claimCheckpointWithRetry(c.env, checkpointId, leaseOwner);
  if (!checkpoint) {
    // Do not write a failed durable operation for a transient shared-fence
    // collision. The client retries this explicit, safe condition using a new
    // idempotency key after the active materializer releases its lease.
    throw new Error('sender_bulk_materialization_busy_retryable');
  }
  try {
    await c.env.db.prepare(`INSERT INTO conversation_sender_bulk_operations(id,tenant_id,workspace_id,actor_user_id,normalized_sender,sender_identity_hash,account_scope_json,destination_type,destination_key,future_message_policy,request_hash,idempotency_key,expected_boundary,state,lease_generation,lease_until,total_conversations,provider_sync_state,reversible,mission_id,action_id) VALUES(?1,?2,?3,?4,?5,?6,?7,'classification',?8,'one_time_scope',?9,?10,?11,'running',1,datetime('now','+5 minutes'),?12,'not_requested',1,?13,?14)`).bind(id, tenantId, workspaceId, actorUserId, operation.normalized_sender, await digest(operation.normalized_sender), JSON.stringify(operation.account_scope), destination.key, requestHash, idempotencyKey, input.expectedBoundary || null, items.length, missionId, actionId).run();
  } catch (error) {
    await releaseCheckpointLeaseConditionally(c.env, { checkpointId: checkpoint.id, leaseOwner, leaseGeneration: checkpoint.lease_generation });
    throw error;
  }
  let completed = 0;
  let failed = 0;
  const projectionIds = [];
  try {
    for (const row of items) {
      try {
        const result = await classifyItemAtomically(c.env, { operation, row, checkpoint });
        completed += 1;
        projectionIds.push(result.projectionId);
      } catch (error) {
        failed += 1;
        await persistFailedItem(c.env, operation, row, error);
      }
    }
  } finally {
    await releaseCheckpointLeaseConditionally(c.env, { checkpointId: checkpoint.id, leaseOwner, leaseGeneration: checkpoint.lease_generation });
  }
  const state = failed ? 'partial' : 'completed';
  const result = { operation_id: id, mission_id: missionId, action_id: actionId, outcome_id: `sender-bulk-outcome:${id}`, state, normalized_sender: operation.normalized_sender, account_scope: operation.account_scope, destination: { type: 'classification', key: destination.key }, future_message_behavior: 'one_time_scope_no_sender_rule_created', total: items.length, completed, failed, provider_sync: { state: 'not_requested', reason: 'NEXORA classification does not assert a provider label operation' }, projection_ids: projectionIds, idempotent: false };
  await c.env.db.batch([
    c.env.db.prepare(`UPDATE conversation_sender_bulk_operations SET state=?1,lease_until=NULL,completed_conversations=?2,failed_conversations=?3,outcome_id=?4,result_json=?5,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?6 AND state='running'`).bind(state, completed, failed, result.outcome_id, JSON.stringify(result), id),
    c.env.db.prepare(`INSERT INTO conversation_sender_bulk_audit(id,operation_id,tenant_id,workspace_id,event_type,detail_json) VALUES(?1,?2,?3,?4,'completed',?5)`).bind(`sender-bulk-audit:${id}`, id, tenantId, workspaceId, JSON.stringify(result)),
    c.env.db.prepare(`INSERT INTO workspace_audit_events(workspace_id,actor_user_id,action,object_type,object_ref,before_state_json,after_state_json,request_id) VALUES(?1,?2,'sender_bulk_classification','conversation_sender_bulk_operation',?3,'{}',?4,?5)`).bind(workspaceId, actorUserId, id, JSON.stringify(result), id)
  ]);
  return result;
}

async function operation(c, { tenantId, workspaceId, operationId }) {
  await assertWorkspace(c, { workspaceId, actorUserId: tenantId });
  const row = await c.env.db.prepare(`SELECT * FROM conversation_sender_bulk_operations WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(operationId, tenantId, workspaceId).first();
  if (!row) throw new Error('sender_bulk_operation_not_found');
  return JSON.parse(row.result_json || JSON.stringify({ operation_id: row.id, state: row.state }));
}

export { CONTRACT_VERSION, normalizeSender, destinationContract, preview, execute, operation };
export default { destinationContract, preview, execute, operation };
