import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_1_V3_CHECKPOINT,
  WORKSPACE_2_V3_CHECKPOINT,
  checkpointSelectSql,
  requireExactCheckpoint
} from '../ucs-checkpoint-monitor-identity.mjs';

const w1 = { checkpoint_id: WORKSPACE_1_V3_CHECKPOINT.checkpoint_id, tenant_id: 1, workspace_id: 1, pipeline_key: WORKSPACE_1_V3_CHECKPOINT.pipeline_key, lease_generation: 243, processed_count: 789, state: 'running', owner: 'w1-owner', lease_until: '2026-07-16 13:19:57', updated_at: '2026-07-16 13:18:57' };
const w2 = { checkpoint_id: WORKSPACE_2_V3_CHECKPOINT.checkpoint_id, tenant_id: 1, workspace_id: 2, pipeline_key: WORKSPACE_2_V3_CHECKPOINT.pipeline_key, lease_generation: 78, processed_count: 387, state: 'paused', owner: null, lease_until: null, updated_at: '2026-07-16 10:31:24' };

describe('UCS checkpoint monitor identity contract', () => {
  it('uses all four Workspace 2 identity predicates in the query', () => {
    const sql = checkpointSelectSql(WORKSPACE_2_V3_CHECKPOINT);
    expect(sql).toContain("id='ucs-projection-rematerialize-v3:1:2'");
    expect(sql).toContain('tenant_id=1');
    expect(sql).toContain('workspace_id=2');
    expect(sql).toContain("pipeline_key='ucs-projection-rematerialize-v3'");
  });

  it('never reports Workspace 1 generation 243 as Workspace 2', () => {
    expect(() => requireExactCheckpoint([w1])).toThrow('CHECKPOINT_SCOPE_MISMATCH');
  });

  it('does not allow the highest generation to override the exact Workspace 2 row', () => {
    expect(requireExactCheckpoint([w2])).toMatchObject({ checkpoint_id: w2.checkpoint_id, lease_generation: 78, processed_count: 387 });
  });

  it('does not allow the latest updated checkpoint to override the exact Workspace 2 row', () => {
    expect(requireExactCheckpoint([w2])).toMatchObject({ updated_at: '2026-07-16 10:31:24' });
  });

  it('fails explicitly when the Workspace 2 row is absent rather than falling back to Workspace 1', () => {
    expect(() => requireExactCheckpoint([])).toThrow('CHECKPOINT_NOT_FOUND');
  });

  it('fails explicitly for ambiguous checkpoint results', () => {
    expect(() => requireExactCheckpoint([w2, { ...w2 }])).toThrow('CHECKPOINT_AMBIGUOUS');
  });
});
