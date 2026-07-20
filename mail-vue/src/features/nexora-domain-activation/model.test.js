import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertSameActor,
  canValidateWorkspaceOne,
  maskEmail,
  normalizeValidationReceipt,
  normalizeWorkspaceDiscovery,
  shortReference,
} from './model.js'

const workspaceOne = {
  workspaceId: 1,
  displayName: 'NEXORA Runtime Validation',
  tenantKey: 'must-not-escape',
  role: 'OWNER',
  capabilities: ['domain:read', 'domain:write'],
  canActivateDomain: true,
}

test('actor identity is masked without exposing account data', () => {
  assert.equal(maskEmail('admin@fastonegroup.com'), 'a•••@fastonegroup.com')
  assert.equal(maskEmail('invalid'), 'Authenticated administrator')
})

test('workspace discovery preserves exact display name and drops tenant material', () => {
  const result = normalizeWorkspaceDiscovery({ workspaces: [workspaceOne], selectionRequired: false })
  assert.deepEqual(result.workspaces[0], {
    workspaceId: 1,
    displayName: 'NEXORA Runtime Validation',
    role: 'OWNER',
    capabilities: ['domain:read', 'domain:write'],
    canActivateDomain: true,
  })
  assert.equal(result.workspaces[0].displayName, 'NEXORA Runtime Validation')
  assert.equal(JSON.stringify(result).includes('must-not-escape'), false)
})

test('duplicate workspace authority fails closed', () => {
  assert.throws(() => normalizeWorkspaceDiscovery({ workspaces: [workspaceOne, workspaceOne] }), /duplicate/i)
})

test('only Workspace 1 owner or admin with domain write can validate', () => {
  const eligible = normalizeWorkspaceDiscovery({ workspaces: [workspaceOne] }).workspaces[0]
  assert.equal(canValidateWorkspaceOne(eligible), true)
  assert.equal(canValidateWorkspaceOne({ ...eligible, workspaceId: 2 }), false)
  assert.equal(canValidateWorkspaceOne({ ...eligible, displayName: 'Lookalike workspace' }), false)
  assert.equal(canValidateWorkspaceOne({ ...eligible, role: 'VIEWER' }), false)
  assert.equal(canValidateWorkspaceOne({ ...eligible, capabilities: ['domain:read'] }), false)
})

test('authenticated and server actors must match by id and normalized email', () => {
  assert.deepEqual(assertSameActor(
    { id: 44, email: 'Admin@FastOneGroup.com' },
    { userId: 44, email: 'admin@fastonegroup.com' },
  ), { userId: 44, email: 'admin@fastonegroup.com' })
  assert.throws(() => assertSameActor({ id: 44, email: 'a@example.com' }, { userId: 45, email: 'a@example.com' }), /does not match/i)
  assert.throws(() => assertSameActor({ id: 44, email: 'a@example.com' }, { userId: 44, email: 'b@example.com' }), /does not match/i)
})

test('validation receipt requires complete BODYLESS server evidence', () => {
  const receipt = normalizeValidationReceipt({
    workspace: workspaceOne,
    selectionEvidence: {
      workspaceSelectionRef: 'a'.repeat(64),
      hmacKeyVersion: 'v1',
      requestId: 'ray-request',
      runtimeDeploymentId: 'worker-version',
      validatedAt: '2026-07-20T01:00:00.000Z',
      redactionLevel: 'BODYLESS',
      token: 'must-not-escape',
    },
    workspaceSelectionCredential: 'memory-only-selection-credential',
  })
  assert.equal(receipt.workspace.workspaceId, 1)
  assert.equal('token' in receipt, false)
  assert.throws(() => normalizeValidationReceipt({ workspace: workspaceOne, selectionEvidence: {} }), /incomplete/i)
})

test('long references are shortened for display', () => {
  assert.equal(shortReference('1234567890abcdef'), '12345678…cdef')
})
