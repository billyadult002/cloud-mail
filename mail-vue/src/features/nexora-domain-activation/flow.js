import {
  assertSameActor, canValidateWorkspaceOne, normalizeAuthority, normalizeChallenge, normalizeValidationAuthorization,
  normalizeVerification, normalizeWorkspaceDiscovery,
} from './model.js'

export async function discoverWorkspaceAuthority(discover, authenticatedActor) {
  const payload = await discover()
  assertSameActor(authenticatedActor, payload.actor)
  return normalizeWorkspaceDiscovery(payload)
}

export function selectWorkspaceOne(discovery, workspaceId, confirmed) {
  if (Number(workspaceId) !== 1 || confirmed !== true) throw new Error('Workspace 1 must be selected explicitly.')
  const workspace = discovery?.workspaces?.find((row) => row.workspaceId === 1)
  if (!workspace) throw new Error('Workspace 1 was not returned by the server.')
  if (!canValidateWorkspaceOne(workspace)) throw new Error('Workspace 1 does not have domain activation authority.')
  return workspace
}

export async function validateWorkspaceOne({ discovery, workspaceId, confirmed, authenticatedActor, validate }) {
  selectWorkspaceOne(discovery, workspaceId, confirmed)
  const authorization = normalizeValidationAuthorization(await validate(workspaceId))
  assertSameActor(authenticatedActor, authorization.actor)
  if (authorization.receipt.workspace.workspaceId !== Number(workspaceId)) {
    throw new Error('Validated workspace does not match the explicitly selected workspace.')
  }
  return authorization
}

const requireApproval = (approved, label) => {
  if (approved !== true) throw new Error(`${label} requires separate explicit approval.`)
}

export async function issueChallenge({ authorized, approved, create }) {
  requireApproval(approved, 'DNS challenge issuance')
  if (!authorized?.workspaceSelectionCredential) throw new Error('Workspace authorization is required.')
  return normalizeChallenge(await create(authorized.workspaceSelectionCredential))
}

export async function verifyChallenge({ authorized, challenge, approved, verify }) {
  requireApproval(approved, 'DNS verification')
  if (!authorized?.workspaceSelectionCredential || !challenge?.id) throw new Error('Pending authorized challenge is required.')
  return normalizeVerification(await verify(authorized.workspaceSelectionCredential, challenge))
}

export async function bootstrapAuthority({ authorized, verification, approved, bootstrap }) {
  requireApproval(approved, 'Domain Authority bootstrap')
  if (!authorized?.workspaceSelectionCredential || verification?.authorityState !== 'VERIFIED') {
    throw new Error('Verified Workspace 1 domain authority is required.')
  }
  return normalizeAuthority(await bootstrap(authorized.workspaceSelectionCredential))
}
