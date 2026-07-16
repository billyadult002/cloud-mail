export const WORKSPACE_2_V3_CHECKPOINT = Object.freeze({
  checkpoint_id: 'ucs-projection-rematerialize-v3:1:2',
  tenant_id: 1,
  workspace_id: 2,
  pipeline_key: 'ucs-projection-rematerialize-v3'
});

export const WORKSPACE_1_V3_CHECKPOINT = Object.freeze({
  checkpoint_id: 'ucs-projection-rematerialize-v3:1:1',
  tenant_id: 1,
  workspace_id: 1,
  pipeline_key: 'ucs-projection-rematerialize-v3'
});

const OUTPUT_FIELDS = Object.freeze([
  'checkpoint_id', 'tenant_id', 'workspace_id', 'pipeline_key',
  'lease_generation', 'processed_count', 'state', 'owner', 'lease_until', 'updated_at'
]);

export function checkpointSelectSql(scope) {
  return `SELECT id AS checkpoint_id, tenant_id, workspace_id, pipeline_key, lease_generation, processed_count, state, lease_owner AS owner, lease_until, updated_at FROM conversation_materialization_checkpoints WHERE id='${scope.checkpoint_id}' AND tenant_id=${scope.tenant_id} AND workspace_id=${scope.workspace_id} AND pipeline_key='${scope.pipeline_key}'`;
}

function sameScope(row, scope) {
  return row?.checkpoint_id === scope.checkpoint_id
    && Number(row?.tenant_id) === scope.tenant_id
    && Number(row?.workspace_id) === scope.workspace_id
    && row?.pipeline_key === scope.pipeline_key;
}

export function requireExactCheckpoint(rows, scope = WORKSPACE_2_V3_CHECKPOINT) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('CHECKPOINT_NOT_FOUND');
  if (rows.length !== 1) throw new Error('CHECKPOINT_AMBIGUOUS');
  if (!sameScope(rows[0], scope)) throw new Error('CHECKPOINT_SCOPE_MISMATCH');
  const row = rows[0];
  for (const field of OUTPUT_FIELDS) if (!(field in row)) throw new Error(`CHECKPOINT_FIELD_MISSING:${field}`);
  return Object.fromEntries(OUTPUT_FIELDS.map(field => [field, row[field]]));
}

export { OUTPUT_FIELDS };
