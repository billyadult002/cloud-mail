const first = (source, ...keys) => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key]
  }
  return undefined
}

export const REQUIRED_WORKSPACE = Object.freeze({ workspaceId: 1, displayName: 'NEXORA Runtime Validation' })

export function normalizeActor(source = {}) {
  const userId = Number(first(source, 'userId', 'user_id', 'id'))
  const email = String(first(source, 'email') || '').trim().toLowerCase()
  if (!Number.isInteger(userId) || userId <= 0 || !email || !email.includes('@')) {
    throw new Error('The server did not return a verifiable actor identity.')
  }
  return { userId, email }
}

export function assertSameActor(authenticatedActor, serverActor) {
  const authenticated = normalizeActor(authenticatedActor)
  const server = normalizeActor(serverActor)
  if (authenticated.userId !== server.userId || authenticated.email !== server.email) {
    throw new Error('Authenticated actor does not match the workspace authority actor.')
  }
  return server
}

export function maskEmail(value) {
  const email = String(value || '').trim()
  const split = email.lastIndexOf('@')
  if (split <= 0 || split === email.length - 1) return 'Authenticated administrator'
  const local = email.slice(0, split)
  const domain = email.slice(split + 1)
  return `${local.slice(0, 1)}${'•'.repeat(Math.min(3, Math.max(2, local.length - 1)))}@${domain}`
}

export function shortReference(value) {
  const text = String(value || '').trim()
  if (!text) return '—'
  if (text.length <= 12) return text
  return `${text.slice(0, 8)}…${text.slice(-4)}`
}

const normalizeWorkspace = (row = {}) => {
  const workspaceId = Number(first(row, 'workspaceId', 'workspace_id', 'id'))
  const role = String(first(row, 'role') || '').trim().toUpperCase()
  const capabilities = [...new Set(Array.isArray(row.capabilities) ? row.capabilities.map(String) : [])]
  return {
    workspaceId,
    displayName: String(first(row, 'displayName', 'display_name') || '').trim(),
    role,
    capabilities,
    canActivateDomain: row.canActivateDomain === true || row.can_activate_domain === true,
  }
}

export function normalizeWorkspaceDiscovery(payload = {}) {
  if (!Array.isArray(payload.workspaces)) throw new Error('The server did not return a workspace list.')
  const workspaces = payload.workspaces.map(normalizeWorkspace)
  if (workspaces.some((row) => !Number.isInteger(row.workspaceId) || row.workspaceId <= 0)) {
    throw new Error('The server returned an invalid workspace.')
  }
  if (new Set(workspaces.map((row) => row.workspaceId)).size !== workspaces.length) {
    throw new Error('The server returned duplicate workspace authority.')
  }
  return { workspaces, selectionRequired: payload.selectionRequired === true || workspaces.length !== 1 }
}

export function canValidateWorkspaceOne(workspace) {
  return workspace?.workspaceId === REQUIRED_WORKSPACE.workspaceId
    && workspace.displayName === REQUIRED_WORKSPACE.displayName
    && ['OWNER', 'ADMIN'].includes(workspace.role)
    && workspace.canActivateDomain === true && workspace.capabilities.includes('domain:write')
}

export function normalizeValidationReceipt(payload = {}) {
  const workspace = normalizeWorkspace(payload.workspace || {})
  const evidence = payload.selectionEvidence || payload.selection_evidence || {}
  if (!canValidateWorkspaceOne(workspace)) throw new Error('Workspace 1 does not have domain activation authority.')
  const receipt = {
    workspace,
    workspaceSelectionRef: String(first(evidence, 'workspaceSelectionRef', 'workspace_selection_ref') || ''),
    hmacKeyVersion: String(first(evidence, 'hmacKeyVersion', 'hmac_key_version') || ''),
    requestId: String(first(evidence, 'requestId', 'request_id') || ''),
    runtimeDeploymentId: String(first(evidence, 'runtimeDeploymentId', 'runtime_deployment_id') || ''),
    validatedAt: String(first(evidence, 'validatedAt', 'validated_at') || ''),
    redactionLevel: String(first(evidence, 'redactionLevel', 'redaction_level') || '').toUpperCase(),
  }
  if (!receipt.workspaceSelectionRef || !receipt.hmacKeyVersion || !receipt.requestId
    || !receipt.runtimeDeploymentId || !Number.isFinite(Date.parse(receipt.validatedAt))
    || receipt.redactionLevel !== 'BODYLESS') {
    throw new Error('The server returned incomplete workspace validation evidence.')
  }
  return receipt
}

