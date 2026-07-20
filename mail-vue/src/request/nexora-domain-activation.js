import http from '@/axios/index.js'

export function discoverDomainWorkspaces() {
  return http.get('/v3/domain-authorities/workspace-selector', { noMsg: true })
}

export function validateDomainWorkspace(workspaceId) {
  const id = Number(workspaceId)
  if (!Number.isInteger(id) || id <= 0) throw new Error('A valid workspace is required.')
  return http.post('/v3/domain-authorities/workspace-selector/validate', { workspaceId: id }, { noMsg: true })
}

export function createDomainChallenge({ workspaceId, domain, idempotencyKey, workspaceSelectionCredential }) {
  return http.post('/v3/domain-ownership/dns-challenges', {
    workspaceId, domain, idempotencyKey, workspaceSelectionCredential,
  }, { noMsg: true })
}

export function verifyDomainChallenge({ workspaceId, domain, challengeId, expectedGeneration, idempotencyKey, workspaceSelectionCredential }) {
  return http.post('/v3/domain-ownership/dns-challenges/verify', {
    workspaceId, domain, challengeId, expectedGeneration, idempotencyKey, workspaceSelectionCredential,
  }, { noMsg: true })
}

export function bootstrapDomainAuthority({ workspaceId, domain, idempotencyKey, workspaceSelectionCredential }) {
  return http.post('/v3/domain-authorities/bootstrap', {
    workspaceId, domain, idempotencyKey, workspaceSelectionCredential,
  }, { noMsg: true })
}
