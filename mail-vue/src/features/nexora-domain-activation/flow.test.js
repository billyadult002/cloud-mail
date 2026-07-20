import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bootstrapAuthority, discoverWorkspaceAuthority, issueChallenge, selectWorkspaceOne,
  validateWorkspaceOne, verifyChallenge,
} from './flow.js'

const discoveryPayload = {
  actor: { userId: 44, email: 'admin@fastonegroup.com' },
  workspaces: [{ workspaceId: 1, displayName: 'NEXORA Runtime Validation', role: 'ADMIN', capabilities: ['domain:read', 'domain:write'], canActivateDomain: true }],
  selectionRequired: true,
}
const validationPayload = {
  actor: discoveryPayload.actor,
  workspace: discoveryPayload.workspaces[0],
  selectionEvidence: {
    workspaceSelectionRef: 'selection-hmac', hmacKeyVersion: 'v1', requestId: 'ray-1',
    runtimeDeploymentId: 'deployment-1', validatedAt: '2026-07-20T01:00:00.000Z', redactionLevel: 'BODYLESS',
  },
  workspaceSelectionCredential: 'memory-only-selection-credential',
}
const authenticatedActor = { id: 44, email: 'admin@fastonegroup.com' }

test('discovery does not auto-select or validate', async () => {
  let validations = 0
  const discovery = await discoverWorkspaceAuthority(async () => discoveryPayload, authenticatedActor)
  assert.equal(discovery.workspaces[0].workspaceId, 1)
  assert.equal(validations, 0)
})

test('Workspace 1 requires explicit confirmation', async () => {
  const discovery = await discoverWorkspaceAuthority(async () => discoveryPayload, authenticatedActor)
  assert.throws(() => selectWorkspaceOne(discovery, 1, false), /explicitly/i)
  assert.throws(() => selectWorkspaceOne(discovery, 2, true), /Workspace 1/i)
})

test('validated state requires matching Workspace 1 server receipt', async () => {
  const discovery = await discoverWorkspaceAuthority(async () => discoveryPayload, authenticatedActor)
  const calls = []
  const receipt = await validateWorkspaceOne({
    discovery, workspaceId: 1, confirmed: true, authenticatedActor,
    validate: async (workspaceId) => { calls.push(workspaceId); return validationPayload },
  })
  assert.deepEqual(calls, [1])
  assert.equal(receipt.receipt.workspace.workspaceId, 1)
  assert.equal(receipt.workspaceSelectionCredential, 'memory-only-selection-credential')
})

test('write stages remain locked and never auto-chain before separate approvals', async () => {
  const authorized = { workspaceSelectionCredential: 'memory-only-selection-credential' }
  let writes = 0
  await assert.rejects(() => issueChallenge({ authorized, approved: false, create: async () => { writes += 1 } }), /separate/i)
  await assert.rejects(() => verifyChallenge({ authorized, challenge: { id: 'c1' }, approved: false, verify: async () => { writes += 1 } }), /separate/i)
  await assert.rejects(() => bootstrapAuthority({ authorized, verification: { authorityState: 'VERIFIED' }, approved: false, bootstrap: async () => { writes += 1 } }), /separate/i)
  assert.equal(writes, 0)
})

test('each approved stage performs exactly one explicitly requested write', async () => {
  const authorized = { workspaceSelectionCredential: 'memory-only-selection-credential' }
  const challenge = await issueChallenge({ authorized, approved: true, create: async (credential) => {
    assert.equal(credential, authorized.workspaceSelectionCredential)
    return { challenge: { id: 'c1', workspace_id: 1, normalized_domain: 'fastonegroup.com', generation: 1, verification_status: 'pending', expires_at: '2026-07-21T01:00:00Z' }, dnsRecord: { name: '_nexora-domain.fastonegroup.com', value: 'nexora-domain-verification=secret' } }
  } })
  const verification = await verifyChallenge({ authorized, challenge, approved: true, verify: async () => ({ workspaceDomain: { workspace_id: 1, domain: 'fastonegroup.com', authority_state: 'VERIFIED', lifecycle_state: 'READY', health_state: 'READY' }, verification: { verificationEvidenceRef: 'evidence', challengeId: 'c1', generation: 1 } }) })
  const authority = await bootstrapAuthority({ authorized, verification, approved: true, bootstrap: async () => ({ authority: { id: 'a1', workspace_id: 1, normalized_domain: 'fastonegroup.com', verification_status: 'verified', verification_evidence_ref: 'evidence', generation: 1, revoked_at: null } }) })
  assert.equal(authority.status, 'VERIFIED')
})

test('read-only or mismatched workspace authority cannot validate', async () => {
  const readOnly = await discoverWorkspaceAuthority(async () => ({ actor: discoveryPayload.actor,
    workspaces: [{ workspaceId: 1, displayName: 'NEXORA Runtime Validation', role: 'VIEWER', capabilities: ['domain:read'], canActivateDomain: false }],
  }), authenticatedActor)
  let validations = 0
  await assert.rejects(() => validateWorkspaceOne({
    discovery: readOnly, workspaceId: 1, confirmed: true, authenticatedActor,
    validate: async () => { validations += 1 },
  }), /authority/i)
  assert.equal(validations, 0)

  const discovery = await discoverWorkspaceAuthority(async () => discoveryPayload, authenticatedActor)
  await assert.rejects(() => validateWorkspaceOne({
    discovery, workspaceId: 1, confirmed: true, authenticatedActor,
    validate: async () => ({ ...validationPayload, workspace: { ...validationPayload.workspace, workspaceId: 2 } }),
  }), /Workspace 1/i)
})

test('discovery and validation fail closed on actor mismatch', async () => {
  await assert.rejects(() => discoverWorkspaceAuthority(async () => discoveryPayload,
    { id: 99, email: 'other@fastonegroup.com' }), /does not match/i)
  const discovery = await discoverWorkspaceAuthority(async () => discoveryPayload, authenticatedActor)
  await assert.rejects(() => validateWorkspaceOne({
    discovery, workspaceId: 1, confirmed: true, authenticatedActor,
    validate: async () => ({ ...validationPayload, actor: { userId: 99, email: 'other@fastonegroup.com' } }),
  }), /does not match/i)
})

test('lookalike Workspace 1 name cannot be selected', async () => {
  const payload = { ...discoveryPayload, workspaces: [{ ...discoveryPayload.workspaces[0], displayName: 'NEXORA Runtime Validati0n' }] }
  const discovery = await discoverWorkspaceAuthority(async () => payload, authenticatedActor)
  assert.throws(() => selectWorkspaceOne(discovery, 1, true), /authority/i)
})