export function normalizeValidationAuthorization(payload = {}) {
  const workspaceSelectionCredential = String(payload.workspaceSelectionCredential || payload.workspace_selection_credential || '')
  if (!workspaceSelectionCredential || workspaceSelectionCredential.length > 4096) {
    throw new Error('The server did not return a valid workspace selection credential.')
  }
  return { actor: normalizeActor(payload.actor), receipt: normalizeValidationReceipt(payload), workspaceSelectionCredential }
}

export function normalizeChallenge(payload = {}) {
  const challenge = payload.challenge || {}
  const dns = payload.dnsRecord || payload.dns_record || {}
  const normalized = {
    id: String(first(challenge, 'id') || ''),
    workspaceId: Number(first(challenge, 'workspace_id', 'workspaceId')),
    domain: String(first(challenge, 'normalized_domain', 'normalizedDomain') || ''),
    name: String(first(dns, 'name') || first(challenge, 'challenge_name', 'challengeName') || ''),
    value: String(first(dns, 'value') || ''),
    generation: Number(first(challenge, 'generation')),
    status: String(first(challenge, 'verification_status', 'verificationStatus') || '').toUpperCase(),
    expiresAt: String(first(challenge, 'expires_at', 'expiresAt') || first(dns, 'expiresAt', 'expires_at') || ''),
  }
  if (!normalized.id || normalized.workspaceId !== 1 || normalized.domain !== 'fastonegroup.com'
    || normalized.name !== '_nexora-domain.fastonegroup.com' || !normalized.value
    || !Number.isInteger(normalized.generation) || normalized.generation <= 0
    || normalized.status !== 'PENDING' || !Number.isFinite(Date.parse(normalized.expiresAt))) {
    throw new Error('The server returned an invalid DNS challenge.')
  }
  return normalized
}

export function normalizeVerification(payload = {}) {
  const row = payload.workspaceDomain || payload.workspace_domain || {}
  const verification = payload.verification || {}
  const normalized = {
    workspaceId: Number(first(row, 'workspace_id', 'workspaceId')),
    domain: String(first(row, 'domain') || ''),
    authorityState: String(first(row, 'authority_state', 'authorityState') || '').toUpperCase(),
    lifecycleState: String(first(row, 'lifecycle_state', 'lifecycleState') || '').toUpperCase(),
    healthState: String(first(row, 'health_state', 'healthState') || '').toUpperCase(),
    evidenceRef: String(first(verification, 'verificationEvidenceRef', 'verification_evidence_ref') || ''),
    challengeId: String(first(verification, 'challengeId', 'challenge_id') || ''),
    generation: Number(first(verification, 'generation')),
  }
  if (normalized.workspaceId !== 1 || normalized.domain !== 'fastonegroup.com'
    || normalized.authorityState !== 'VERIFIED' || normalized.lifecycleState !== 'READY'
    || normalized.healthState !== 'READY' || !normalized.evidenceRef || !normalized.challengeId) {
    throw new Error('The server did not verify the Workspace 1 domain binding.')
  }
  return normalized
}

export function normalizeAuthority(payload = {}) {
  const row = payload.authority || {}
  const normalized = {
    id: String(first(row, 'id') || ''),
    workspaceId: Number(first(row, 'workspace_id', 'workspaceId')),
    domain: String(first(row, 'normalized_domain', 'normalizedDomain') || ''),
    status: String(first(row, 'verification_status', 'verificationStatus') || '').toUpperCase(),
    generation: Number(first(row, 'generation')),
    evidenceRef: String(first(row, 'verification_evidence_ref', 'verificationEvidenceRef') || ''),
    revokedAt: first(row, 'revoked_at', 'revokedAt') || null,
  }
  if (!normalized.id || normalized.workspaceId !== 1 || normalized.domain !== 'fastonegroup.com'
    || normalized.status !== 'VERIFIED' || normalized.revokedAt || !normalized.evidenceRef) {
    throw new Error('The server did not establish an active Workspace 1 Domain Authority.')
  }
  return normalized
}

export function activationIssue(error) {
  const message = String(error?.message || error?.response?.data?.message || '').toLowerCase()
  if (message.includes('expired')) return { state: 'expired', message: 'Authorization or challenge expired. Validate Workspace 1 again.' }
  if (message.includes('revoked')) return { state: 'revoked', message: 'Domain authority is revoked and requires a new approved verification.' }
  if (message.includes('conflict') || message.includes('already') || message.includes('bound')) return { state: 'conflict', message: 'The server reported a conflicting domain activation state.' }
  return { state: 'blocked', message: safeActivationError(error) }
}

export function safeActivationError(error) {
  const code = Number(error?.code || error?.response?.data?.code || error?.response?.status)
  if (code === 401) return 'Your authenticated session has expired. Sign in again.'
  if (code === 403) return 'This administrator cannot activate a domain for Workspace 1.'
  return 'Workspace validation could not be completed. No domain activation was started.'
}
